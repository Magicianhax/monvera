/**
 * Monvera docs — static assets, plus an MCP endpoint at /mcp.
 *
 * Every request that is not /mcp falls through to the static asset binding, so
 * the site behaves exactly as it did before this Worker existed (including the
 * Starlight 404 page and the _redirects rules). `run_worker_first` in
 * wrangler.jsonc scopes Worker invocation to /mcp so asset requests stay free
 * and uninvolved — that is a cost and blast-radius choice, not a correctness
 * one: the fallthrough below is what actually preserves asset behaviour.
 *
 * Transport: Streamable HTTP (MCP 2025-03-26 and later). One POST, one JSON
 * response. No sessions, no SSE stream, no auth — the corpus is public,
 * read-only documentation, so there is nothing to protect and no credential to
 * leak. `Access-Control-Allow-Origin: *` is required for browser-based clients;
 * we deliberately do not validate Origin because there is no state to forge
 * against.
 *
 * Deliberately NOT implemented: a protocol-version guard. Rejecting unknown
 * versions with a 400 breaks forward compatibility — a newer client sends its
 * version, gets rejected, falls back to an HTTP+SSE GET, gets a 405, and fails
 * outright. We echo the client's version inside `initialize` instead.
 */

interface Env {
  ASSETS: Fetcher;
}

interface DocPage {
  id: string;
  url: string;
  title: string;
  description: string;
  section: string;
  text: string;
}

const SERVER_INFO = { name: 'monvera-docs', version: '1.0.0' };
const DEFAULT_PROTOCOL = '2025-06-18';
const INSTRUCTIONS =
  'Documentation for Monvera, an AI broker for real tokenized stocks on Robinhood Chain. ' +
  'Use search_monvera_docs to find relevant pages by keyword, then get_monvera_doc to read one in full. ' +
  'Monvera is not available in the US, Canada, the UK, or Switzerland, and nothing in these docs is investment advice.';

const TOOLS = [
  {
    name: 'search_monvera_docs',
    title: 'Search Monvera documentation',
    description:
      'Search the Monvera documentation by keyword. Returns matching pages with their id, title, url, and a short excerpt. ' +
      'Use this first to find which page answers a question about Monvera, Vera, tokenized stocks, plans, fees, or the API.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to search for, e.g. "autopilot limits" or "what it costs".' },
        section: {
          type: 'string',
          enum: ['start', 'use', 'safety', 'how', 'dev', 'reference'],
          description: 'Optional: restrict the search to one section of the docs.',
        },
        limit: { type: 'number', description: 'Maximum results to return (default 8, max 25).' },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_monvera_doc',
    title: 'Read a Monvera documentation page',
    description:
      'Return the full text of one Monvera documentation page, addressed by the id returned from search_monvera_docs ' +
      '(for example "use/your-plan" or "safety/what-it-costs"). A full URL or a leading slash also works.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Page id, e.g. "use/talk-to-vera".' },
      },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, accept',
  'access-control-max-age': '86400',
};

/** The corpus, fetched from our own static assets and cached per isolate. */
let corpus: DocPage[] | null = null;
async function loadCorpus(env: Env, origin: string): Promise<DocPage[]> {
  if (corpus) return corpus;
  const res = await env.ASSETS.fetch(new Request(`${origin}/mcp-index.json`));
  if (!res.ok) throw new Error(`docs index unavailable (${res.status})`);
  const data = (await res.json()) as { pages: DocPage[] };
  corpus = data.pages;
  return corpus;
}

/**
 * Words that carry no signal in a docs query. Without this, "how much does it
 * cost" scores `how/accountable-ai` above `safety/what-it-costs` — "how" hits
 * the path, and "it"/"does" hit every page's body.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'i', 'my', 'me',
  'you', 'your', 'it', 'its', 'to', 'of', 'in', 'on', 'for', 'with', 'at', 'by',
  'from', 'up', 'about', 'into', 'how', 'what', 'when', 'where', 'why', 'who',
  'which', 'this', 'that', 'these', 'those', 'get', 'got', 'much', 'many', 'if',
  'then', 'so', 'as', 'not', 'no', 'yes', 'any', 'all', 'some', 'there', 'here',
]);

/** Query → the terms worth scoring, keeping the original if all were stopwords. */
function termsOf(query: string): string[] {
  const words = query.toLowerCase().split(/[^a-z0-9$]+/).filter(Boolean);
  const kept = words.filter((w) => w.length > 2 && !STOPWORDS.has(w));
  return kept.length ? kept : words.filter((w) => w.length > 1);
}

/** Words that mean the asker wants the API reference, not the user guide. */
const DEV_SIGNALS =
  /\b(api|endpoint|route|curl|request|response|json|payload|header|token|bearer|auth|status|schema|param|parameters|webhook|sdk|http|post|get|put|delete|rate.?limit|integrat\w*)\b/i;

function scorePage(page: DocPage, terms: string[], devIntent: boolean): number {
  const title = page.title.toLowerCase();
  const desc = page.description.toLowerCase();
  const body = page.text.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 10;
    if (page.id.toLowerCase().includes(term)) score += 6;
    if (desc.includes(term)) score += 4;
    const hits = body.split(term).length - 1;
    if (hits) score += Math.min(hits, 5);
  }
  // every term present beats one term repeated
  if (terms.every((t) => title.includes(t) || desc.includes(t) || body.includes(t))) score += 5;

  // "set up autopilot" wants the guide; "autopilot endpoint" wants the reference.
  // API pages are dense with their own nouns, so without this they outrank the
  // page a person actually asked for.
  if (page.section === 'dev') score += devIntent ? 6 : -8;

  return Math.max(score, 0);
}

function excerpt(page: DocPage, terms: string[]): string {
  const body = page.text;
  const at = terms.map((t) => body.toLowerCase().indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0];
  if (at === undefined) return body.slice(0, 220).trim() + '…';
  const from = Math.max(0, at - 90);
  return (from > 0 ? '…' : '') + body.slice(from, from + 240).trim() + '…';
}

function textResult(text: string) {
  return { content: [{ type: 'text', text }] };
}

async function callTool(name: string, args: Record<string, unknown>, env: Env, origin: string) {
  const pages = await loadCorpus(env, origin);

  if (name === 'search_monvera_docs') {
    const query = String(args.query ?? '').trim();
    if (!query) return { ...textResult('Provide a query.'), isError: true };
    const section = typeof args.section === 'string' ? args.section : undefined;
    const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 25);
    const terms = termsOf(query);
    const devIntent = DEV_SIGNALS.test(query) || section === 'dev';

    const hits = pages
      .filter((p) => !section || p.section === section)
      .map((p) => ({ page: p, score: scorePage(p, terms, devIntent) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    if (!hits.length) {
      return textResult(
        `No Monvera docs matched "${query}". Try broader keywords, or browse https://docs.monvera.best/llms.txt for the full page index.`,
      );
    }
    const body = hits
      .map(
        ({ page }) =>
          `## ${page.title}\n- id: \`${page.id}\`\n- url: ${page.url}\n- ${page.description}\n\n${excerpt(page, terms)}`,
      )
      .join('\n\n---\n\n');
    return textResult(`${hits.length} result(s) for "${query}":\n\n${body}`);
  }

  if (name === 'get_monvera_doc') {
    const raw = String(args.id ?? '').trim();
    const id = raw
      .replace(/^https?:\/\/docs\.monvera\.best\//, '')
      .replace(/^\/+|\/+$/g, '');
    const page = pages.find((p) => p.id === id);
    if (!page) {
      const near = pages
        .filter((p) => p.id.includes(id.split('/').pop() ?? ''))
        .slice(0, 5)
        .map((p) => `- ${p.id}`)
        .join('\n');
      return {
        ...textResult(`No page with id "${id}".${near ? `\n\nDid you mean:\n${near}` : ''}`),
        isError: true,
      };
    }
    return textResult(`# ${page.title}\n\n> ${page.description}\n\nSource: ${page.url}\n\n${page.text}`);
  }

  return { ...textResult(`Unknown tool "${name}".`), isError: true };
}

async function handleMessage(msg: any, env: Env, origin: string): Promise<any | null> {
  const { id, method, params } = msg ?? {};
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id, result });
  const error = (code: number, message: string) => ({ jsonrpc: '2.0', id, error: { code, message } });

  // Notifications carry no id and must not be answered.
  if (id === undefined || id === null) return null;

  try {
    switch (method) {
      case 'initialize':
        return reply({
          // echo the client's version rather than policing a hardcoded list
          protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      case 'ping':
        return reply({});
      case 'tools/list':
        return reply({ tools: TOOLS });
      case 'tools/call': {
        const name = params?.name;
        const args = (params?.arguments ?? {}) as Record<string, unknown>;
        if (!name) return error(-32602, 'Missing tool name');
        return reply(await callTool(name, args, env, origin));
      }
      case 'resources/list':
        return reply({ resources: [] });
      case 'prompts/list':
        return reply({ prompts: [] });
      default:
        return error(-32601, `Method not found: ${method}`);
    }
  } catch (err) {
    return error(-32603, err instanceof Error ? err.message : 'Internal error');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/mcp' || url.pathname === '/mcp/') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

      if (request.method !== 'POST') {
        // A GET would open an SSE stream in the full spec; we do not keep
        // server-initiated state, so say so in a way clients can act on.
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: null,
            error: { code: -32000, message: 'This server is POST-only (no server-initiated stream).' },
          }),
          { status: 405, headers: { 'content-type': 'application/json', allow: 'POST, OPTIONS', ...CORS } },
        );
      }

      let payload: unknown;
      try {
        payload = await request.json();
      } catch {
        return new Response(
          JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }),
          { status: 400, headers: { 'content-type': 'application/json', ...CORS } },
        );
      }

      // A batch must be answered message-by-message; dropping all but the first
      // silently hangs the client.
      const messages = Array.isArray(payload) ? payload : [payload];
      const replies = (
        await Promise.all(messages.map((m) => handleMessage(m, env, url.origin)))
      ).filter((r) => r !== null);

      // All-notifications batch: acknowledge with 202 and no body.
      if (!replies.length) return new Response(null, { status: 202, headers: CORS });

      return new Response(JSON.stringify(Array.isArray(payload) ? replies : replies[0]), {
        headers: { 'content-type': 'application/json', ...CORS },
      });
    }

    // Everything else is the static site, untouched.
    return env.ASSETS.fetch(request);
  },
};
