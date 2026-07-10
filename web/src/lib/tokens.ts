// Robinhood Chain asset registry. Network/chain config lives in ./chain.
//
// Stock tokens are plain ERC-20 (18 decimals), settled in USDG (6 decimals).
// The full universe (95 assets) comes from the Arcus router's own token list
// (GET router.spot.arcus.xyz/v1/tokens?chainId=4663, fetched 2026-07-04), so
// everything here is quotable. Chainlink feeds merged from
// reference-data-directory.vercel.app/feeds-robinhood-mainnet.json; assets
// without a feed price as undefined (UI shows them honestly, trading still
// quotes live through Arcus). Execution goes through lib/server/arcus.ts —
// this file carries token identity/metadata only.
import { MULTICALL3 } from "./chain";

export { MULTICALL3 };

// Settlement stablecoin on Robinhood Chain: USDG (Global Dollar), 6 decimals.
export const USDG = {
  address: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  symbol: "USDG",
  decimals: 6,
} as const;

// Wrapped native ETH (18 decimals) — occasionally an intermediate/quote token.
export const WETH = "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73" as const;

// InferenceVerifier (EIP-712) — public contract address, env-overridable so a
// redeploy needs no code change. Zero until redeployed on Robinhood Chain.
export const INFERENCE_VERIFIER = (process.env.NEXT_PUBLIC_INFERENCE_VERIFIER ||
  "0x0000000000000000000000000000000000000000") as `0x${string}`;

export type AssetTier = "stock" | "etf";

export interface Asset {
  symbol: string; // user-facing ticker
  name: string;
  tier: AssetTier;
  address: `0x${string}`;
  decimals: number; // Robinhood stock/ETF tokens are 18dp (ERC-8056 uiMultiplier for display)
  /**
   * Chainlink AggregatorV3 price-feed proxy (8dp, already corporate-action
   * adjusted). Source of truth to refresh from:
   * reference-data-directory.vercel.app/feeds-robinhood-mainnet.json.
   * undefined = no feed published yet on this new chain (e.g. BE, AVGO).
   */
  feed?: `0x${string}`;
}

// ---- 86 stock tokens (Arcus router /v1/tokens, chain 4663, 2026-07-04) ----
export const STOCKS: Asset[] = [
  { symbol: "AAOI", name: "Applied Optoelectronics", tier: "stock", address: "0x521Cf887E6531c6F667b5BC4D896E5d9bfE8EB2E", decimals: 18 },
  { symbol: "AAPL", name: "Apple", tier: "stock", address: "0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9", decimals: 18, feed: "0x6B22A786bAa607d76728168703a39Ea9C99f2cD0" },
  { symbol: "AMAT", name: "Applied Materials", tier: "stock", address: "0x36046893810a7E7fCE501229d57dc3FC8c8716d0", decimals: 18 },
  { symbol: "AMD", name: "AMD", tier: "stock", address: "0x86923f96303D656E4aa86D9d42D1e57ad2023fdC", decimals: 18, feed: "0x943A29E7ae51A4798823ca9eEd2ed533B2A22C72" },
  { symbol: "AMZN", name: "Amazon", tier: "stock", address: "0x12f190a9F9d7D37a250758b26824B97CE941bF54", decimals: 18, feed: "0xD5a1508ceD74c084eBf3cBe853e2C968fB2a651C" },
  { symbol: "APLD", name: "Applied Digital", tier: "stock", address: "0xb8DBf92F9741c9ac1c32115E78581f23509916FD", decimals: 18 },
  { symbol: "ASML", name: "ASML", tier: "stock", address: "0x47F93d52cBeC7C6D2CfC080e154002370a60dAEA", decimals: 18, feed: "0xB4106147E8cce40b7d46124090d373A71b70f87D" },
  { symbol: "ASTS", name: "AST SpaceMobile", tier: "stock", address: "0x1AF6446f07eb1d97c546AFC8c9544cBDF3AD5137", decimals: 18 },
  { symbol: "AVGO", name: "Broadcom", tier: "stock", address: "0x156E175DD063a8cE274C50654eF40e0032b3fbcF", decimals: 18 },
  { symbol: "BA", name: "Boeing", tier: "stock", address: "0x4D21483a44Bf67a86b77E3dA301411880797D452", decimals: 18 },
  { symbol: "BABA", name: "Alibaba", tier: "stock", address: "0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4", decimals: 18, feed: "0x62Cc8F9b5f56a33c9C8A60c8B92779f523c4E984" },
  { symbol: "BE", name: "Bloom Energy", tier: "stock", address: "0x822CC93fFD030293E9842c30BBD678F530701867", decimals: 18 },
  { symbol: "CBRS", name: "Cerebras", tier: "stock", address: "0x5c90450Bbb4273D7b2f17CF6917AEB237A569679", decimals: 18 },
  { symbol: "CCL", name: "Carnival", tier: "stock", address: "0x9651342CeA770aE9a2969Ba2A52611523146aef9", decimals: 18 },
  { symbol: "CELH", name: "Celsius", tier: "stock", address: "0x8cF07C5A878945185d327aAa6e33FAa95F95e7bF", decimals: 18 },
  { symbol: "CLSK", name: "CleanSpark", tier: "stock", address: "0xcBB95BBF36099d34dA091dc6Fa6F49EfA257Cee3", decimals: 18, feed: "0x810c12D3a554Bc47fd39597Fe3b3AAC4941F50eF" },
  { symbol: "COIN", name: "Coinbase", tier: "stock", address: "0x6330D8C3178a418788dF01a47479c0ce7CCF450b", decimals: 18, feed: "0xA3a468A452940B7D6b69991207B508c609a98Ef2" },
  { symbol: "COST", name: "Costco", tier: "stock", address: "0x4EA005168D7F09a7A0Ba9D1DEf21a479950E44C2", decimals: 18 },
  { symbol: "CRCL", name: "Circle", tier: "stock", address: "0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5", decimals: 18, feed: "0x6652eDf64bA3731C4F2D3ce821A0Fb1f1f6b482a" },
  { symbol: "CRWD", name: "CrowdStrike", tier: "stock", address: "0xea72Ecca2d0f6bFA1394DBBCff85b52CD4233931", decimals: 18 },
  { symbol: "CRWV", name: "CoreWeave", tier: "stock", address: "0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3", decimals: 18, feed: "0xe1b3aABCAFAd1c94708dc1367dcfF8Aa4407487C" },
  { symbol: "DDOG", name: "Datadog", tier: "stock", address: "0x27c99fBde9D0d2AA4f4Bfb4943f237843DdF6958", decimals: 18 },
  { symbol: "DELL", name: "Dell", tier: "stock", address: "0x941AE714EC6D8130c7B75d67160Ca08f1e7d11Dd", decimals: 18 },
  { symbol: "ELF", name: "e.l.f. Beauty", tier: "stock", address: "0x39EC44Bee4F6A116c6F9B8De566848a985C53C60", decimals: 18 },
  { symbol: "F", name: "Ford", tier: "stock", address: "0x25C288E6D899b9BC30160965aD9644c67e73bE0C", decimals: 18 },
  { symbol: "FLNC", name: "Fluence Energy", tier: "stock", address: "0x282e87451E10fA6679BC7D76C69BE44cD3fC777C", decimals: 18 },
  { symbol: "FUTU", name: "Futu", tier: "stock", address: "0xeB30663bDFf0622Ef4e4E5cBb4E975F19f33f51D", decimals: 18 },
  { symbol: "GLW", name: "Corning", tier: "stock", address: "0x7c04E6A3368F2A1DE3874f0e80d2e0A1a9915da6", decimals: 18 },
  { symbol: "GME", name: "GameStop", tier: "stock", address: "0x1b0E319c6A659F002271B69dB8A7df2F911c153E", decimals: 18, feed: "0x27C71df6A64fB476468EdF256CF72c038baB5B67" },
  { symbol: "GOOGL", name: "Alphabet", tier: "stock", address: "0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3", decimals: 18, feed: "0xF6f373a037c30F0e5010d854385cA89185AE638b" },
  { symbol: "INOD", name: "Innodata", tier: "stock", address: "0xf1953DAB6FaD537488d5A022361FfAa8B4c95eC6", decimals: 18 },
  { symbol: "INTC", name: "Intel", tier: "stock", address: "0xc72b96e0E48ecd4DC75E1e45396e26300BC39681", decimals: 18, feed: "0x3f390C5C24628Ac7C489515402235FeAD71D1913" },
  { symbol: "INTU", name: "Intuit", tier: "stock", address: "0x56d23beE5f41A7120170b0c603Dae30128e460e9", decimals: 18 },
  { symbol: "IONQ", name: "IonQ", tier: "stock", address: "0x558378E000D634A36593E338eBacdd6207640EfE", decimals: 18, feed: "0x22EfeC4919baf55F360E0EDee4AbEB26DE4971eb" },
  { symbol: "IREN", name: "IREN Limited", tier: "stock", address: "0xF0AB0c93bE6F41369d302e55db1A96b3c430212D", decimals: 18 },
  { symbol: "LITE", name: "Lumentum", tier: "stock", address: "0x8eF20885F94e3D9bc7eB3080279188Bd5ED7c08C", decimals: 18 },
  { symbol: "LLY", name: "Eli Lilly", tier: "stock", address: "0x8005d266423c7ea827372c9c864491e5786600ea", decimals: 18 },
  { symbol: "LULU", name: "Lululemon", tier: "stock", address: "0x4e62068525Ab11FE768e29dfD00ef909B9803016", decimals: 18 },
  { symbol: "LUNR", name: "Intuitive Machines", tier: "stock", address: "0xa5D4968421bA94814Be3B136b15cf422101aC1a3", decimals: 18 },
  { symbol: "MDB", name: "MongoDB", tier: "stock", address: "0xDdf2266b79abf0B48898959B0ed6E6adf512be74", decimals: 18 },
  { symbol: "META", name: "Meta", tier: "stock", address: "0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35", decimals: 18, feed: "0x7C38C00C30BEe9378381E7B6135d7283356D71b1" },
  { symbol: "MRVL", name: "Marvell", tier: "stock", address: "0x62fd0668e10D8B72339BE2DCF7643001688ff13B", decimals: 18 },
  { symbol: "MSFT", name: "Microsoft", tier: "stock", address: "0xe93237C50D904957Cf27E7B1133b510C669c2e74", decimals: 18, feed: "0x45C3C877C15E6BA2EBB19eA114Ea508d14C1Af2E" },
  { symbol: "MSTR", name: "Strategy", tier: "stock", address: "0xec262a75e413fAfD0dF80480274532C79D42da09", decimals: 18, feed: "0x396118bdFB181e6240E74D243F266B061c0edc3D" },
  { symbol: "MU", name: "Micron", tier: "stock", address: "0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD", decimals: 18, feed: "0x425EEFdCf05ed6526C3cE61Af99429A228a6d596" },
  { symbol: "MXL", name: "MaxLinear", tier: "stock", address: "0x48961813349333209994750ffA89b3c5C22eC969", decimals: 18 },
  { symbol: "NBIS", name: "Nebius", tier: "stock", address: "0x9D9c6684F596F66a64C030B93A886D51Fd4D7931", decimals: 18, feed: "0xE1D87B116Ba0fe898998f1D140339D1fA1E09705" },
  { symbol: "NFLX", name: "Netflix", tier: "stock", address: "0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8", decimals: 18 },
  { symbol: "NNE", name: "Nano Nuclear Energy", tier: "stock", address: "0xBEF75684C43c4ea7BD18Dd532a2244674Ee8b926", decimals: 18 },
  { symbol: "NOW", name: "ServiceNow", tier: "stock", address: "0x0C3260aF4B8f13a69c4c2dFb84fD667890CDFa14", decimals: 18 },
  { symbol: "NU", name: "Nu Holdings", tier: "stock", address: "0x408c14038a04f7bD235329E26d2bf569ee20e250", decimals: 18 },
  { symbol: "NVDA", name: "Nvidia", tier: "stock", address: "0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC", decimals: 18, feed: "0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15" },
  { symbol: "NVTS", name: "Navitas", tier: "stock", address: "0xbE6702d7b70315376dC48a3293f24f0982F86386", decimals: 18 },
  { symbol: "ORCL", name: "Oracle", tier: "stock", address: "0xb0992820E760d836549ba69BC7598b4af75dEE03", decimals: 18, feed: "0x0e6a64a2B58A6693a531E6c555f3A5d042eEA844" },
  { symbol: "P", name: "Everpure", tier: "stock", address: "0x1Cdad396DB64BDa184d5182A97Dd9B3C62100b7D", decimals: 18 },
  { symbol: "PENG", name: "Penguin Solutions", tier: "stock", address: "0x9b23573b156B52565012F5cE02CDF60AFBaa70Be", decimals: 18 },
  { symbol: "PLTR", name: "Palantir", tier: "stock", address: "0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A", decimals: 18, feed: "0x820ABedFF239034956B7A9d2F0a331f9F075eB4c" },
  { symbol: "POET", name: "POET Technologies", tier: "stock", address: "0xcf6B2D875361be807EAfa57458c80f28521F9333", decimals: 18 },
  { symbol: "PR", name: "Permian Resources", tier: "stock", address: "0x4189F0c66EBBB0bfeF1C31f763131361EF32f77C", decimals: 18 },
  { symbol: "QBTS", name: "D-Wave Quantum", tier: "stock", address: "0xC583c60aeF9Dc401Da72cEC1B404743a93cea1Cc", decimals: 18 },
  { symbol: "QCOM", name: "Qualcomm", tier: "stock", address: "0x0f17206447090e464C277571124dD2688E48AEA9", decimals: 18 },
  { symbol: "QUBT", name: "Quantum Computing", tier: "stock", address: "0x59818904ab4cE163b3cE4FfB64f2D6Ca02c434B4", decimals: 18 },
  { symbol: "RBLX", name: "Roblox", tier: "stock", address: "0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8", decimals: 18 },
  { symbol: "RDDT", name: "Reddit", tier: "stock", address: "0x05b37Fb53A299a1b874A619e1c4C404D52C36F4C", decimals: 18 },
  { symbol: "RDW", name: "Redwire", tier: "stock", address: "0x92Ef19E82bD8fF36661DE838D5eaE7e5CEF0EfFE", decimals: 18 },
  { symbol: "RGTI", name: "Rigetti", tier: "stock", address: "0x284358abc07F9359f19f4b5b4aC91901Be2597Ba", decimals: 18, feed: "0x2A045cF1C49c61c166C036d2f06FA2D2d984f765" },
  { symbol: "RIVN", name: "Rivian Automotive", tier: "stock", address: "0xB1BF26c1D20ff267A4f93550d1E0d06ac40a114B", decimals: 18 },
  { symbol: "RKLB", name: "Rocket Lab", tier: "stock", address: "0x3b14C39E89D60D627b42a1A4CA45b5bb45Fc12e2", decimals: 18, feed: "0x045477BF65Aef6f4F2386ad0164579e48381CC74" },
  { symbol: "SATS", name: "EchoStar", tier: "stock", address: "0x95052ddcd5DC25641657424A8Cf04834997E1730", decimals: 18 },
  { symbol: "SHOP", name: "Shopify", tier: "stock", address: "0xF53F66751B1Eff985311b693531E3290F600c410", decimals: 18 },
  { symbol: "SMCI", name: "Super Micro", tier: "stock", address: "0xc01aA1fECeC0605b13bc84874ff7256C0f5F562a", decimals: 18 },
  { symbol: "SNDK", name: "SanDisk", tier: "stock", address: "0xB90A19fF0Af67f7779afF50A882A9CfF42446400", decimals: 18, feed: "0xfb133Fa4B7b385802B693a293606682Df47109A3" },
  { symbol: "SOFI", name: "SoFi", tier: "stock", address: "0x98E75885157C80992A8D41b696D8c9C6Fb30A926", decimals: 18 },
  { symbol: "SPCX", name: "SpaceX", tier: "stock", address: "0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa", decimals: 18, feed: "0xB265810950ba6c5C0Ff821c9963014a56fD8Bffb" },
  { symbol: "TSEM", name: "Tower Semiconductor", tier: "stock", address: "0x89776d4Cd68193597A2fC132cfaC1fDe36CCeA8a", decimals: 18 },
  { symbol: "TSLA", name: "Tesla", tier: "stock", address: "0x322F0929c4625eD5bAd873c95208D54E1c003b2d", decimals: 18, feed: "0x4A1166a659A55625345e9515b32adECea5547C38" },
  { symbol: "TSM", name: "TSMC", tier: "stock", address: "0x58FfE4a942d3885bAa22D7520691F611EF09e7AA", decimals: 18, feed: "0x874cF94aa8eC88Fd9560094dD065f2fB3E41Fc2F" },
  { symbol: "TTWO", name: "Take-Two", tier: "stock", address: "0x5e81213613b6B86EaB4c6c50d718d34359459786", decimals: 18 },
  { symbol: "UMC", name: "UMC", tier: "stock", address: "0x0E6e67Ba88e7b5d9B67636A215c76779B948dE79", decimals: 18 },
  { symbol: "UPS", name: "UPS", tier: "stock", address: "0xf23250dac154D05Bb671CB0d0eBEf3c635c79CE2", decimals: 18 },
  { symbol: "USAR", name: "USA Rare Earth", tier: "stock", address: "0xd917B029C761D264c6A312BBbcDA868658eF86a6", decimals: 18, feed: "0xA994d3684e8400A6c8078226925779FdeE682DD9" },
  { symbol: "WDAY", name: "Workday", tier: "stock", address: "0x82DA4646242e1D962e96e932269Dc644c94a9CaA", decimals: 18 },
  { symbol: "XNDU", name: "Xanadu Quantum", tier: "stock", address: "0xA8eB3BCcbf2017eE7CBfb652eB51CF2E1B153289", decimals: 18 },
  { symbol: "XOM", name: "Exxon Mobil", tier: "stock", address: "0xf9B46d3D1B22199D4D1025a9cEDB540A33F1a2d5", decimals: 18 },
  { symbol: "ZM", name: "Zoom", tier: "stock", address: "0x44c4F142009036cF477eD2d09932051843137CF1", decimals: 18 },
  { symbol: "ZS", name: "Zscaler", tier: "stock", address: "0x7dc013eB55e436f30d7ED1AFE4E36d6e45e3c3f7", decimals: 18 },
];

// ---- 9 tokenized ETFs ----
export const ETFS: Asset[] = [
  { symbol: "EWY", name: "South Korea ETF", tier: "etf", address: "0x7f0aBeF0C07280F82c6a08ead09dEd6BAE2C13Fc", decimals: 18, feed: "0xEFdf54610B62A7753Ec30bDc380847c12D32e1D1" },
  { symbol: "QQQ", name: "Nasdaq 100 ETF", tier: "etf", address: "0xD5f3879160bc7c32ebb4dC785F8a4F505888de68", decimals: 18, feed: "0x80901d846d5D7B030F26B480776EE3b29374C2ae" },
  { symbol: "SGOV", name: "0-3M Treasury ETF", tier: "etf", address: "0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5", decimals: 18, feed: "0xa0DF4ee0fFf975306345875E3548Fcc519577A11" },
  { symbol: "SLV", name: "Silver ETF", tier: "etf", address: "0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f", decimals: 18, feed: "0x209b73908e92Ae021826eD79609845451Ecba2ce" },
  { symbol: "SOXX", name: "Semiconductor ETF", tier: "etf", address: "0x75742c18BC1f1C5c5f448f4C9D9C6F66dafAAa38", decimals: 18 },
  { symbol: "SPMO", name: "S&P 500 Momentum ETF", tier: "etf", address: "0xAd622320e520de39e72d41EF07438C3Fd3354875", decimals: 18 },
  { symbol: "SPY", name: "S&P 500 ETF", tier: "etf", address: "0x117cc2133c37B721F49dE2A7a74833232B3B4C0C", decimals: 18, feed: "0x319724394D3A0e3669269846abE664Cd621f9f6A" },
  { symbol: "USO", name: "Oil ETF", tier: "etf", address: "0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344", decimals: 18, feed: "0x75a9c76Ef439e2C7c2E5a34Ab105EcFe3766431c" },
  { symbol: "XLK", name: "Tech Sector ETF", tier: "etf", address: "0x15Cd20759CE7F3285c29A319dE2D1A2e098c6f43", decimals: 18 },
];

export const ALL_ASSETS: Asset[] = [...STOCKS, ...ETFS];

const BY_SYMBOL = new Map(ALL_ASSETS.map((a) => [a.symbol, a]));

/** Look up an asset by ticker symbol (undefined if not in the registry). */
export function assetBySymbol(symbol: string): Asset | undefined {
  return BY_SYMBOL.get(symbol);
}

/**
 * Tokens the Arcus router refuses outright (422 on both /v1/price and /v1/quote),
 * so they can be neither priced nor traded. Listed rather than silently failing
 * at the review sheet. Re-check if Arcus adds them.
 */
export const UNSUPPORTED_SYMBOLS = new Set(["CRWD", "SATS"]);

/** True if `symbol` is a tradable Robinhood stock/ETF token. */
export function isTradable(symbol: string): boolean {
  return BY_SYMBOL.has(symbol) && !UNSUPPORTED_SYMBOLS.has(symbol);
}
