// Display metadata for assets — bridges the real on-chain registry (lib/tokens.ts,
// keyed by ticker symbol) to the design's presentational shape (TileAsset + plain
// words). The *logic* universe stays in lib/tokens.ts; this only adds look & copy
// (tile color, monogram glyph, a sector label, a demo sparkline, a friendly
// description) so the Lite screens can render faithfully.
//
// Logos are the REAL per-stock brand marks Arcus serves for Robinhood Chain tokens
// (public S3, keyed by ticker). Symbols with no design entry fall back to sensible
// defaults + the same Arcus logo, so nothing ever crashes and every stock shows a
// real logo (monogram only if the image 404s).
import { asset } from "./assets";
import { UNSUPPORTED_SYMBOLS } from "./tokens";
import type { TileAsset } from "@/components/design";

export interface AssetDisplay extends TileAsset {
  /** Plain-language sector shown in Lite (e.g. "Tech", "Consumer", "Funds"). */
  cat: string;
  /** One-line, jargon-free description. */
  desc: string;
  /** Demo daily move (%) used only to tint sparklines up/down. */
  day: number;
  /** Demo sparkline series (presentational only). */
  spark: number[];
  /** Market ticker (e.g. "AAPL"). */
  ticker?: string;
  /** Indicative price per share (USD) — presentational fallback; live price wins. */
  price?: number;
  /** Reserved (unused post-Robinhood); kept for type compatibility. */
  apy?: string;
  /** True for assets not yet buyable in-app. */
  coming?: boolean;
}

// Real stock/ETF logos Arcus publishes for Robinhood Chain tokens (public bucket).
// Stock logos are hosted on Cloudflare R2 (mirrored from the Arcus branding bucket;
// 128px WebP) so every asset serves from our own infrastructure, not a
// third-party S3 bucket. TokenLogo falls back to a coloured monogram if missing.
const LOGO_BASE = "/logos";  // served from R2 via asset()
function arcusLogo(symbol: string): string {
  return asset(`${LOGO_BASE}/${symbol}.webp`);
}

const UP = [4, 5, 5, 6, 7, 7, 8, 9, 9, 10];
const FLAT = [8, 8, 8, 8, 8, 8, 8, 8, 8, 8];

// Keyed by the ticker `symbol` used in lib/tokens.ts. Logos come from arcusLogo()
// (below), so entries carry look + copy only — no hardcoded logo URLs (except the
// cash tile, which isn't a tradable stock).
const DISPLAY: Record<string, AssetDisplay> = {
  // Cash — the spendable dollar (USDG, Global Dollar) on Robinhood Chain.
  USDG: { name: "US Dollar", ticker: "USDG", logo: asset("/icons/usdg.png"), color: "#2c9c6a", kind: "safe", cat: "Cash", desc: "USDG (Global Dollar) is a digital dollar that always aims to be worth $1. It's your spendable cash: add it, invest it, or send it.", price: 1, day: 0, spark: FLAT },

  // The project token — logo is the app's own mark (served from public/, not R2).
  MONVERA: { name: "Monvera", ticker: "MONVERA", logo: "/icon-192.png", color: "#1f6f4e", glyph: "M", kind: "safe", cat: "Token", desc: "$MONVERA is the project token behind Vera — the community's stake in the agent, not the product. Holding 100,000 unlocks Scan to Buy.", day: 0, spark: FLAT },

  // ── Tech ──────────────────────────────────────────────────────────────────
  AAPL: { name: "Apple", ticker: "AAPL", color: "#3b3f44", kind: "stock", cat: "Tech", desc: "Apple makes the iPhone, Mac, and iPad, and earns a steady, growing income from services like the App Store and iCloud. One of the most valuable companies in the world.", price: 230, day: 0.82, spark: UP },
  NVDA: { name: "Nvidia", ticker: "NVDA", color: "#4a7d2c", glyph: "N", kind: "stock", cat: "Tech", desc: "Nvidia designs the chips that train and run most of today's AI. The same hardware powers gaming and data centers, which made it central to the AI boom.", price: 176, day: 2.41, spark: UP },
  MSFT: { name: "Microsoft", ticker: "MSFT", color: "#2f7d9c", glyph: "M", kind: "stock", cat: "Tech", desc: "Microsoft makes Windows, Office, and the Azure cloud, and is a leading investor in AI. A large, steady, highly profitable business.", price: 440, day: 0.44, spark: UP },
  GOOGL: { name: "Google", ticker: "GOOGL", color: "#356ac3", glyph: "G", kind: "stock", cat: "Tech", desc: "Google (Alphabet) runs the world's largest search and online-ad business, plus Android, YouTube, and a fast-growing cloud and AI arm.", price: 195, day: 0.51, spark: UP },
  META: { name: "Meta", ticker: "META", color: "#2a6ad4", glyph: "M", kind: "stock", cat: "Tech", desc: "Meta owns Instagram, WhatsApp, and Facebook, reaching billions of people daily. Most of its money comes from ads, and it's spending heavily on AI.", price: 620, day: 1.12, spark: UP },
  AMD: { name: "AMD", ticker: "AMD", color: "#c0392b", glyph: "A", kind: "stock", cat: "Tech", desc: "AMD designs processors and graphics chips that compete with Intel and Nvidia in PCs, data centers, and AI. A key challenger in the chip race.", price: 165, day: 1.6, spark: UP },
  INTC: { name: "Intel", ticker: "INTC", color: "#1f6fb2", glyph: "I", kind: "stock", cat: "Tech", desc: "Intel is one of the oldest chipmakers, powering many of the world's PCs and servers. It's investing heavily to rebuild its manufacturing edge.", price: 24, day: -0.4, spark: FLAT },
  MU: { name: "Micron", ticker: "MU", color: "#2f7d5e", glyph: "M", kind: "stock", cat: "Tech", desc: "Micron makes the memory and storage chips inside phones, computers, and AI servers. Its results rise and fall with chip demand.", price: 105, day: 1.1, spark: UP },
  ORCL: { name: "Oracle", ticker: "ORCL", color: "#b03a2e", glyph: "O", kind: "stock", cat: "Tech", desc: "Oracle sells databases and enterprise software, and its cloud business has grown fast on the back of AI computing demand.", price: 190, day: 0.7, spark: UP },
  PLTR: { name: "Palantir", ticker: "PLTR", color: "#3b3f44", glyph: "P", kind: "stock", cat: "Tech", desc: "Palantir builds data and AI software used by governments and large companies to make sense of huge amounts of information. A fast grower with sharp swings.", price: 75, day: 2.2, spark: UP },
  CRWV: { name: "CoreWeave", ticker: "CRWV", color: "#5a3fa0", glyph: "C", kind: "stock", cat: "Tech", desc: "CoreWeave rents out Nvidia-powered cloud computing built specifically for AI. A newer, fast-moving name tied closely to the AI buildout.", price: 85, day: 3.1, spark: UP },
  SNDK: { name: "SanDisk", ticker: "SNDK", color: "#c0392b", glyph: "S", kind: "stock", cat: "Tech", desc: "SanDisk makes flash storage and memory cards used in phones, cameras, and drives. Its fortunes track the memory-chip cycle.", price: 45, day: 0.9, spark: UP },

  // ── Consumer ──────────────────────────────────────────────────────────────
  AMZN: { name: "Amazon", ticker: "AMZN", color: "#e08a1e", glyph: "A", kind: "stock", cat: "Consumer", desc: "Amazon runs the largest online store and the leading cloud platform (AWS), plus streaming and ads. A giant that reaches nearly every corner of the economy.", price: 220, day: 0.9, spark: UP },
  TSLA: { name: "Tesla", ticker: "TSLA", color: "#b03a2e", kind: "stock", cat: "Consumer", desc: "Tesla builds electric cars and home battery systems, and is investing in self-driving software and robotics. Its share price tends to move sharply both ways.", price: 340, day: -1.36, spark: [9, 8, 9, 7, 8, 6, 7, 6, 5, 6] },
  BABA: { name: "Alibaba", ticker: "BABA", color: "#e0621e", glyph: "A", kind: "stock", cat: "Consumer", desc: "Alibaba is China's e-commerce and cloud giant, running huge online marketplaces and a growing AI and logistics business.", price: 105, day: 1.3, spark: UP },

  // ── Finance ───────────────────────────────────────────────────────────────
  COIN: { name: "Coinbase", ticker: "COIN", color: "#2f6fd0", glyph: "C", kind: "stock", cat: "Finance", desc: "Coinbase runs one of the largest regulated crypto exchanges. It earns from trading, custody, and services as digital assets go mainstream.", price: 320, day: 2.0, spark: UP },
  CRCL: { name: "Circle", ticker: "CRCL", color: "#2f6fd0", glyph: "C", kind: "stock", cat: "Finance", desc: "Circle is the company behind USDC, one of the largest digital dollars in crypto. It earns income on the reserves that back the coin.", price: 65, day: 1.88, spark: UP },

  // ── Energy & Materials ─────────────────────────────────────────────────────
  BE: { name: "Bloom Energy", ticker: "BE", color: "#2e6f5e", glyph: "B", kind: "stock", cat: "Energy", desc: "Bloom Energy makes fuel cells that generate clean, on-site electricity for data centers and businesses. A bet on cleaner, always-on power.", price: 25, day: 1.4, spark: UP },
  USAR: { name: "USA Rare Earth", ticker: "USAR", color: "#8a6d2a", glyph: "U", kind: "stock", cat: "Energy", desc: "USA Rare Earth is building a domestic supply of rare-earth metals and magnets used in EVs, electronics, and defense. Early-stage and volatile.", price: 15, day: 2.6, spark: UP },
  SPCX: { name: "SpaceX", ticker: "SPCX", color: "#3b3f44", glyph: "S", kind: "stock", cat: "Energy", desc: "Tokenized exposure to SpaceX, the private rocket and Starlink satellite company. A rare way to hold a slice of a fast-growing space business.", price: 120, day: 1.9, spark: UP },

  // ── Funds (ETFs) ───────────────────────────────────────────────────────────
  SPY: { name: "S&P 500", ticker: "SPY", color: "#1f6f54", kind: "fund", cat: "Funds", desc: "One fund holding the 500 largest US companies at once, so your money is spread across the whole American market instead of a single stock. A common starting point.", price: 640, day: 0.34, spark: UP },
  QQQ: { name: "Nasdaq-100", ticker: "QQQ", color: "#1c8a6e", kind: "fund", cat: "Funds", desc: "A fund holding the 100 largest non-financial Nasdaq companies, weighted toward big tech like Apple, Nvidia, and Microsoft.", price: 560, day: 0.68, spark: UP },
  SLV: { name: "Silver", ticker: "SLV", color: "#8a9199", glyph: "S", kind: "fund", cat: "Funds", desc: "A fund that tracks the price of silver, a precious metal used both as an investment and in industry. A way to diversify beyond stocks.", price: 30, day: 0.5, spark: UP },
  SGOV: { name: "US Treasuries", ticker: "SGOV", color: "#2e6f5e", glyph: "$", kind: "fund", cat: "Funds", desc: "A fund holding very short-term US government bonds, the steadiest corner of the market. A calm place to park cash that still earns a little.", price: 100, day: 0.02, spark: FLAT },
  USO: { name: "Oil", ticker: "USO", color: "#b06a3a", glyph: "O", kind: "fund", cat: "Funds", desc: "A fund that tracks the price of US crude oil. A direct way to hold exposure to energy prices without picking an oil company.", price: 75, day: 0.7, spark: UP },
};

// Sector labels for the rest of the Arcus universe (assets without a rich
// DISPLAY entry above). Anything missing falls back to "Stocks".
const SECTORS: Record<string, string> = {
  // Tech (semis, software, AI infra, quantum)
  AAOI: "Tech", AMAT: "Tech", APLD: "Tech", ASML: "Tech", AVGO: "Tech", CBRS: "Tech",
  CRWD: "Tech", DDOG: "Tech", DELL: "Tech", GLW: "Tech", INOD: "Tech", INTU: "Tech",
  IONQ: "Tech", LITE: "Tech", MDB: "Tech", MRVL: "Tech", MXL: "Tech", NBIS: "Tech",
  NOW: "Tech", NVTS: "Tech", PENG: "Tech", POET: "Tech", QBTS: "Tech", QCOM: "Tech",
  QUBT: "Tech", RGTI: "Tech", SMCI: "Tech", TSEM: "Tech", TSM: "Tech", UMC: "Tech",
  WDAY: "Tech", XNDU: "Tech", ZM: "Tech", ZS: "Tech",
  // Consumer & media
  CCL: "Consumer", CELH: "Consumer", COST: "Consumer", ELF: "Consumer", F: "Consumer",
  GME: "Consumer", LULU: "Consumer", NFLX: "Consumer", RBLX: "Consumer", RDDT: "Consumer",
  RIVN: "Consumer", SHOP: "Consumer", TTWO: "Consumer", UPS: "Consumer",
  // Finance
  FUTU: "Finance", MSTR: "Finance", NU: "Finance", SOFI: "Finance",
  // Health
  LLY: "Health",
  // Energy, materials & space
  ASTS: "Energy", BA: "Energy", CLSK: "Energy", FLNC: "Energy", IREN: "Energy",
  LUNR: "Energy", NNE: "Energy", P: "Energy", PR: "Energy", RDW: "Energy",
  RKLB: "Energy", SATS: "Energy", XOM: "Energy",
  // Funds (ETFs without a rich entry)
  EWY: "Funds", SOXX: "Funds", SPMO: "Funds", XLK: "Funds",
};

const FALLBACK_COLORS = ["#3b3f44", "#1f6f54", "#356ac3", "#b03a2e", "#4a7d2c"];

function fallback(symbol: string, name?: string): AssetDisplay {
  const color = FALLBACK_COLORS[symbol.charCodeAt(0) % FALLBACK_COLORS.length];
  const cat = SECTORS[symbol] ?? "Stocks";
  const fund = cat === "Funds";
  return {
    name: name || symbol,
    ticker: symbol,
    color,
    glyph: (name || symbol)[0],
    kind: fund ? "fund" : "stock",
    cat,
    desc: fund
      ? "A fund that spreads your money across many holdings at once, so you're not betting on a single company."
      : "A real company listed on the US stock market. Its price moves with how the business performs and how investors feel about it.",
    day: 0,
    spark: UP,
  };
}

/** Full display record for a ticker symbol (never throws). Logo = the real Arcus
 *  brand mark for every stock/fund; the cash tile keeps its local dollar mark. */
export function displayFor(symbol: string, name?: string): AssetDisplay {
  const base = DISPLAY[symbol] ?? fallback(symbol, name);
  const logo = symbol === "USDG" || symbol === "MONVERA" ? base.logo : arcusLogo(symbol);
  // Assets the router won't quote can't be bought at any size, so the buy CTA
  // must be off from the start rather than failing at the review sheet.
  const coming = base.coming || UNSUPPORTED_SYMBOLS.has(symbol);
  return { ...base, logo, coming };
}

/** Just the bits a design <AssetTile>/<HoldingRow> needs. */
export function toTile(symbol: string, name?: string): TileAsset & { day: number; spark: number[] } {
  const d = displayFor(symbol, name);
  return { name: d.name, color: d.color, glyph: d.glyph, kind: d.kind, logo: d.logo, day: d.day, spark: d.spark };
}

/** Friendly sector label for a symbol (Lite secondary line). */
export function catFor(symbol: string, name?: string): string {
  return displayFor(symbol, name).cat;
}
