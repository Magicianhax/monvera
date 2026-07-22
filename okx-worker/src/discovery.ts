// Discovery surfaces: GET / catalog, /llms.txt, /llms-full.txt, /openapi.json,
// /.well-known/x402.json. EVERYTHING here renders from the live source of
// truth — PRICES + challengeEntryFor (x402.ts), PARAM_SPECS (precheck.ts),
// OKX_SWAP_PARAMS + SUGGESTED_SLIPPAGE_PERCENT (legs.ts), UNIVERSE/BASKETS —
// so no artifact can drift from what the gate actually charges or accepts.
import type { Env } from "./env";
import { PRICES, PAID_ROUTES, challengeEntryFor, signingContract, CHALLENGE_TTL_SECONDS, USDT0_XLAYER, XLAYER_NETWORK } from "./x402";
import { PARAM_SPECS } from "./precheck";
import { SUGGESTED_SLIPPAGE_PERCENT } from "./legs";
import { UNIVERSE, USDC_SOL_MINT } from "./universe";
import { BASKETS } from "./baskets";
import { BASE_URL, DOCS_URL, PREREQUISITES } from "./respond";

const RECORD_CONTRACT = "0xd97cd1a25484252bf234ab384c3818b05e6594e0";
const FEE_DISCLOSURE_DATE = "2026-07-20";

// ── all-in fee math (computed, never hand-written) ───────────────────────────
function allInPct(callFeeUsd: number, orderUsd: number, withSlippage = false): string {
  const slippage = withSlippage ? orderUsd * (Number(SUGGESTED_SLIPPAGE_PERCENT) / 100) : 0;
  return (((callFeeUsd + slippage) / orderUsd) * 100).toFixed(2);
}

function feeSchedule() {
  return {
    principle: "Flat per-call pricing: percentage cost falls with order size; below ~$50/order the drag is real.",
    examples: [50, 250, 1000].map((orderUsd) => ({
      orderUsd,
      basketAllInPct: allInPct(PRICES.basket, orderUsd),
      planAllInPct: allInPct(PRICES.plan, orderUsd),
    })),
    slippageCost: `The suggested ${SUGGESTED_SLIPPAGE_PERCENT}% per-leg slippage tolerance is a cost cap you set, not a fee we charge; at full tolerance the worst-case all-in on a $1,000 basket is ~${allInPct(PRICES.basket, 1000, true)}%.`,
    suggestedMinOrderUsd: 100,
  };
}

function costsBlock() {
  return {
    perCall: "See services[].priceUsd — flat, per call, in USDT0. This is the ONLY fee Vera charges: no execution fees, no spread markup, no percentage of your order.",
    feeSchedule: feeSchedule(),
  };
}

// ── GET / catalog ────────────────────────────────────────────────────────────
export function catalog(env: Env): Record<string, unknown> {
  return {
    name: "Vera — AI Stock Broker",
    description:
      "AI research and allocation plans over real tokenized stocks (xStocks on Solana). Pay per call in USDT0 on X Layer. Non-custodial: your own wallet executes every trade.",
    universe: UNIVERSE.length,
    services: [
      { path: "GET /v1/universe", priceUsd: 0, what: "Full tradable universe: symbol, name, underlying, Solana mint", queryExample: `GET ${BASE_URL}/v1/universe` },
      { path: "GET /v1/quote/:symbol", priceUsd: 0, what: "Live quote + liquidity snapshot for one xStock", queryExample: `GET ${BASE_URL}/v1/quote/AAPLx` },
      { path: "POST /v1/quote", priceUsd: 0, what: "Free indicative quote (query or body)", queryExample: `POST ${BASE_URL}/v1/quote?symbol=AAPLx` },
      { path: "GET /v1/preflight", priceUsd: 0, what: "Execution-funding check (USDC + SOL on Solana) — run BEFORE paying", queryExample: `GET ${BASE_URL}/v1/preflight?wallet=<solana-addr>&amountUsd=100` },
      { path: "GET /v1/record/{planId}", priceUsd: 0, what: "Verify an on-chain commitment via used(planId)", queryExample: `GET ${BASE_URL}/v1/record/0x...` },
      { path: "POST /v1/build/stage", priceUsd: 0, what: "Stage an external plan JSON free -> query-safe planId (<=8 KB)", queryExample: `POST ${BASE_URL}/v1/build/stage (JSON body)` },
      { path: "POST /v1/plan", priceUsd: PRICES.plan, what: "Goal + budget + risk -> weighted allocation with rationale, 1Y backtest AND executable legs included", queryExample: PARAM_SPECS["/v1/plan"].queryExample },
      { path: "POST /v1/research", priceUsd: PRICES.research, what: "Research note on one tokenized stock", queryExample: PARAM_SPECS["/v1/research"].queryExample },
      { path: "POST /v1/halal-screen", priceUsd: PRICES.halalScreen, what: "AAOIFI shariah screen with reasons (analysis, not a fatwa)", queryExample: PARAM_SPECS["/v1/halal-screen"].queryExample },
      { path: "POST /v1/basket/:id", priceUsd: PRICES.basket, what: "Themed basket allocation with executable legs included", baskets: Object.keys(BASKETS), queryExample: PARAM_SPECS["/v1/basket"].queryExample },
      { path: "POST /v1/build", priceUsd: PRICES.build, what: "EXTERNAL/edited plan -> per-leg swap instructions (plan and basket already include legs)", queryExample: PARAM_SPECS["/v1/build"].queryExample },
      { path: "POST /v1/backtest", priceUsd: PRICES.backtest, what: "1-year backtest of any weighted basket vs SPY. Backtests are history, not promises.", queryExample: PARAM_SPECS["/v1/backtest"].queryExample },
      { path: "POST /v1/screener", priceUsd: PRICES.screener, what: "Momentum screener over the full universe", queryExample: PARAM_SPECS["/v1/screener"].queryExample },
      { path: "POST /v1/compare", priceUsd: PRICES.compare, what: "Head-to-head note on two stocks", queryExample: PARAM_SPECS["/v1/compare"].queryExample },
      { path: "POST /v1/rebalance", priceUsd: PRICES.rebalance, what: "Holdings + target -> minimal diff legs", queryExample: PARAM_SPECS["/v1/rebalance"].queryExample },
    ],
    payment: {
      protocol: "x402 v2",
      how: "Call a paid endpoint without payment and it returns HTTP 402 with the full challenge (base64 JSON) in the PAYMENT-REQUIRED response header AND decoded in the body with a complete signing schema. Sign the EIP-3009 authorization, retry the same URL with the PAYMENT-SIGNATURE header, and the result is returned in that response.",
      network: `${XLAYER_NETWORK} (X Layer)`,
      assets: [`USDT0 ${USDT0_XLAYER} (6 decimals)`],
      payTo: env.PAY_TO_ADDRESS,
      scheme: "exact",
      gasless: "EIP-3009 transfer-with-authorization; the buyer pays no gas.",
      challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
      okxTooling: `onchainos: payment quote "${BASE_URL}/v1/basket/halal?amountUsd=100" --method POST, then payment pay --payment-id <id> --selected-index 0 --yes`,
    },
    transport: {
      rule: "Every business param rides the URL query string on every endpoint; JSON bodies are also accepted and merged (body keys win). Some buyer CLIs (onchainos) drop replayed POST bodies — the query string is the only carrier that always survives.",
      arrayEncoding: "CSV scalars: symbols=AAPLx,MSFTx · weights=60,40 · holdings=SYM:usd,... · target=SYM:pct,...",
      nestedPlans: "Use planId (from a purchase or free POST /v1/build/stage) — nested JSON cannot ride a query string.",
      resourceBinding: "Payment binds route path + amount + asset + payTo, not the query string. Probe bare, retry with ?params appended.",
      quoteExpirySeconds: 300,
      challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
      propagationNote: "A planId bought seconds ago can take up to ~60 s to become readable everywhere; PLAN_NOT_FOUND errors carry retryAfterSeconds.",
    },
    prerequisites: PREREQUISITES,
    costs: costsBlock(),
    pricing: {
      changelog: [
        {
          date: "2026-07-23",
          change:
            "Per-call fees cut: plan $0.50->$0.15, basket & rebalance $0.35->$0.08, compare $0.30->$0.05, research/halal-screen/build/backtest/screener $0.25->$0.03. Quote stays free.",
        },
        {
          date: FEE_DISCLOSURE_DATE,
          change: "Pricing published: flat per-call fees only. Any future change will be dated here.",
        },
      ],
    },
    guarantees: {
      validation: "Malformed requests fail 400 BEFORE the payment gate — a 400 can never charge you, and your EIP-3009 authorization is not consumed.",
      redelivery: "Retrying with the same PAYMENT-SIGNATURE within 24 h returns your purchased result free (settlement is skipped — recorded server-side before the engine runs).",
      refunds: {
        when: "Charged 5xx still failing after 24 h of retries",
        how: `Quote the paymentId from the error body at ${DOCS_URL}`,
        asset: "USDT0 on X Layer to the paying address",
        slaHours: 72,
      },
      duplicates: "Byte-identical repeat purchases return identical content; at the same size the on-chain record dedupes. Re-fetch free with your original signature instead of re-buying.",
    },
    record: {
      contract: RECORD_CONTRACT,
      boundary: "A commitment proves Vera signed the recommendation before delivery. It does not prove the buyer executed, that fills matched, or that the plan performed. Track record = recommendations, not results.",
      verify: `GET ${BASE_URL}/v1/record/{planId} (used(planId) view; X Layer eth_getLogs is unreliable)`,
    },
    disclaimers: {
      advice: "Not investment advice.",
      backtests: "Backtests are history, not promises.",
      quotes: "All quotes are indicative and expire in ~5 minutes.",
      halal: "AAOIFI-based screening from latest available public financials; data recency varies; analysis, not a fatwa.",
    },
    agent: { id: "6711", name: "Vera by Monvera", marketplace: "okx.ai", trackRecordContract: `${RECORD_CONTRACT} (X Layer)` },
    discovery: {
      llms: "/llms.txt",
      llmsFull: "/llms-full.txt",
      openapi: "/openapi.json",
      wellKnown: "/.well-known/x402.json",
      record: "/v1/record/{planId}",
      preflight: "/v1/preflight",
      docs: DOCS_URL,
    },
    trust: "Every paid plan is committed on-chain (X Layer) with a signature binding the payer, spend and legs. Track record is publicly auditable at the contract above.",
  };
}

// ── /llms.txt ────────────────────────────────────────────────────────────────
export function llmsTxt(env: Env): string {
  const feeSched = feeSchedule();
  const ex = (o: number) => feeSched.examples.find((e) => e.orderUsd === o);
  return `# Vera by Monvera

> Pay-per-call AI stock research and allocation over real tokenized stocks (xStocks on
> Solana). Payment: x402 v2 in USDT0 on X Layer, gasless EIP-3009. Non-custodial: your
> own wallet executes every trade. On-chain track record: VeraRecordV2 on X Layer.
> Not investment advice. Backtests are history, not promises.

Base URL: ${BASE_URL} · Agent #6711 on okx.ai
Docs: ${DOCS_URL}

## Services

Free:
- GET  /                      — machine-readable catalog (costs, prerequisites, discovery links)
- GET  /v1/universe           — all ${UNIVERSE.length} tradable assets (symbol, name, underlying, mint) + basket ids
- GET  /v1/quote/{symbol}     — indicative quote (also POST /v1/quote?symbol=AAPLx).
                                Quotes expire ~5 min; no depth guarantee.
- GET  /v1/preflight?wallet=<solana-addr>&amountUsd=100
                              — checks your USDC + SOL balances BEFORE you pay for a plan
- GET  /v1/record/{planId}    — verify an on-chain commitment (used(planId) view, not logs)
- POST /v1/build/stage        — stage an external plan JSON free; returns a planId usable
                                via pure query string (body <= 8 KB)

Paid (x402, price per call in USDT0):
- POST /v1/plan        $${PRICES.plan}  goal -> weighted allocation + 1Y backtest + executable legs
                              e.g. /v1/plan?goal=steady%20growth&amountUsd=200&riskTolerance=balanced
- POST /v1/basket/{id} $${PRICES.basket}  themed basket + legs. e.g. /v1/basket/halal?amountUsd=100
                              (basket ids: ${Object.keys(BASKETS).join(", ")}; also /v1/basket?basket=<id>)
- POST /v1/research    $${PRICES.research}  ?symbol=AAPLx
- POST /v1/halal-screen $${PRICES.halalScreen} ?symbols=AAPLx,MSFTx — AAOIFI-based screen; methodology and
                              data-recency note included; analysis, not a fatwa
- POST /v1/compare     $${PRICES.compare}  ?symbolA=AAPLx&symbolB=MSFTx&goal=optional
- POST /v1/backtest    $${PRICES.backtest}  ?symbols=AAPLx,NVDAx&weights=60,40 (or JSON allocations[]).
                              Backtests are history, not promises.
- POST /v1/screener    $${PRICES.screener}  no params
- POST /v1/rebalance   $${PRICES.rebalance}  ?holdings=AAPLx:120,MSFTx:80&target=AAPLx:60,NVDAx:40&cashUsd=50
- POST /v1/build       $${PRICES.build}  external/edited plan -> legs. Three forms:
                              ?planId=0x...&amountUsd=40  (plans/baskets you bought, or staged ids)
                              ?symbols=AAPLx,NVDAx&weights=60,40&amountUsd=40  (pure scalars)
                              JSON body { plan, amountUsd }  (raw curl)
                              NOTE: /v1/plan and /v1/basket already include legs — do not pay twice.

## Payment flow (x402 v2)

1. PROBE: request the paid URL with no payment header. Any method works. You get HTTP 402
   with the challenge as base64 JSON in the PAYMENT-REQUIRED response header (also decoded
   in the JSON body under "x402", with a "signing" schema).
2. Pick accepts[0]: scheme "exact", network "${XLAYER_NETWORK}" (X Layer),
   asset USDT0 ${USDT0_XLAYER} (6 decimals),
   payTo ${env.PAY_TO_ADDRESS}.
3. SIGN EIP-3009 TransferWithAuthorization (EIP-712):
   domain = { name: "USD₮0", version: "1", chainId: 196,
              verifyingContract: ${USDT0_XLAYER} }
   types  = TransferWithAuthorization { from address, to address, value uint256,
            validAfter uint256, validBefore uint256, nonce bytes32 }
   values = from: your address · to: payTo · value: accepts[0] amount (base units, 6dp)
            validAfter: 0 · validBefore: now + maxTimeoutSeconds (${CHALLENGE_TTL_SECONDS})
            nonce: 32 random bytes (NEVER reuse a nonce)
4. RETRY the same URL with header
   PAYMENT-SIGNATURE: base64(JSON { "x402Version": 2,
     "accepted": <accepts[0] copied VERBATIM from the PAYMENT-REQUIRED challenge —
                  do not add, remove or reorder keys>,
     "payload": { "authorization": { from, to, value, validAfter, validBefore, nonce },
                  "signature": "0x..." },
     "resource": <the challenge's resource object> })
   The 402 body's signing.template shows this filled in. The "accepted" copy is
   matched byte-for-byte against the server's requirements — a modified copy fails
   with "No matching payment requirements".
5. The product returns in that response; the settlement receipt is in the
   PAYMENT-RESPONSE header and paymentId appears in the JSON body.

BINDING RULE: the payment binds route path + amount + asset + payTo from the challenge —
NOT the query string. Probing a bare URL and retrying with ?params appended is safe.
CHALLENGE EXPIRY: ~${CHALLENGE_TTL_SECONDS} s. Late signature => 402 code CHALLENGE_EXPIRED. Re-probe the URL
for a fresh challenge and sign again with a NEW nonce.
REPLAY RIGHTS: for 24 h, retrying with the SAME PAYMENT-SIGNATURE returns your purchased
result free (settlement is skipped — this is also the recovery path for dropped
connections and charged 5xx errors).
REPEAT PURCHASES: byte-identical content re-bought at the same size yields identical
output and a deduplicated on-chain record. Re-fetch free with your original signature.

## Transport rules (hard-won; violating these loses real requests)

- ALL business params ride the URL QUERY STRING on every endpoint. JSON bodies are also
  accepted and merged (body keys win), but some buyer CLIs (onchainos) silently DROP the
  replayed POST body — the query string is the only carrier that always survives.
- Array params have scalar CSV encodings: symbols=AAPLx,MSFTx · weights=60,40 ·
  holdings=AAPLx:120,MSFTx:80 · target=AAPLx:60,NVDAx:40.
  Nested plan JSON cannot ride a query string: use planId or POST /v1/build/stage.
- Malformed signed requests fail HTTP 400 BEFORE the payment gate: "... Nothing was
  charged." Your EIP-3009 authorization is NOT consumed — fix the params and retry with
  the same signature.
- If /v1/build?planId=... returns PLAN_NOT_FOUND seconds after purchase: storage
  propagation can take up to ~60 s across regions. Retry after the retryAfterSeconds
  given in the error body.

## Funding prerequisites (two different chains — check BEFORE paying)

- Paying Vera: USDT0 on X Layer (${XLAYER_NETWORK}). Gasless — you sign, the broker settles.
- Executing legs: USDC (${USDC_SOL_MINT}) PLUS SOL for tx
  fees, on Solana, in the wallet that executes.
  Preflight: GET /v1/preflight?wallet=<addr>&amountUsd=<usd>

## Cost stack (all-in, honest)

- The per-call fee (above) is THE ONLY FEE Vera charges. No execution fees, no spread
  markup, no percentage of your order. Every pricing change is dated in GET / under
  pricing.changelog.
- Worked math, basket ($${PRICES.basket}): $50 order ≈ ${ex(50)?.basketAllInPct}% all-in · $250 ≈ ${ex(250)?.basketAllInPct}% ·
  $1,000 ≈ ${ex(1000)?.basketAllInPct}%. Plan ($${PRICES.plan}): ${ex(50)?.planAllInPct}% / ${ex(250)?.planAllInPct}% / ${ex(1000)?.planAllInPct}%. Flat pricing favors size; below
  ~$50/order the drag is real. Suggested minimum order: $${feeSched.suggestedMinOrderUsd}.
- Slippage is a cost you control: the suggested ${SUGGESTED_SLIPPAGE_PERCENT}% per-leg tolerance is a cap you
  set, not a fee we charge. At full tolerance the worst-case all-in on a $1,000 basket
  is ≈ ${allInPct(PRICES.basket, 1000, true)}%.

## Execution runbook (Solana, OKX DEX v6)

Reality: the OKX DEX aggregator API requires an OKX Web3 developer API key (free at the
web3.okx.com developer portal; requests carry OK-ACCESS-KEY / OK-ACCESS-SIGN /
OK-ACCESS-TIMESTAMP / OK-ACCESS-PASSPHRASE). No key? Execute through tooling that carries
one (OKX Agentic Wallet, onchainos) — legs are plain quote+swap instructions.

APPROVAL MODEL: ask your user ONCE to approve the basket's total spend, then execute all
legs back-to-back with no further prompts. Per-leg approval is not required — the
confirm-between-legs step below is on-chain failure protection, not a user prompt.
(True multi-swap bundling into one Solana tx is impractical: an aggregator-routed swap
nearly fills the 1232-byte tx limit on its own.)

Per leg, IN ORDER (never quote all legs upfront — quotes go stale in ~5 min):
1. QUOTE  GET https://web3.okx.com/api/v6/dex/aggregator/quote
          ?chainIndex=501&fromTokenAddress=<tokenIn>&toTokenAddress=<tokenOut>&amount=<amountIn>
2. BUILD  GET .../api/v6/dex/aggregator/swap — same params + userWalletAddress +
          slippagePercent=${SUGGESTED_SLIPPAGE_PERCENT}   (the param is slippagePercent, NOT "slippage")
3. SIGN + BROADCAST: returned Solana tx bytes are BASE58-encoded. Deserialize, sign with
   your wallet, broadcast, await confirmation.
4. Confirm, then move to the next leg.

Facts: xStocks are Token-2022 tokens (program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb)
— use the Token-2022 ATA. Every leg >= $1 (dust floor pre-enforced). minOut is null BY
DESIGN: quotes expire, Vera cannot bind it — set slippagePercent yourself; executing
without it exposes you to sandwich MEV. You build the tx, you set protection, you own the
outcome.
LEG FAILURE MID-SEQUENCE: legs are independent USDC->stock buys with fixed per-leg
amounts. A failure at leg N leaves 1..N-1 correctly filled and N..end unexecuted. Safe to
stop. To resume: re-quote and execute ONLY the remaining legs; never re-execute a filled
leg. Nothing needs rebuilding.

## Verification (trust, with boundaries)

Every paid /v1/plan and /v1/basket is committed to VeraRecordV2
${RECORD_CONTRACT} on X Layer (EIP-712-signed; binds planId,
recHash, risk, payer, usdSpent, legCount).
- CHECK: GET /v1/record/{planId} -> { committed, txHash } — served from the contract's
  used(planId) view. Do NOT trust eth_getLogs on public X Layer RPC (unreliable).
- RECOMPUTE YOURSELF: recHash = keccak256(utf8(JSON.stringify(response.plan))) — the
  response's plan object exactly as received. planId = keccak256( payer(20 bytes) ‖
  recHash(32 bytes) ‖ usdSpent as 32-byte big-endian uint (usd * 1e6) ). A match proves
  the on-chain record binds THIS recommendation.
- WHAT A COMMITMENT PROVES: Vera signed this exact recommendation for this payer at this
  spend before delivering it. It does NOT prove the buyer executed, that fills matched,
  or that the plan performed. Track record = recommendations, not results.
- Only /v1/plan and /v1/basket record; other endpoints return record.status
  "not-recorded" by design. Identical content at identical size returns status
  "duplicate" — VeraRecordV2 counts recommendations, not purchases.

## Errors & guarantees

- 400: your input. Body carries fields[] and a corrected copy-pasteable hint URL.
  "Nothing was charged" — a 400 can never charge you.
- 402: pay. Body: decoded challenge + signing schema + how[] steps.
  code CHALLENGE_EXPIRED => re-probe this URL for a fresh challenge, new nonce.
- 404: unknown symbol/basket/planId; hint names the free listing endpoint.
  PLAN_NOT_FOUND may be propagation — retry per retryAfterSeconds.
- 502 with charged:true: you paid, the engine failed. Your settlement was recorded BEFORE
  the engine ran: retry the identical request with the SAME PAYMENT-SIGNATURE —
  settlement is skipped and the result regenerated free. Still failing after 24 h: quote
  the paymentId from the error body at ${DOCS_URL} —
  we verify it against our payment ledger and refund the full call price in USDT0 on
  X Layer to the paying address within 72 hours.
- Payments are otherwise final (no protocol-level refunds). Quotes are indicative.
  Not investment advice. Backtests are history, not promises.

## Optional

- OpenAPI: ${BASE_URL}/openapi.json
- x402 manifest: ${BASE_URL}/.well-known/x402.json
- Worked curl transcripts: ${BASE_URL}/llms-full.txt
- Docs: ${DOCS_URL}
`;
}

// ── /llms-full.txt — runbook + one worked transcript per paid endpoint ───────
export function llmsFullTxt(env: Env): string {
  const transcripts = Object.entries(PAID_ROUTES)
    .map(([path, key]) => {
      const spec = PARAM_SPECS[path];
      const entry = challengeEntryFor(path, env.PAY_TO_ADDRESS);
      const url = spec?.queryExample.replace(/^POST /, "") ?? `${BASE_URL}${path}`;
      return `### Worked transcript: ${path} ($${PRICES[key]})
$ curl -si -X POST "${url}"
HTTP/2 402
payment-required: eyJ4NDAyVmVyc2lvbiI6Mi...   <- base64; decode it
{ "error":"Payment required", "x402":{ "accepts":[{ "scheme":"exact",
  "network":"${XLAYER_NETWORK}", "amount":"${entry?.amount}", "asset":"${USDT0_XLAYER}",
  "payTo":"${env.PAY_TO_ADDRESS}", "maxTimeoutSeconds":${CHALLENGE_TTL_SECONDS}, "decimals":6,
  "extra":{"name":"USD₮0","version":"1"} }] }, "signing":{ ...domain/types/template... } }
# sign EIP-3009 per signing{}, then:
$ curl -si -X POST "${url}" \\
    -H "PAYMENT-SIGNATURE: <base64 per signing.template>"
HTTP/2 200
payment-response: ...
{ ...product..., "costs":{...}, "record":{...}, "paymentId":"..." }`;
    })
    .join("\n\n");
  return llmsTxt(env) + "\n\n---\n\n# Worked transcripts (per endpoint)\n\n" + transcripts + "\n";
}

// ── /openapi.json ────────────────────────────────────────────────────────────
export function openapi(env: Env): Record<string, unknown> {
  const errRefs = {
    "400": { $ref: "#/components/responses/Err400" },
    "402": { $ref: "#/components/responses/Err402" },
    "502": { $ref: "#/components/responses/Err502" },
  };
  const paidPath = (path: string, key: keyof typeof PRICES, summary: string, extraResponses: Record<string, unknown> = {}) => {
    const spec = PARAM_SPECS[path];
    const entry = challengeEntryFor(path, env.PAY_TO_ADDRESS);
    return {
      post: {
        summary: `$${PRICES[key]} — ${summary}`,
        parameters: (spec?.fields ?? [])
          .filter((f) => !f.type.includes("object"))
          .map((f) => ({
            name: f.name,
            in: "query",
            required: f.required && !spec?.requiredAnyOf,
            schema: { type: f.type.startsWith("number") ? "number" : "string", ...(f.enum ? { enum: f.enum } : {}) },
            description: f.description,
            ...(f.example ? { example: f.example } : {}),
          })),
        responses: { "200": { description: `${summary} + envelope (costs, prerequisites, record, paymentId)` }, ...errRefs, ...extraResponses },
        "x-x402": { priceUsd: PRICES[key], accepts: entry ? [entry] : [], outputSchema: entry?.outputSchema },
      },
    };
  };
  return {
    openapi: "3.1.0",
    info: {
      title: "Vera by Monvera",
      version: "2026-07-20",
      description:
        "Pay-per-call AI stock services over tokenized xStocks (Solana). x402 v2 payment in USDT0 on X Layer. Non-custodial. Not investment advice. Backtests are history, not promises. Agent runbook: /llms.txt",
      contact: { url: DOCS_URL },
    },
    servers: [{ url: BASE_URL }],
    "x-x402": {
      version: 2,
      network: XLAYER_NETWORK,
      asset: {
        symbol: "USDT0",
        address: USDT0_XLAYER,
        decimals: 6,
        eip712Domain: { name: "USD₮0", version: "1", chainId: 196, verifyingContract: USDT0_XLAYER },
      },
      payTo: env.PAY_TO_ADDRESS,
      challengeTtlSeconds: CHALLENGE_TTL_SECONDS,
      resourceBinding: "Payment binds route path + amount + asset + payTo — not the query string. Probe bare, retry with ?params appended.",
      replay: "Same PAYMENT-SIGNATURE within 24 h returns the purchased result free (settlement skipped).",
      flow: [
        "probe URL (any method) -> 402 + PAYMENT-REQUIRED header (base64 JSON)",
        "sign EIP-3009 TransferWithAuthorization for accepts[0] (see body signing{})",
        "retry same URL with PAYMENT-SIGNATURE header; receipt in PAYMENT-RESPONSE",
      ],
      signing: signingContract("<amount>", env.PAY_TO_ADDRESS),
    },
    paths: {
      "/": { get: { summary: "Service catalog", responses: { "200": { description: "Catalog: services, payment, transport, costs, prerequisites, pricing.changelog, guarantees, discovery" } } } },
      "/v1/universe": { get: { summary: "Tradable universe + basket ids", responses: { "200": { description: "assets[{symbol,name,underlying,mint}], baskets[]" } } } },
      "/v1/quote/{symbol}": {
        get: {
          summary: "Free indicative quote",
          parameters: [{ name: "symbol", in: "path", required: true, schema: { type: "string" }, example: "AAPLx" }],
          responses: { "200": { description: "Indicative quote; expires ~5 min; no depth guarantee" }, "404": { $ref: "#/components/responses/Err404" } },
        },
      },
      "/v1/quote": {
        post: {
          summary: "Free quote (query or body)",
          parameters: [{ name: "symbol", in: "query", required: true, schema: { type: "string" }, example: "AAPLx" }],
          responses: { "200": { description: "Indicative quote" }, "400": { $ref: "#/components/responses/Err400" }, "404": { $ref: "#/components/responses/Err404" } },
        },
      },
      "/v1/preflight": {
        get: {
          summary: "Free execution-funding check (do this BEFORE paying)",
          parameters: [
            { name: "wallet", in: "query", required: true, schema: { type: "string" }, description: "Solana address that will execute legs" },
            { name: "amountUsd", in: "query", required: false, schema: { type: "number" }, example: 100 },
          ],
          responses: { "200": { description: "{wallet, usdcBalance, solBalance, sufficient, hints[]}" }, "400": { $ref: "#/components/responses/Err400" } },
        },
      },
      "/v1/record/{planId}": {
        get: {
          summary: "Free on-chain commitment check via used(planId)",
          description: "Proves Vera signed this recommendation pre-delivery. Does NOT prove execution, fills, or performance.",
          parameters: [{ name: "planId", in: "path", required: true, schema: { type: "string", pattern: "^0x[0-9a-f]{64}$" } }],
          responses: { "200": { description: "{planId, committed, txHash?, contract, explorer, boundary}" }, "404": { $ref: "#/components/responses/Err404" } },
        },
      },
      "/v1/build/stage": {
        post: {
          summary: "Free: stage an external plan JSON, get a query-safe planId",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/Allocation" } } } },
          responses: {
            "200": { description: "{planId:'ext-...', expiresAt, next:{method,url,priceUsd}}" },
            "400": { $ref: "#/components/responses/Err400" },
            "413": { description: "Body over 8 KB" },
            "429": { description: "Rate limited" },
          },
        },
      },
      "/llms.txt": { get: { summary: "Agent runbook (markdown)", responses: { "200": { description: "text/markdown" } } } },
      "/llms-full.txt": { get: { summary: "Runbook + worked payment transcripts per endpoint", responses: { "200": { description: "text/markdown" } } } },
      "/.well-known/x402.json": { get: { summary: "x402 seller manifest (accepts identical to live 402s)", responses: { "200": { description: "{x402Version:2, resources[]}" } } } },
      "/v1/plan": paidPath("/v1/plan", "plan", "goal -> allocation + 1Y backtest + executable legs (commits to VeraRecordV2)"),
      "/v1/research": paidPath("/v1/research", "research", "research note on one xStock"),
      "/v1/halal-screen": paidPath("/v1/halal-screen", "halalScreen", "AAOIFI shariah screen (methodology note included; not a fatwa)"),
      "/v1/basket": paidPath("/v1/basket", "basket", "themed basket + legs (path-less form; also /v1/basket/{id})"),
      "/v1/basket/{id}": paidPath("/v1/basket", "basket", "themed basket + legs"),
      "/v1/build": paidPath("/v1/build", "build", "external/edited plan -> executable legs (planId | symbols+weights | JSON body)", {
        "404": { $ref: "#/components/responses/Err404" },
      }),
      "/v1/backtest": paidPath("/v1/backtest", "backtest", "1Y backtest vs SPY. Backtests are history, not promises."),
      "/v1/screener": paidPath("/v1/screener", "screener", "momentum screener over the full universe"),
      "/v1/compare": paidPath("/v1/compare", "compare", "head-to-head note on two stocks"),
      "/v1/rebalance": paidPath("/v1/rebalance", "rebalance", "holdings + target -> minimal diff legs"),
    },
    components: {
      responses: {
        Err400: {
          description: "Invalid input, validated BEFORE the payment gate. Nothing was charged; your EIP-3009 authorization is not consumed.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Err402: {
          description: "Payment required. Full challenge in the PAYMENT-REQUIRED header (base64 JSON); body carries the decoded challenge, signing schema, how[] steps, params advisory, and discovery links.",
          headers: { "PAYMENT-REQUIRED": { schema: { type: "string" }, description: `base64 JSON x402 v2 challenge; expires ~${CHALLENGE_TTL_SECONDS} s` } },
          content: { "application/json": { schema: { $ref: "#/components/schemas/X402Body" } } },
        },
        Err404: {
          description: "Unknown symbol/basket/planId/path. Hint names the free listing endpoint. PLAN_NOT_FOUND may carry retryAfterSeconds (storage propagation).",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
        Err502: {
          description: "Post-settlement failure — you WERE charged. Retry with the SAME PAYMENT-SIGNATURE: settlement is skipped (recorded pre-handler) and the result regenerated free. paymentId included for the 72 h refund path.",
          content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
        },
      },
      schemas: {
        Error: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            charged: { type: "boolean" },
            retryable: { type: "boolean" },
            inputRequired: { type: "boolean" },
            fields: { type: "array", items: { type: "object", properties: { name: { type: "string" }, type: { type: "string" }, description: { type: "string" } } } },
            requiredAnyOf: { type: ["array", "null"] },
            hint: { type: "string" },
            paymentId: { type: "string" },
            retryAfterSeconds: { type: "number" },
            docs: { type: "string" },
          },
          required: ["error"],
        },
        X402Body: {
          type: "object",
          properties: {
            error: { type: "string" },
            code: { type: "string" },
            charged: { type: "boolean" },
            x402: { type: "object", description: "Decoded PAYMENT-REQUIRED challenge (accepts[], resource)" },
            signing: { type: "object", description: "EIP-712 domain, types, derivation rules and the exact PAYMENT-SIGNATURE template" },
            how: { type: "array", items: { type: "string" } },
            params: { type: "object", properties: { missing: { type: "array", items: { type: "string" } }, example: { type: "string" } } },
            prerequisites: { type: "object" },
            links: { type: "object" },
          },
        },
        Allocation: {
          type: "object",
          properties: {
            summary: { type: "string" },
            rationale: { type: "string" },
            riskScore: { type: "number" },
            allocations: { type: "array", items: { type: "object", properties: { symbol: { type: "string" }, weightPct: { type: "number" } }, required: ["symbol", "weightPct"] }, minItems: 1 },
          },
          required: ["allocations"],
        },
      },
    },
  };
}

// ── /.well-known/x402.json — accepts rendered by the SAME builder as live 402s ─
export function wellKnownX402(env: Env): Record<string, unknown> {
  return {
    x402Version: 2,
    name: "Vera by Monvera",
    agent: { id: "6711", marketplace: "okx.ai" },
    docs: { llms: `${BASE_URL}/llms.txt`, openapi: `${BASE_URL}/openapi.json` },
    resources: Object.entries(PAID_ROUTES).map(([path, key]) => ({
      resource: `${BASE_URL}${path}`,
      method: "POST",
      description: `$${PRICES[key]} per call`,
      accepts: [challengeEntryFor(path, env.PAY_TO_ADDRESS)],
    })),
  };
}
