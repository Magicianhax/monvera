import "server-only";

// Headlines for a ticker: fetch, parse, cache. No model, no D1, no
// notifications — this file only answers "what has been published about SYM".
//
// Primary source is Yahoo's per-ticker RSS (keyless, ~14 KB, 20 items, strictly
// newest-first). Google News RSS is a per-symbol fallback ONLY: ~130 KB each,
// relevance-ordered rather than chronological, and its <description> is an
// anchor tag rather than a summary, so a sweep-wide switch would cost ten times
// the egress for weaker classification signal.
import { kvCached } from "@/lib/server/kvCache";
import { normalizeCopy } from "@/lib/server/copyLint";

export interface NewsItem {
  /** Stable article id (Yahoo's article UUID). The global dedupe key. */
  guid: string;
  symbol: string;
  title: string;
  summary: string;
  url: string;
  publisher: string;
  /** Epoch MILLISECONDS. */
  publishedAt: number;
}

/** An hourly sweep must never re-alert week-old news after a KV eviction. */
export const NEWS_MAX_AGE_MS = 24 * 3600_000;

// Cloudflare's fetch sends NO User-Agent and Yahoo answers a UA-less request
// with HTTP 429 "Too Many Requests" — verified on both the RSS and the JSON
// host. This passes in local dev (Node sends a UA) and fails 100% in the
// Worker, so every fetch in this file carries the house header (kyber.ts).
const HEADERS = {
  "user-agent": "monvera/1.0 (+https://monvera.best)",
  accept: "application/rss+xml, application/xml, text/xml",
} as const;

// Yahoo throttles bursts and a 60-symbol sweep IS a burst; the price and chart
// sweeps share that host and must not become collateral. Same gate shape as
// marketData's yahooSlot.
const MAX_CONCURRENT_NEWS = 6;
let inflight = 0;
const waiters: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight >= MAX_CONCURRENT_NEWS) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
    waiters.shift()?.();
  }
}

// ── parser ────────────────────────────────────────────────────────────────────
// Compiled ONCE at module scope. Field regexes are non-global and run against a
// single <item> block, never the whole document: the channel carries its own
// <title>/<link> and a document-wide match returns the feed name for every item.
const ITEM = /<item[^>]*>([\s\S]*?)<\/item>/g;
const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/;
const LINK = /<link[^>]*>([\s\S]*?)<\/link>/;
const PUBDATE = /<pubDate[^>]*>([\s\S]*?)<\/pubDate>/;
const GUID = /<guid[^>]*>([\s\S]*?)<\/guid>/;
const DESC = /<description[^>]*>([\s\S]*?)<\/description>/;
const SOURCE = /<source[^>]*>([\s\S]*?)<\/source>/;
// Yahoo has no CDATA today; Google could add one.
const CDATA = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/;

function codePoint(n: number): string {
  return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
}

// Order matters: numeric first, named next, &amp; LAST. Decoding &amp; first
// resurrects literal markup out of "&amp;lt;body&amp;gt;".
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => codePoint(parseInt(d, 10)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&");
}

function field(block: string, re: RegExp): string {
  const raw = re.exec(block)?.[1];
  if (!raw) return "";
  const inner = CDATA.exec(raw)?.[1] ?? raw;
  return decodeEntities(inner)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function itemBlocks(body: string): string[] {
  ITEM.lastIndex = 0; // a /g regex at module scope carries lastIndex between calls
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = ITEM.exec(body)) !== null) out.push(m[1]);
  return out;
}

/** Hostname-derived publisher label; "" when the link cannot be parsed. */
function publisherFromUrl(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host === "finance.yahoo.com" ? "Yahoo Finance" : host;
  } catch {
    return "";
  }
}

export function parseYahooRss(body: string, symbol: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const block of itemBlocks(body)) {
    const title = field(block, TITLE);
    const url = field(block, LINK);
    const at = Date.parse(field(block, PUBDATE));
    if (!title || !Number.isFinite(at)) continue; // unparseable date: drop it
    out.push({
      guid: field(block, GUID) || url || `${symbol}:${title}`,
      symbol,
      title,
      summary: field(block, DESC).slice(0, 240),
      url,
      publisher: publisherFromUrl(url),
      publishedAt: at,
    });
  }
  return out;
}

export function parseGoogleRss(body: string, symbol: string): NewsItem[] {
  const out: NewsItem[] = [];
  for (const block of itemBlocks(body)) {
    const raw = field(block, TITLE);
    const url = field(block, LINK);
    const at = Date.parse(field(block, PUBDATE));
    if (!raw || !Number.isFinite(at)) continue;
    // Google renders "Headline - Publisher"; the headline itself may contain
    // " - ", so split on the LAST one.
    const cut = raw.lastIndexOf(" - ");
    const title = cut > 0 ? raw.slice(0, cut) : raw;
    const suffix = cut > 0 ? raw.slice(cut + 3) : "";
    out.push({
      guid: field(block, GUID) || url || `${symbol}:${title}`,
      symbol,
      title,
      // <description> here is an anchor tag repeating the title, not a summary.
      summary: "",
      url,
      publisher: field(block, SOURCE) || suffix || publisherFromUrl(url),
      publishedAt: at,
    });
  }
  // Relevance-ordered upstream, so newest-first is ours to impose.
  return out.sort((a, b) => b.publishedAt - a.publishedAt);
}

// ── fetchers ──────────────────────────────────────────────────────────────────
async function fetchYahoo(symbol: string): Promise<NewsItem[]> {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const res = await slot(() => fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(6_000) }));
  // Throttle/outage is RETRYABLE and must never be cached as "no news".
  if (!res.ok) throw new Error(`yahoo-news ${res.status}`);
  // Zero <item> blocks is a normal answer (an unknown ticker returns 200 with none).
  return parseYahooRss(await res.text(), symbol);
}

async function fetchGoogle(symbol: string): Promise<NewsItem[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(symbol + " stock")}&hl=en-US&gl=US&ceid=US:en`;
  const res = await slot(() => fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(8_000) }));
  if (!res.ok) throw new Error(`google-news ${res.status}`);
  return parseGoogleRss(await res.text(), symbol);
}

const FEED_TTL_MS = 30 * 60_000;
const feedKey = (symbol: string) => `news:feed:${symbol}`;

/** Headlines for one symbol. `takeFallback` grants (and consumes) one Google
 *  retry when Yahoo throws; without it a Yahoo failure propagates and
 *  kvCached's stale-while-revalidate keeps serving the last good headlines
 *  rather than blanking them. */
export async function headlines(symbol: string, takeFallback?: () => boolean): Promise<NewsItem[]> {
  return kvCached(feedKey(symbol), FEED_TTL_MS, async () => {
    try {
      return await fetchYahoo(symbol);
    } catch (err) {
      if (takeFallback?.()) return fetchGoogle(symbol);
      throw err;
    }
  });
}

/** Sweep entry point. Per-symbol failures become an empty array, never a thrown
 *  sweep; Google fallbacks are rationed across the whole call (~130 KB each). */
export async function headlinesFor(
  symbols: string[],
  opts?: { maxFallback?: number },
): Promise<Map<string, NewsItem[]>> {
  let tokens = opts?.maxFallback ?? 8;
  const take = () => (tokens > 0 ? (tokens--, true) : false);
  const out = new Map<string, NewsItem[]>();
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        out.set(sym, await headlines(sym, take));
      } catch {
        out.set(sym, []);
      }
    }),
  );
  return out;
}

/** Cache-only headline lookup for the rebalance brief: reads what the sweep
 *  already wrote and NEVER fetches. The loader throws rather than resolving to
 *  [] — kvCached writes only what a loader RESOLVES, so a throwing loader is
 *  read-only in both paths, while an empty-array loader would clobber a stale
 *  entry's real headlines with nothing on the background refresh. Never throws. */
export async function recentHeadlines(
  symbols: string[],
): Promise<Map<string, { title: string; ageH: number }>> {
  const out = new Map<string, { title: string; ageH: number }>();
  const now = Date.now();
  await Promise.all(
    symbols.map(async (sym) => {
      try {
        const items = await kvCached<NewsItem[]>(feedKey(sym), FEED_TTL_MS, async () => {
          throw new Error("news-feed cache-only");
        });
        let best: NewsItem | null = null;
        for (const it of items) {
          if (now - it.publishedAt > NEWS_MAX_AGE_MS) continue;
          if (!best || it.publishedAt > best.publishedAt) best = it;
        }
        if (best) {
          out.set(sym, {
            title: normalizeCopy(best.title).slice(0, 110),
            ageH: Math.max(0, Math.round((now - best.publishedAt) / 3600_000)),
          });
        }
      } catch {
        /* cache miss or unreadable KV: this symbol simply has no headline */
      }
    }),
  );
  return out;
}
