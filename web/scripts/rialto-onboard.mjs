// Rialto integrator onboarding — self-service, wallet-signed (YOU run this).
//
// Registers Monvera as a Rialto integrator (so quotes can carry our fee, paid
// to our wallet in the same tx) and mints the API key. Ported 1:1 from the
// reference implementation in RIALTO_SWAP_API.md — payload hash starts with
// action + chain_id, addresses are lowercased, and fee_recipient MUST equal
// the owner wallet (a Rialto rule; sweep to treasury separately).
//
// Usage:
//   node scripts/rialto-onboard.mjs apply                 # step 1: submit application
//   node scripts/rialto-onboard.mjs key <integrator_id>   # step 2: mint the API key
//
// Key: RIALTO_OWNER_PRIVATE_KEY, else AGENT_SIGNER_PRIVATE_KEY from .env.local.
// The api_key prints ONCE — put it in .env.local as RIALTO_API_KEY and (prod)
// `npx wrangler secret put RIALTO_API_KEY`. Fee bps go in RIALTO_FEE_BPS.
import { readFileSync } from "node:fs";
import { keccak256, toBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const BASE = process.env.RIALTO_API_URL || "https://rialto-trade-api.rialto.xyz";
const CHAIN_ID = 4663;

const DISPLAY_NAME = "Monvera";
const SLUG = "monvera";
const CONTACT_EMAIL = "magicianafk@gmail.com";
const TELEGRAM_HANDLE = "@Magicianafk_01";
const APP_URL = "https://monvera.best";
const APPLICATION_DESCRIPTION =
  "Monvera is an AI broker for tokenized stocks on Robinhood Chain. Vera, its agent, builds and executes diversified stock plans for users — gasless and non-custodial.";
const REQUESTED_MAX_FEE_BPS = 25; // 0.25% (combined Rialto+integrator cap is 100)
const KEY_LABEL = "monvera-web";

function envLocal(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/).find((l) => l.startsWith(name + "="));
    return line ? line.slice(name.length + 1).trim() : undefined;
  } catch {
    return undefined;
  }
}

// The wallet the owner designated for Rialto fees — the integrator owner AND
// fee recipient (Rialto requires they be the same wallet).
const EXPECTED_OWNER = "0xc6d7709dd8ba53832bd578a88260f8b8e59fb4c7";

const pk = envLocal("RIALTO_OWNER_PRIVATE_KEY");
if (!pk) {
  console.error("Set RIALTO_OWNER_PRIVATE_KEY in .env.local — the private key behind " + EXPECTED_OWNER + ".");
  process.exit(1);
}
const account = privateKeyToAccount(pk.startsWith("0x") ? pk : `0x${pk}`);
const owner = account.address.toLowerCase();
if (owner !== EXPECTED_OWNER) {
  console.error(`RIALTO_OWNER_PRIVATE_KEY derives ${owner}, not the designated fee wallet ${EXPECTED_OWNER}. Wrong key — aborting.`);
  process.exit(1);
}
console.log(`Signing as: ${owner} (integrator owner = fee recipient, per Rialto's rule) at up to ${REQUESTED_MAX_FEE_BPS} bps\n`);

// keccak256("field_name=<utf8 byte length>:<value>\n" per field, in order).
// Optional fields are pre-encoded by the caller via optional().
function payloadHash(fields) {
  let canonical = "";
  for (const [key, value] of fields) {
    const v = String(value);
    canonical += `${key}=${Buffer.byteLength(v, "utf8")}:${v}\n`;
  }
  return keccak256(toBytes(canonical));
}

const optional = (value) => (value === null || value === undefined || value === "" ? "none" : `some:${value}`);

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text || "(empty body)"}`);
  return JSON.parse(text);
}

async function signedFlow(action, hash, path, fields) {
  const nonceRes = await post("/integrators/nonce", {
    chain_id: CHAIN_ID,
    wallet: owner,
    action,
    payload_hash: hash,
  });
  // "Sign the exact message string. Do not reconstruct it client-side."
  const signature = await account.signMessage({ message: nonceRes.message });
  return post(path, {
    chain_id: CHAIN_ID,
    ...fields,
    payload_hash: hash,
    nonce: nonceRes.nonce,
    issued_at: nonceRes.issued_at,
    expiration_time: nonceRes.expiration_time,
    signature,
  });
}

const cmd = process.argv[2];

if (cmd === "apply") {
  // Canonical per the LIVE frontend (app.rialto.xyz bundle), which is ahead of
  // the docs: plain trimmed values (no some:/none), application_description
  // between app_url and fee_recipient.
  const hash = payloadHash([
    ["action", "create_integrator_application"],
    ["chain_id", CHAIN_ID],
    ["owner_wallet", owner],
    ["display_name", DISPLAY_NAME],
    ["slug", SLUG],
    ["contact_email", CONTACT_EMAIL],
    ["telegram_handle", TELEGRAM_HANDLE],
    ["app_url", APP_URL],
    ["application_description", APPLICATION_DESCRIPTION],
    ["fee_recipient", owner],
    ["requested_max_fee_bps", REQUESTED_MAX_FEE_BPS],
  ]);
  // Optional fields must be OMITTED when absent — the API rejects null.
  const out = await signedFlow("create_integrator_application", hash, "/integrators/applications", {
    owner_wallet: owner,
    display_name: DISPLAY_NAME,
    slug: SLUG,
    ...(CONTACT_EMAIL ? { contact_email: CONTACT_EMAIL } : {}),
    ...(TELEGRAM_HANDLE ? { telegram_handle: TELEGRAM_HANDLE } : {}),
    ...(APP_URL ? { app_url: APP_URL } : {}),
    application_description: APPLICATION_DESCRIPTION,
    fee_recipient: owner,
    requested_max_fee_bps: REQUESTED_MAX_FEE_BPS,
  });
  console.log(JSON.stringify(out, null, 2));
  if (out.status === "active") {
    console.log(`\nProfile is active — mint the key now:\n  node scripts/rialto-onboard.mjs key ${out.integrator_id}`);
  } else {
    console.log(`\nStatus "${out.status}" — wait for Rialto approval, then run:\n  node scripts/rialto-onboard.mjs key ${out.integrator_id ?? "<integrator_id>"}`);
  }
} else if (cmd === "key") {
  const integratorId = Number(process.argv[3]);
  if (!integratorId) {
    console.error("Usage: node scripts/rialto-onboard.mjs key <integrator_id>");
    process.exit(1);
  }
  const hash = payloadHash([
    ["action", "create_integrator_api_key"],
    ["chain_id", CHAIN_ID],
    ["owner_wallet", owner],
    ["integrator_id", integratorId],
    ["label", KEY_LABEL],
  ]);
  const out = await signedFlow("create_integrator_api_key", hash, "/integrators/api-keys", {
    owner_wallet: owner,
    integrator_id: integratorId,
    label: KEY_LABEL,
  });
  console.log(JSON.stringify(out, null, 2));
  console.log("\n^ api_key is shown ONCE. Save it now:\n  .env.local  -> RIALTO_API_KEY=…\n  production  -> npx wrangler secret put RIALTO_API_KEY\nAnd set the fee: RIALTO_FEE_BPS=25 (or whatever was approved).");
} else if (cmd === "status") {
  const res = await fetch(`${BASE}/integrators/status?wallet=${owner}`);
  const j = await res.json();
  console.log(JSON.stringify(j, null, 2));
  if (j.status === "active" || j.is_integrator) console.log(`\nApproved! Mint the key:\n  node scripts/rialto-onboard.mjs key ${j.integrator_id}`);
  else console.log("\nStill pending Rialto review.");
} else {
  console.log("Usage:\n  node scripts/rialto-onboard.mjs apply\n  node scripts/rialto-onboard.mjs status\n  node scripts/rialto-onboard.mjs key <integrator_id>");
}
