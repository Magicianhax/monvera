import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// The docs index Vera reads.
//
// Vera's system prompt injects this file every 6h (web/src/lib/server/
// veraKnowledge.ts) under "point users at relevant pages" — so it has to BE a
// list of pages. starlight-llms-txt cannot produce one (it never reads the
// content collection; its llms.txt is only a pointer to llms-small/full.txt),
// so we own this route and let the plugin keep the bulk files. A file-based
// route wins over the plugin's injected one at the same path.
//
// Hard budget: Vera truncates at 16KB, so the build fails above 14KB rather
// than letting her silently receive half an index.

const SITE = 'https://docs.monvera.best';
const TAGLINE =
  'An AI broker for real tokenized stocks and funds on Robinhood Chain. Tell Vera a goal and an amount, she builds a diversified basket of real companies, each with a reason and a plain risk read, and one tap invests it. Gasless, non-custodial, from $1.';
const DETAILS =
  'Vera is registered on-chain agent #1 and signs a risk assessment that is recorded on-chain with every trade. Not available in the US, Canada, the UK, or Switzerland. Nothing here is investment advice. Backtests are history, not promises.';

const MAX_BYTES = 14_000;
/**
 * Descriptions are Vera's only signal when choosing among pages, so user-facing
 * pages get a full clause. Endpoint pages are formulaic and the most numerous —
 * their name carries the meaning, and a developer who needs detail gets pointed
 * at the developer-api set — so they run tighter to stay inside the budget.
 */
const MAX_DESC = 120;
const MAX_DESC_API = 80;

const GROUPS: Array<[string, (id: string) => boolean]> = [
  ['Start here', (id) => id.startsWith('start/')],
  ['Using Monvera', (id) => id.startsWith('use/')],
  ['Money and safety', (id) => id.startsWith('safety/')],
  ['How it works', (id) => id.startsWith('how/')],
  ['Developers', (id) => id.startsWith('dev/') && !id.startsWith('dev/api/')],
  ['API reference', (id) => id.startsWith('dev/api/')],
  ['Reference', (id) => !id.includes('/')],
];

/** Trim to a whole word so a clipped description never ends mid-token. */
function clamp(text: string, limit: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  if (one.length <= limit) return one;
  const cut = one.slice(0, limit);
  const stop = cut.lastIndexOf(' ');
  return (stop > limit / 2 ? cut.slice(0, stop) : cut).replace(/[,;:.\s]+$/, '') + '…';
}

export const prerender = true;

export const GET: APIRoute = async () => {
  const docs = (await getCollection('docs')).filter((e) => e.id !== 'index');
  const sections = [`# Monvera`, `> ${TAGLINE}`, DETAILS];

  for (const [heading, test] of GROUPS) {
    const rows = docs
      .filter((e) => test(e.id))
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((e) => {
        const limit = e.id.startsWith('dev/api/') ? MAX_DESC_API : MAX_DESC;
        const desc = e.data.description ? `: ${clamp(e.data.description, limit)}` : '';
        return `- [${e.data.title}](${SITE}/${e.id}/)${desc}`;
      });
    if (rows.length) sections.push(`## ${heading}`, rows.join('\n'));
  }

  sections.push(
    '## Optional',
    [
      // slugs come from the customSets labels in astro.config.mjs — renaming a
      // label moves these URLs
      `- [Using Monvera, full text](${SITE}/_llms-txt/using-monvera.txt): every product page in full, for deep questions`,
      `- [Developer and API, full text](${SITE}/_llms-txt/developer-and-api.txt): every API page in full, for integration questions`,
      `- [Complete documentation](${SITE}/llms-full.txt): every page on the site`,
    ].join('\n'),
  );

  const body = sections.join('\n\n') + '\n';
  const bytes = new TextEncoder().encode(body).length;
  if (bytes > MAX_BYTES) {
    throw new Error(
      `llms.txt is ${bytes}B, over the ${MAX_BYTES}B budget (Vera truncates at 16KB). ` +
        `Shorten page descriptions or reduce the page count.`,
    );
  }

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
