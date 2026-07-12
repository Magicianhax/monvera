import "server-only";

// Autopilot executor — the autonomous run. For one config it:
//   1. reads the user's USDG balance (the embedded EOA holds the funds),
//   2. has Vera re-allocate against the saved goal (Virtuals inference),
//   3. gates on the user's HARD bounds (checkBounds) — nothing signs if it fails,
//   4. executes the basket exactly like the app: one Arcus firm quote per leg,
//      the delegated EOA (Privy server wallet) signs each Permit2 intent (+ a
//      gasless USDG permit if the Permit2 allowance is missing), and everything
//      settles as ONE sponsored UserOp via the Pimlico relay,
//   5. records the run (advances nextRunAt, accrues spentThisPeriod).
//
// It never exceeds the authorized amount, risk ceiling, or per-period cap.
import { createPublicClient, encodeFunctionData, http, parseAbi } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { checkBounds, type AutopilotConfig } from "@/lib/autopilot";
import { recordRun, logRun } from "@/lib/server/autopilotStore";
import { addNotification } from "@/lib/server/notifyStore";
import { buildAllocation } from "@/lib/server/allocate";
import { getServerSmartAccountClient } from "@/lib/server/privySmartAccount";
import { getQuote, PERMIT2 } from "@/lib/server/arcus";
import { spliceSignature, splitByWeights } from "@/lib/arcusShared";
import { buildPlanId, recHash, signRiskInference } from "@/lib/eip712";
import { ERC20_ABI, VERA_RECORD_ABI } from "@/lib/abis";
import { USDG, INFERENCE_VERIFIER, assetBySymbol } from "@/lib/tokens";
import { zeroAddress } from "viem";

const AGENT_ID = BigInt(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");
const RISK_HEADROOM_BPS = 1500;
const EXPIRY_SECONDS = 15 * 60;

const RISK_CEILING_BPS = 10000;
// Below ~$0.50 a leg, RFQ quotes get unreliable and the fill is all spread.
const MIN_LEG_MICRO = BigInt(500_000);
const MAX_UINT256 = (BigInt(1) << BigInt(256)) - BigInt(1);

const publicClient = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

const PERMIT_ABI = parseAbi([
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
]);

export interface RunResult {
  ok: boolean;
  txHash?: string;
  reason?: string;
}

/**
 * Run one autopilot config. `manual` = true for a user-triggered "Run now"
 * (counts against the current period); false = scheduled (starts a new period).
 */
export async function runAutopilot(
  cfg: AutopilotConfig,
  opts: { manual?: boolean; nowSeconds: number },
): Promise<RunResult> {
  const now = opts.nowSeconds;
  const working: AutopilotConfig = { ...cfg };
  // A scheduled run begins a fresh cadence period — reset the spend window.
  if (!opts.manual) working.spentThisPeriod = 0;

  // The embedded EOA is the funded account and the Arcus taker (Arcus only
  // quotes plain EOAs); the smart account is just the gas-sponsored relayer.
  const taker = working.owner as `0x${string}`;

  // 1. Available cash (USDG, 6dp).
  const bal = (await publicClient.readContract({
    address: USDG.address as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [taker],
  })) as bigint;
  const availableUsd = Number(bal) / 1_000_000;

  // 2. Vera re-allocates for the saved goal.
  const allocation = await buildAllocation(working.goal, working.amountUsd);
  const assessedRiskBps = Math.max(0, Math.min(RISK_CEILING_BPS, Math.round(allocation.riskScore)));

  // 3. Hard bounds gate — the safety guarantee. Nothing below runs if this fails.
  const bounds = checkBounds(working, { availableUsd, assessedRiskBps });
  if (!bounds.ok) {
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "skipped", reason: bounds.reason });
    return { ok: false, reason: bounds.reason };
  }

  // 4. Split the amount across legs (exact 6dp) and quote each via Arcus.
  const grossMicro = BigInt(Math.round(working.amountUsd * 1_000_000));
  const legs = allocation.allocations.filter((a) => a.weightPct > 0);
  const legAmounts = splitByWeights(grossMicro, legs.map((a) => a.weightPct));
  if (legAmounts.some((v) => v > BigInt(0) && v < MIN_LEG_MICRO)) {
    const reason = "Amount too small to split across the plan's holdings.";
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "skipped", reason });
    return { ok: false, reason };
  }

  const quotes: { symbol: string; amountMicro: bigint; q: Awaited<ReturnType<typeof getQuote>> }[] = [];
  for (let i = 0; i < legs.length; i++) {
    if (legAmounts[i] <= BigInt(0)) continue;
    const asset = assetBySymbol(legs[i].symbol);
    if (!asset) continue; // AI universe is pinned to the registry, but stay safe
    const q = await getQuote(USDG.address as `0x${string}`, asset.address, legAmounts[i], taker);
    // The allocator pre-screens for liquidity, but a maker can pull between the
    // plan and this run. Skip a leg that lost liquidity and invest the rest,
    // rather than failing the whole scheduled run.
    if (!q.liquidityAvailable || !q.tx || !q.toSign) continue;
    quotes.push({ symbol: legs[i].symbol, amountMicro: legAmounts[i], q });
  }
  if (quotes.length === 0) {
    const reason = "No tradable holdings in the plan.";
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "error", reason });
    return { ok: false, reason };
  }

  // 5. Sign + submit. The Privy server wallet signs for the delegated EOA.
  //    ONE Arcus settle per UserOp (mirrors the proven manual path in
  //    useSwap.ts): batching multiple RFQ settles into a single UserOp reverts
  //    with the router's InvalidAction() guard. Each leg is best-effort — a bad
  //    leg is skipped and the rest still invest, rather than losing the whole run.
  let txHash: string;
  const filled: { symbol: string; amountMicro: bigint }[] = [];
  try {
    const { account, smartAccountClient, ownerAccount } = await getServerSmartAccountClient(
      working.walletId,
      taker,
    );

    const relay = async (call: { to: `0x${string}`; data: `0x${string}`; value?: bigint }): Promise<`0x${string}`> => {
      const userOpHash = await smartAccountClient.sendUserOperation({ account, calls: [call] });
      const receipt = await smartAccountClient.waitForUserOperationReceipt({ hash: userOpHash });
      if (!receipt.success) throw new Error(`reverted (tx ${receipt.receipt.transactionHash})`);
      return receipt.receipt.transactionHash as `0x${string}`;
    };

    // One-time USDG -> Permit2 allowance via EIP-2612 permit, its own UserOp
    // (domain verified on-chain: "Global Dollar", version "1").
    const allowance = (await publicClient.readContract({
      address: USDG.address as `0x${string}`,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [taker, PERMIT2],
    })) as bigint;
    if (allowance < grossMicro) {
      const nonce = (await publicClient.readContract({
        address: USDG.address as `0x${string}`,
        abi: parseAbi(["function nonces(address) view returns (uint256)"]),
        functionName: "nonces",
        args: [taker],
      })) as bigint;
      const deadline = BigInt(now + 3600);
      const sig = await ownerAccount.signTypedData({
        domain: { name: "Global Dollar", version: "1", chainId: chain.id, verifyingContract: USDG.address as `0x${string}` },
        types: {
          Permit: [
            { name: "owner", type: "address" },
            { name: "spender", type: "address" },
            { name: "value", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
        },
        primaryType: "Permit",
        message: { owner: taker, spender: PERMIT2, value: MAX_UINT256, nonce, deadline },
      });
      const r = `0x${sig.slice(2, 66)}` as `0x${string}`;
      const s = `0x${sig.slice(66, 130)}` as `0x${string}`;
      const v = parseInt(sig.slice(130, 132), 16);
      await relay({
        to: USDG.address as `0x${string}`,
        data: encodeFunctionData({ abi: PERMIT_ABI, functionName: "permit", args: [taker, PERMIT2, MAX_UINT256, deadline, v, r, s] }),
      });
    }

    // Each leg settles in its own UserOp.
    let lastTx: `0x${string}` | null = null;
    for (const { symbol, amountMicro, q } of quotes) {
      const toSign = q.toSign as {
        domain: Record<string, unknown>;
        types: Record<string, { name: string; type: string }[]>;
        primaryType: string;
        message: Record<string, unknown>;
      };
      const { EIP712Domain: _d, ...types } = toSign.types;
      try {
        const sig = await ownerAccount.signTypedData({
          domain: toSign.domain,
          types,
          primaryType: toSign.primaryType,
          message: toSign.message,
        } as Parameters<typeof ownerAccount.signTypedData>[0]);
        lastTx = await relay({
          to: q.tx!.to,
          data: spliceSignature(q.tx!.data, sig, q.tx!.signatureOffset),
          value: BigInt(q.tx!.value || "0"),
        });
        filled.push({ symbol, amountMicro });
      } catch (legErr) {
        // A single leg failing (lost liquidity, quote lapsed) must not sink the
        // whole run — log and keep going with the rest.
        console.error(`[autopilot] leg ${symbol} failed:`, legErr instanceof Error ? legErr.message : legErr);
      }
    }

    if (filled.length === 0) {
      const reason = "Every holding failed to settle. No funds were moved.";
      await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "error", reason });
      return { ok: false, reason };
    }
    txHash = lastTx as `0x${string}`;

    // Trust layer: Vera signs the risk inference and VeraRecord records it as a
    // final, separate UserOp over what ACTUALLY filled. Best-effort: a failed
    // record does not undo real, settled buys.
    if (INFERENCE_VERIFIER.toLowerCase() !== zeroAddress) {
      try {
        const spentMicro = filled.reduce((s, l) => s + l.amountMicro, BigInt(0));
        const planId = buildPlanId(allocation, now);
        const maxRisk = Math.min(RISK_CEILING_BPS, assessedRiskBps + RISK_HEADROOM_BPS);
        const expiry = BigInt(now + EXPIRY_SECONDS);
        const signature = await signRiskInference({ planId, assessedRisk: assessedRiskBps, maxRisk, expiry });
        await relay({
          to: INFERENCE_VERIFIER,
          data: encodeFunctionData({
            abi: VERA_RECORD_ABI,
            functionName: "record",
            args: [planId, recHash(allocation), assessedRiskBps, maxRisk, expiry, signature, taker, AGENT_ID, spentMicro, BigInt(filled.length)],
          }),
        });
      } catch (recErr) {
        console.error("[autopilot] record failed (buys succeeded):", recErr instanceof Error ? recErr.message : recErr);
      }
    }
  } catch (e) {
    // Never surface raw provider errors: viem embeds the full bundler URL
    // (which carries the Pimlico API key) in e.message. Strip URLs + truncate.
    const raw = e instanceof Error ? e.message : "Submission failed.";
    const reason = raw.replace(/https?:\/\/\S+/g, "[rpc]").slice(0, 240);
    await logRun({ userId: working.userId, ranAt: now, amountUsd: working.amountUsd, assessedRiskBps, status: "error", reason });
    return { ok: false, reason };
  }

  // 6. Persist run accounting + audit log, over what ACTUALLY filled.
  const spentUsd = Math.round((Number(filled.reduce((s, l) => s + l.amountMicro, BigInt(0))) / 1_000_000) * 100) / 100;
  await recordRun(working.userId, {
    lastRunAt: now,
    runs: working.runs + 1,
    spentThisPeriod: working.spentThisPeriod + spentUsd,
  });
  // Inbox note (never breaks the run; addNotification swallows failures).
  await addNotification(working.userId, {
    kind: "autopilot",
    title: `Autopilot invested $${spentUsd.toFixed(2)}`,
    body: "Vera placed your scheduled plan. Tap to see the run.",
    txHash,
    at: now,
  });
  const holdings = filled.map(({ symbol, amountMicro }) => {
    const leg = legs.find((l) => l.symbol === symbol);
    return {
      symbol,
      weightPct: leg?.weightPct ?? 0,
      amountUsd: Math.round((Number(amountMicro) / 1_000_000) * 100) / 100,
    };
  });
  await logRun({ userId: working.userId, ranAt: now, amountUsd: spentUsd, assessedRiskBps, status: "success", txHash, holdings });

  return { ok: true, txHash };
}
