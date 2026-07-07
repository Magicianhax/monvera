import { createPublicClient, http } from "viem";
import { chain, RPC_URL, CHAIN_ID, EXPLORER_URL } from "@/lib/chain";
import { INFERENCE_VERIFIER } from "@/lib/tokens";
import { INFERENCE_VERIFIER_ABI } from "@/lib/abis";
import { VERA } from "@/lib/veraData";

// GET /.well-known/agent-card.json — Vera's ERC-8004 discovery document, served
// dynamically so agents and crawlers read LIVE identity: her agentId and registry
// from chain config, and her on-chain agent signer read straight from the
// InferenceVerifier. It replaces the former static public/ file. On-chain reads
// are best-effort; if the verifier is not yet deployed or the RPC hiccups we fall
// back to the last-known signer and never fail the request.
export const dynamic = "force-dynamic";

const ZERO = "0x0000000000000000000000000000000000000000";

const AGENT_ID = Number(process.env.NEXT_PUBLIC_STAX_AGENT_ID || "1");
const IDENTITY_REGISTRY = (
  process.env.NEXT_PUBLIC_IDENTITY_REGISTRY || "0x51ed96d67b175edacf475622b4abc2221f368cbb"
).toLowerCase();

// Last-known agent signer, used only if the on-chain read is unavailable.
const FALLBACK_SIGNER = "0xe532105523d4eD559c3a53E3E82D616bE1a085c5";

const client = createPublicClient({ chain, transport: http(RPC_URL) });

async function readAgentSigner(): Promise<string> {
  if (INFERENCE_VERIFIER.toLowerCase() === ZERO) return FALLBACK_SIGNER;
  try {
    const signer = await client.readContract({
      address: INFERENCE_VERIFIER,
      abi: INFERENCE_VERIFIER_ABI,
      functionName: "agentSigner",
    });
    return signer as string;
  } catch {
    return FALLBACK_SIGNER;
  }
}

export async function GET() {
  const agentSigner = await readAgentSigner();
  const registryLive = IDENTITY_REGISTRY !== ZERO;

  const card = {
    name: VERA.name,
    description:
      "AI broker for real tokenized stocks on Robinhood Chain. You tell Vera a goal in plain words; she builds a diversified portfolio of tokenized stocks (traded via the Arcus spot RFQ venue), signs every recommendation with EIP-712, and places it gasless (ERC-4337). Autopilot runs the strategy on a schedule inside hard user-set bounds: amount, cadence, risk ceiling, spend cap. Every run is checked against those limits before anything signs. Non-custodial; the user holds the tokens.",
    image: "https://monvera.best/icon-512.png",
    active: true,
    persona: {
      role: VERA.role,
      blurb: VERA.blurb,
    },
    services: {
      web: { url: "https://monvera.best" },
    },
    endpoints: {
      app: "https://monvera.best",
      agent: "https://monvera.best/agent",
      strategies: "https://monvera.best/api/strategies",
    },
    supportedTrust: ["reputation"],
    skills: [
      "portfolio-allocation",
      "plain-language-allocation",
      "dca-autopilot",
      "trading-strategy",
      "risk-management",
    ],
    domains: ["finance", "investing", "real-world-assets"],
    x402: false,
    registrations: [
      {
        agentId: 58228,
        agentRegistry: "eip155:8453:0x8004a169fb4a3325136eb29fa0ceb6d2e539a432",
        note: "Canonical ERC-8004 identity, registered via Virtuals ACP. Registration file: https://api.acp.virtuals.io/agents/019f2d81-921d-7951-a4f7-50f9d228c47b/erc8004",
      },
    ],
    metadata: {
      version: "2.3",
      chain: "robinhood-chain",
      chainId: CHAIN_ID,
      app: "https://monvera.best",
      demo: "https://monvera.best/demo",
      agentPage: "https://monvera.best/agent",
      explorer: EXPLORER_URL,
      identityRegistry: registryLive ? IDENTITY_REGISTRY : null,
      agentId: AGENT_ID,
      agentSigner,
      note: "Vera holds this agentId in Monvera's IdentityRegistry on Robinhood Chain, plus canonical ERC-8004 identity 8453:58228 on Base (registry 0x8004a169fb4a3325136eb29fa0ceb6d2e539a432, via Virtuals ACP). Every recommendation carries her EIP-712 RiskInference signature, verified and permanently recorded by the VeraRecord contract in the same transaction as the trades. Values here are read live from chain config; agentSigner is read from the InferenceVerifier on-chain.",
    },
  };

  return Response.json(card, {
    headers: {
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=21600",
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
