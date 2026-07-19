// Post-build assertions for the things that fail silently.
//
// 1. llms.txt — Vera's docs index. src/pages/llms.txt.ts and the
//    starlight-llms-txt plugin both claim this route; ours wins today, and
//    Astro warns the collision will become a hard error later. A hard error is
//    loud and fine. What is NOT fine is precedence quietly flipping back to the
//    plugin's pointer file, which would leave Vera with no page URLs again
//    while everything still "builds". So we assert the real index shipped.
// 2. _redirects — Cloudflare treats malformed rules as warnings, so a typo'd
//    redirect deploys as a 404. Every rule must have a leading slash, an
//    explicit status, and both slashed and unslashed source forms.

import { readFileSync, existsSync } from 'node:fs';

const DIST = new URL('../dist/', import.meta.url);
const fail = (msg) => {
  console.error(`\n✗ build verification failed: ${msg}\n`);
  process.exit(1);
};

// ── 1. llms.txt ───────────────────────────────────────────────────────────
const llmsPath = new URL('llms.txt', DIST);
if (!existsSync(llmsPath)) fail('dist/llms.txt is missing');
const llms = readFileSync(llmsPath, 'utf8');
const links = (llms.match(/\]\(https:\/\/docs\.monvera\.best\/[^)]+\)/g) ?? []).length;
const bytes = Buffer.byteLength(llms, 'utf8');

if (links < 40) {
  fail(
    `dist/llms.txt lists only ${links} pages. Vera reads this file as her docs index — ` +
      `under 40 links means the starlight-llms-txt pointer file won the /llms.txt route ` +
      `instead of src/pages/llms.txt.ts.`,
  );
}
if (bytes > 14_000) fail(`dist/llms.txt is ${bytes}B, over the 14,000B budget (Vera truncates at 16KB)`);

// ── 2. _redirects ─────────────────────────────────────────────────────────
const redirectsPath = new URL('_redirects', DIST);
let redirectCount = 0;
if (existsSync(redirectsPath)) {
  const lines = readFileSync(redirectsPath, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
  const sources = new Set();
  for (const line of lines) {
    const [from, to, status] = line.split(/\s+/);
    if (!from?.startsWith('/')) fail(`_redirects: source "${from}" needs a leading slash`);
    if (!to?.startsWith('/') && !to?.startsWith('http')) fail(`_redirects: bad target in "${line}"`);
    if (!/^\d{3}$/.test(status ?? '')) fail(`_redirects: "${line}" has no explicit status (rules default to 302)`);
    sources.add(from);
    redirectCount++;
  }
  // Cloudflare matches the source exactly, so a rule needs both forms.
  for (const src of sources) {
    if (src.includes('*')) continue;
    const twin = src.endsWith('/') ? src.slice(0, -1) : src + '/';
    if (!sources.has(twin)) fail(`_redirects: "${src}" has no rule for "${twin}" (matching is exact)`);
  }
}

console.log(
  `✓ llms.txt: ${links} pages, ${bytes}B` +
    (redirectCount ? ` · _redirects: ${redirectCount} rules valid` : ''),
);
