// POST /api/scan — "Scan to Buy" vision inference. A holder photographs any
// product; Vera identifies it and maps it to REAL, explainable connections among
// the listed stock/ETF universe (maker / parent / supplier / component /
// retailer / competitor), each with an integer weight, so the existing invest
// pipeline can act on it.
//
// Holder-gated on the SERVER (the client lock is UX, not security): the caller's
// own embedded Privy EOA — resolved server-side, never client-supplied — must
// hold >= HOLDER_THRESHOLD $MONVERA. Vision runs through the same provider stack
// as allocations (Virtuals compute primary, OpenAI-compatible; see
// lib/server/aiModel.ts), called directly here because we send an image_url data
// URL. VERIFIED 2026-07-14: Virtuals accepts image_url data URLs with
// anthropic-claude-opus-4-8 (tiny/invalid images fail their validation, which is
// fine — real photos pass).
import type { NextRequest } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { chain } from "@/lib/chain";
import { SERVER_RPC_URL } from "@/lib/server/rpc";
import { MONVERA, HOLDER_THRESHOLD, ERC20_MINI_ABI } from "@/lib/monveraToken";
import { STOCKS, ETFS } from "@/lib/tokens";
import { verifyRequest } from "@/lib/server/privyAuth";
import { rateLimit, clientIp } from "@/lib/server/rateLimit";
import { unauthorized, tooManyRequests, jsonError } from "@/lib/server/respond";

export const dynamic = "force-dynamic";

// Client downscales to ~1024px JPEG (~100-300KB); this is a generous ceiling on
// the raw request body so an oversized/abusive upload is rejected before the
// model call. Measured against the data-URL string length (~1 char per byte).
const MAX_IMAGE_BYTES = 2_500_000;
const MODEL_TIMEOUT_MS = 45_000;
const MODEL_MAX_TOKENS = 1200;

// The tradable universe, the same list the model is allowed to map onto. Built
// once at module load; also the validation Set that drops any hallucinated
// symbol and the source of canonical names.
const UNIVERSE = [...STOCKS, ...ETFS];
const UNIVERSE_SYMBOLS = new Set(UNIVERSE.map((a) => a.symbol));
const NAME_BY_SYMBOL = new Map(UNIVERSE.map((a) => [a.symbol, a.name]));
const UNIVERSE_LINES = UNIVERSE.map((a) => `${a.symbol} — ${a.name}`).join("\n");

// The connection kinds Vera is allowed to assert. Anything else the model
// invents is coerced to the closest honest default ("competitor" is the loosest
// real relationship) rather than passed through verbatim.
const CONNECTION_TYPES = new Set(["maker", "parent", "supplier", "component", "retailer", "competitor"]);

const SYSTEM_PROMPT = `You are Vera, an honest investment analyst. You are shown a photo of a real-world product. Your job: identify the product and the brand, then map it to REAL, explainable connections among ONLY the listed companies below.

LISTED COMPANIES (map ONLY to these symbols — nothing else exists to you):
${UNIVERSE_LINES}

RULES:
- Identify the product and brand you see. If you can recognize a product or brand at all, ALWAYS fill "recognized".
- Map to a company only through a real, explainable relationship, using one of these connection types: maker (the company makes this product), parent (owns the maker), supplier (supplies parts/materials), component (its chips/parts are inside), retailer (sells the product), competitor (a direct rival in the same market).
- Return 2 to 6 connections. Do NOT force-fit: only include a company when the relationship is genuine and you can explain it in one honest sentence.
- If the brand's own company is NOT among the listed companies and there is no honest supplier/component/competitor link either, return "connections": [] but STILL fill "recognized".
- Weights are positive integers that sum to exactly 100, reflecting how central each company is to this product.
- "reasoning" is ONE plain, honest sentence per connection. No hype.
- Output ONLY the JSON object, no markdown code fences, no prose before or after.

OUTPUT SHAPE:
{"recognized": {"product": "string", "brand": "string"} | null, "connections": [{"symbol": "TICKER", "name": "Company", "connectionType": "maker", "reasoning": "one sentence", "weight": 60}]}`;

const client = createPublicClient({ chain, transport: http(SERVER_RPC_URL) });

const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

/**
 * The caller's own embedded (Privy) EOA, read from Privy's REST API (same Basic-
 * auth pattern as gas-drip / privyAuth.userOwnsWallet). Matches useActiveWallet():
 * prefer the embedded "privy" wallet, else the first Ethereum wallet. Never trusts
 * a client-supplied address.
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

// ---- Vision provider selection (mirrors lib/server/aiModel.ts priority) ------
// Virtuals compute (primary) and Venice are OpenAI-compatible (/chat/completions,
// Bearer, image_url content). Anthropic (last resort) uses its native /messages
// shape with a base64 image block. aiModel.ts doesn't expose baseURL/key, so we
// re-derive the same env-driven priority here for the raw fetch.
const VIRTUALS_BASE_URL = process.env.VIRTUALS_BASE_URL || "https://compute.virtuals.io/v1";
const VIRTUALS_MODEL = process.env.VIRTUALS_MODEL || "anthropic-claude-opus-4-8";
const VENICE_BASE_URL = process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1";
const VENICE_MODEL = process.env.VENICE_MODEL || "claude-opus-4-7";
const ANTHROPIC_MODEL = process.env.AI_MODEL || "claude-sonnet-4-6";

type VisionProvider =
  | { kind: "openai"; baseURL: string; apiKey: string; model: string }
  | { kind: "anthropic"; apiKey: string; model: string };

function selectVisionProvider(): VisionProvider | null {
  if (process.env.VIRTUALS_API_KEY) {
    return { kind: "openai", baseURL: VIRTUALS_BASE_URL, apiKey: process.env.VIRTUALS_API_KEY, model: VIRTUALS_MODEL };
  }
  if (process.env.VENICE_API_KEY) {
    return { kind: "openai", baseURL: VENICE_BASE_URL, apiKey: process.env.VENICE_API_KEY, model: VENICE_MODEL };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { kind: "anthropic", apiKey: process.env.ANTHROPIC_API_KEY, model: ANTHROPIC_MODEL };
  }
  return null;
}

const USER_TEXT = "Identify this product and map it to listed companies.";

/** Call the vision model and return its raw text response (JSON, possibly fenced). */
async function callVision(provider: VisionProvider, image: string): Promise<string> {
  const signal = AbortSignal.timeout(MODEL_TIMEOUT_MS);

  if (provider.kind === "openai") {
    const res = await fetch(`${provider.baseURL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      signal,
      body: JSON.stringify({
        model: provider.model,
        max_tokens: MODEL_MAX_TOKENS,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: USER_TEXT },
              { type: "image_url", image_url: { url: image } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`vision provider ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error("vision provider returned no content");
    return text;
  }

  // Anthropic native /messages — split the data URL into media type + base64.
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(image);
  if (!match) throw new Error("anthropic path requires a base64 image data URL");
  const [, mediaType, base64] = match;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: provider.model,
      max_tokens: MODEL_MAX_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: USER_TEXT },
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
          ],
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { content?: { type?: string; text?: string }[] };
  const text = json.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("anthropic returned no text content");
  return text;
}

// ---- Defensive parsing / validation -----------------------------------------
interface Recognized {
  product: string;
  brand: string;
}
interface Connection {
  symbol: string;
  name: string;
  connectionType: string;
  reasoning: string;
  weight: number;
}
interface ScanResult {
  recognized: Recognized | null;
  connections: Connection[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/** Pull the first JSON object out of the model text, tolerating ```json fences. */
function extractJson(text: string): unknown {
  let s = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(s);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("no JSON object in model output");
  return JSON.parse(s.slice(start, end + 1));
}

function parseRecognized(raw: unknown): Recognized | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const product = str(r.product);
  const brand = str(r.brand);
  if (!product && !brand) return null;
  return { product, brand };
}

/**
 * Renormalize positive integer weights to sum exactly 100 using the largest-
 * remainder method (keeps every weight >= 1 and the total at 100).
 */
function renormalizeWeights(weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) {
    // No usable signal — split as evenly as possible.
    const base = Math.floor(100 / weights.length);
    const out = weights.map(() => base);
    let rem = 100 - base * weights.length;
    for (let i = 0; rem > 0; i = (i + 1) % weights.length, rem--) out[i] += 1;
    return out;
  }
  const exact = weights.map((w) => (w / total) * 100);
  const floored = exact.map((e) => Math.max(1, Math.floor(e)));
  let diff = 100 - floored.reduce((a, b) => a + b, 0);

  if (diff > 0) {
    // Hand the leftover units to the largest fractional parts.
    const byFrac = exact.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((a, b) => b.frac - a.frac);
    for (let k = 0; diff > 0; k = (k + 1) % byFrac.length, diff--) floored[byFrac[k].i] += 1;
  } else if (diff < 0) {
    // Flooring-to-1 overshot 100 (many sub-1% connections); trim the heaviest
    // weights that still have room to give (never drop below 1).
    const byWeight = floored.map((_, i) => i).sort((a, b) => floored[b] - floored[a]);
    let k = 0;
    while (diff < 0) {
      const idx = byWeight[k % byWeight.length];
      if (floored[idx] > 1) {
        floored[idx] -= 1;
        diff += 1;
      }
      k += 1;
    }
  }
  return floored;
}

function parseConnections(raw: unknown): Connection[] {
  if (!Array.isArray(raw)) return [];
  // Keep only real symbols in the universe; coerce weights to positive integers.
  const cleaned = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const c = item as Record<string, unknown>;
      const symbol = str(c.symbol).toUpperCase();
      if (!UNIVERSE_SYMBOLS.has(symbol)) return null;
      const typeRaw = str(c.connectionType).toLowerCase();
      const connectionType = CONNECTION_TYPES.has(typeRaw) ? typeRaw : "competitor";
      const w = Math.round(Number(c.weight));
      const weight = Number.isFinite(w) && w > 0 ? w : 1;
      return {
        symbol,
        name: NAME_BY_SYMBOL.get(symbol) ?? str(c.name) ?? symbol,
        connectionType,
        reasoning: str(c.reasoning),
        weight,
      };
    })
    .filter((c): c is Connection => c !== null);

  // Dedupe by symbol (keep the higher weight), then cap at the 6 heaviest.
  const bySymbol = new Map<string, Connection>();
  for (const c of cleaned) {
    const prev = bySymbol.get(c.symbol);
    if (!prev || c.weight > prev.weight) bySymbol.set(c.symbol, c);
  }
  const top = [...bySymbol.values()].sort((a, b) => b.weight - a.weight).slice(0, 6);
  if (top.length === 0) return [];

  const normalized = renormalizeWeights(top.map((c) => c.weight));
  return top.map((c, i) => ({ ...c, weight: normalized[i] }));
}

export async function POST(req: NextRequest) {
  const user = await verifyRequest(req);
  if (!user) return unauthorized();

  const limit = rateLimit(`scan:${clientIp(req)}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  // Parse + validate the image payload.
  let image: string;
  try {
    const body = (await req.json()) as { image?: unknown };
    if (typeof body.image !== "string" || !body.image.startsWith("data:image/")) {
      return jsonError(400, "Send a product photo to scan.");
    }
    image = body.image;
  } catch {
    return jsonError(400, "Send a product photo to scan.");
  }
  if (image.length > MAX_IMAGE_BYTES) {
    return jsonError(413, "That image is too large — try a smaller photo.");
  }

  // Server-side holder gate: the caller's own embedded EOA must hold 100k MONVERA.
  const address = await embeddedWalletAddress(user.userId);
  if (!address) return jsonError(400, "No wallet found for your account.");

  let balance: bigint;
  try {
    balance = (await client.readContract({
      address: MONVERA.address,
      abi: ERC20_MINI_ABI,
      functionName: "balanceOf",
      args: [address],
    })) as bigint;
  } catch (err) {
    console.error("[scan]", err);
    return jsonError(502, "Vera couldn't look at that image. Try again.");
  }
  if (balance < HOLDER_THRESHOLD) {
    return jsonError(403, "Hold 100,000 $MONVERA to use Scan to Buy.");
  }

  // Vision inference.
  const provider = selectVisionProvider();
  if (!provider) {
    console.error("[scan]", new Error("no vision provider configured"));
    return jsonError(502, "Vera couldn't look at that image. Try again.");
  }

  try {
    const text = await callVision(provider, image);
    const parsed = extractJson(text) as Record<string, unknown>;
    const result: ScanResult = {
      recognized: parseRecognized(parsed.recognized),
      connections: parseConnections(parsed.connections),
    };
    return Response.json(result);
  } catch (err) {
    console.error("[scan]", err);
    return jsonError(502, "Vera couldn't look at that image. Try again.");
  }
}
