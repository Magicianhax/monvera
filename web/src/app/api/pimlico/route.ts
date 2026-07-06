// Server-side proxy to the Pimlico ERC-4337 bundler + paymaster for Robinhood Chain.
//
// The browser NEVER sees PIMLICO_API_KEY. The smart-account client (lib/aa.ts)
// points its bundler/paymaster transport at this route; we forward the raw
// JSON-RPC body to Pimlico with the key attached and stream the response back.
//
// Hardened: requires a valid Privy session (no open gas-sponsorship relay),
// only forwards whitelisted ERC-4337/paymaster methods, and is rate limited so
// a single account can't burn the paymaster deposit.
import type { NextRequest } from "next/server";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit } from "@/lib/server/rateLimit";
import { unauthorized, badRequest, tooManyRequests, serverError } from "@/lib/server/respond";
import { CHAIN_ID } from "@/lib/chain";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PIMLICO_API_KEY = process.env.PIMLICO_API_KEY;

// H-6: surface misconfiguration at module load (server startup), not first request.
if (!PIMLICO_API_KEY) {
  console.error("[pimlico] PIMLICO_API_KEY is not set — gasless transactions will fail.");
}

// Only the JSON-RPC methods the smart-account stack actually needs. Anything
// else (arbitrary eth_call, eth_sendRawTransaction, etc.) is rejected.
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_supportedEntryPoints",
  "eth_estimateUserOperationGas",
  "eth_sendUserOperation",
  "eth_getUserOperationByHash",
  "eth_getUserOperationReceipt",
  "pimlico_getUserOperationGasPrice",
  "pimlico_getUserOperationStatus",
  "pm_sponsorUserOperation",
  "pm_getPaymasterData",
  "pm_getPaymasterStubData",
]);

function methodsOf(body: unknown): string[] {
  const items = Array.isArray(body) ? body : [body];
  return items.map((it) => (it && typeof it === "object" ? (it as { method?: unknown }).method : undefined))
    .filter((m): m is string => typeof m === "string");
}

export async function POST(req: NextRequest) {
  if (!PIMLICO_API_KEY) return serverError("pimlico", new Error("PIMLICO_API_KEY missing"), 503);

  // Auth: only logged-in Monvera users can have gas sponsored.
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  // Rate limit per user (the bundler is chatty — estimate + sponsor + send +
  // receipt polling — so the ceiling is generous; it's a backstop, not the gate).
  const limit = rateLimit(`pimlico:${user.userId}`, 600, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON-RPC body.");
  }

  // Method allowlist — reject anything outside the AA/paymaster surface.
  const methods = methodsOf(body);
  if (methods.length === 0 || methods.some((m) => !ALLOWED_METHODS.has(m))) {
    return badRequest("Unsupported RPC method.");
  }

  try {
    const upstream = await fetch(`https://api.pimlico.io/v2/${CHAIN_ID}/rpc?apikey=${PIMLICO_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // Pass the JSON-RPC envelope straight through (errors included — the client
    // RPC layer interprets them). Never leak upstream headers.
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return serverError("pimlico", err, 502);
  }
}
