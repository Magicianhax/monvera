// Smart market search + theme filters.
//
// Beyond ticker/name matching, a search term maps to a CATEGORY ("etf", "tech")
// or a THEME ("ai", "quantum", "space") so people find related stocks without
// knowing the exact symbol. Themes are curated symbol sets over the registry.

// Theme keyword -> the tickers that belong to it. Keys are matched as whole
// words / prefixes against the lowercased query (see matchesSearch).
export const THEMES: Record<string, string[]> = {
  ai: ["NVDA", "AMD", "AVGO", "PLTR", "CRWV", "MSFT", "GOOGL", "META", "AMZN", "TSM", "ASML", "MU", "SMCI", "NBIS", "DELL", "MRVL", "QCOM", "IREN", "APLD", "AAOI", "LITE", "INOD"],
  "artificial intelligence": ["NVDA", "AMD", "PLTR", "CRWV", "MSFT", "GOOGL", "META", "NBIS", "SMCI", "INOD"],
  semiconductor: ["NVDA", "AMD", "INTC", "MU", "TSM", "ASML", "AVGO", "QCOM", "MRVL", "MXL", "TSEM", "UMC", "AMAT", "SNDK", "SMCI", "NVTS", "SOXX"],
  chip: ["NVDA", "AMD", "INTC", "MU", "TSM", "ASML", "AVGO", "QCOM", "MRVL", "MXL", "TSEM", "UMC", "AMAT", "SNDK", "SOXX"],
  semi: ["NVDA", "AMD", "INTC", "MU", "TSM", "ASML", "AVGO", "QCOM", "MRVL", "AMAT", "SOXX"],
  quantum: ["IONQ", "RGTI", "QBTS", "QUBT", "XNDU"],
  crypto: ["COIN", "CRCL", "MSTR", "CLSK", "IREN"],
  blockchain: ["COIN", "CRCL", "MSTR", "CLSK", "IREN"],
  bitcoin: ["MSTR", "COIN", "CLSK", "IREN"],
  space: ["RKLB", "ASTS", "LUNR", "RDW", "SPCX", "SATS"],
  ev: ["TSLA", "RIVN", "F"],
  "electric vehicle": ["TSLA", "RIVN", "F"],
  energy: ["BE", "NNE", "FLNC", "XOM", "PR", "USO", "USAR", "CLSK"],
  nuclear: ["NNE", "BE"],
  cloud: ["MSFT", "ORCL", "NOW", "SHOP", "DDOG", "MDB", "WDAY", "ZS", "CRWD", "NBIS", "CRWV"],
  software: ["MSFT", "ORCL", "NOW", "DDOG", "MDB", "WDAY", "ZS", "CRWD", "INTU", "ZM", "TTWO", "RBLX"],
  cybersecurity: ["CRWD", "ZS"],
  fintech: ["SOFI", "COIN", "NU", "FUTU", "CRCL"],
  bank: ["SOFI", "NU", "FUTU"],
  china: ["BABA", "FUTU"],
  health: ["LLY"],
  pharma: ["LLY"],
  retail: ["AMZN", "COST", "LULU", "ELF", "CELH", "GME"],
  gaming: ["RBLX", "TTWO", "GME"],
  meme: ["GME", "RBLX"],
  social: ["META", "RDDT", "PINS"],
  chinese: ["BABA", "FUTU"],
};

// Category synonyms — a query that names a category filters to that category.
const CAT_SYNONYMS: Record<string, string> = {
  etf: "Funds",
  etfs: "Funds",
  fund: "Funds",
  funds: "Funds",
  index: "Funds",
  tech: "Tech",
  technology: "Tech",
  consumer: "Consumer",
  finance: "Finance",
  financial: "Finance",
  energy: "Energy",
  health: "Health",
  healthcare: "Health",
};

/** True if `query` matches the asset by symbol, name, category, or a theme. */
export function matchesSearch(symbol: string, name: string, cat: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (symbol.toLowerCase().includes(q) || name.toLowerCase().includes(q)) return true;
  if (cat.toLowerCase().includes(q)) return true;
  // category synonym (etf -> Funds, etc.)
  if (CAT_SYNONYMS[q] && cat === CAT_SYNONYMS[q]) return true;
  // theme membership (ai, quantum, space, ...): match on a theme key that the
  // query is a prefix of (so "quant" hits "quantum"), then check the symbol set.
  for (const [key, syms] of Object.entries(THEMES)) {
    if ((key.startsWith(q) || q.startsWith(key)) && syms.includes(symbol)) return true;
  }
  return false;
}
