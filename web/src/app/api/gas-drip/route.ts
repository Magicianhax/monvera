// POST /api/gas-drip — one-time ETH dust so a first-time seller can sign the
// single on-chain MONVERA approve the gasless sell needs (MONVERA has no
// EIP-2612, so the smart account can't be granted pull-rights off-chain).
// Authed (Privy session); the dust goes ONLY to the CALLER'S OWN embedded
// wallet, resolved server-side from the session — never a client-supplied
// address. Idempotent (once per wallet via a KV flag), and refused when the
// wallet already has gas or holds no MONVERA to sell.
import type { NextRequest } from "next/server";
import { createPublicClient, createWalletClient, http, parseEther, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA, ERC20_MINI_ABI } from "@/lib/monveraToken";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { unauthorized, tooManyRequests, jsonError, serverError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

// One approve (~50k gas) costs ~0.0000023 ETH at current gas; the drip is ~8
// approves of headroom and the floor is well below one approve's cost.
const DRIP_AMOUNT = parseEther("0.00002");
const GAS_FLOOR = parseEther("0.00001");

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

// KV flag: one drip per address, fleet-wide (same binding pattern as
// wrapperMap/kvCache). Local dev (no CF binding) falls back to a per-process
// Set so the once-per-wallet guard is still testable off Cloudflare.
interface KvNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}
function kv(): KvNamespace | null {
  try {
    const env = getCloudflareContext().env as { KV?: KvNamespace };
    return env.KV ?? null;
  } catch {
    return null; // outside a CF context (local dev, some build steps)
  }
}
const memoryFlags = new Set<string>();

async function getFlag(key: string): Promise<boolean> {
  const store = kv();
  if (store) {
    try {
      return (await store.get(key)) != null;
    } catch {
      /* fall through to memory */
    }
  }
  return memoryFlags.has(key);
}
async function setFlag(key: string): Promise<void> {
  memoryFlags.add(key);
  const store = kv();
  if (store) {
    try {
      await store.put(key, "1");
    } catch {
      /* memory still holds it */
    }
  }
}
async function clearFlag(key: string): Promise<void> {
  memoryFlags.delete(key);
  const store = kv();
  if (store) {
    try {
      await store.delete(key);
    } catch {
      /* best effort */
    }
  }
}

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

/**
 * The caller's own embedded (Privy) EOA, read from Privy's REST API (same Basic-
 * auth pattern as privyAuth.userOwnsWallet). Matches useActiveWallet(): prefer
 * the embedded "privy" wallet, else the first Ethereum wallet. Never trusts a
 * client-supplied address.
 */
async function embeddedWalletAddress(userId: string): Promise<Address | null> {
  if (!PRIVY_APP_ID || !PRIVY_APP_SECRET) return null;
  try {
    const res = await fetch(`https://auth.privy.io/api/v1/users/${encodeURIComponent(userId)}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${PRIVY_APP_ID}:${PRIVY_APP_SECRET}`).toString("base64")}`,
        "privy-app-id": PRIVY_APP_ID,
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      linked_accounts?: { type?: string; address?: string; chain_type?: string; wallet_client_type?: string }[];
    };
    const wallets = (json.linked_accounts ?? []).filter(
      (a) => a.type === "wallet" && a.chain_type === "ethereum" && a.address && isAddress(a.address),
    );
    const embedded = wallets.find((a) => a.wallet_client_type === "privy") ?? wallets[0];
    return embedded?.address ? (embedded.address as Address) : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`gas-drip:${clientIp(req)}`, 5, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  // (a) drip wallet must be configured.
  const dripKey = process.env.GAS_DRIP_PRIVATE_KEY;
  if (!dripKey) return jsonError(503, "drip wallet not configured");

  const address = await embeddedWalletAddress(user.userId);
  if (!address) return jsonError(400, "No wallet found for your account.");

  const flagKey = `gasdrip:${address.toLowerCase()}`;

  try {
    // (b) already dripped — idempotent success.
    if (await getFlag(flagKey)) return Response.json({ dripped: false });

    // (c) already has gas — nothing to do.
    const ethBalance = await client.getBalance({ address });
    if (ethBalance >= GAS_FLOOR) return Response.json({ dripped: false });

    // (d) nothing to sell — the drip only exists to bootstrap a sell approve.
    const monvera = (await client.readContract({
      address: MONVERA.address,
      abi: ERC20_MINI_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
    if (monvera <= BigInt(0)) return jsonError(403, "No $MONVERA to sell.");

    // Claim the flag BEFORE sending — two concurrent requests would otherwise
    // both pass the (b) check and both drip. Roll it back only if the send
    // itself fails, so a genuine failure can be retried.
    await setFlag(flagKey);
    try {
      const account = privateKeyToAccount(dripKey as `0x${string}`);
      const wallet = createWalletClient({ account, chain, transport: http(SERVER_RPC_URL) });
      const txHash = await wallet.sendTransaction({ to: address, value: DRIP_AMOUNT });
      await client.waitForTransactionReceipt({ hash: txHash });
      return Response.json({ dripped: true, txHash });
    } catch (sendErr) {
      await clearFlag(flagKey); // let the user retry a failed drip
      throw sendErr;
    }
  } catch (err) {
    return serverError("gas-drip", err);
  }
}
