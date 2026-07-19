import { UNIVERSE, assetBySymbol, USDC_SOL_MINT } from "../src/universe";

test("universe has usable depth and unique symbols", () => {
  expect(UNIVERSE.length).toBeGreaterThanOrEqual(20);
  expect(new Set(UNIVERSE.map((a) => a.symbol)).size).toBe(UNIVERSE.length);
  expect(new Set(UNIVERSE.map((a) => a.mint)).size).toBe(UNIVERSE.length);
});

test("every mint carries the genuine Backed Xs prefix", () => {
  for (const a of UNIVERSE) expect(a.mint.startsWith("Xs"), a.symbol).toBe(true);
});

test("lookup by xStock symbol or underlying, case-insensitive", () => {
  expect(assetBySymbol("AAPLx")?.underlying).toBe("AAPL");
  expect(assetBySymbol("aapl")?.symbol).toBe("AAPLx");
  expect(assetBySymbol("NOPE")).toBeUndefined();
});

test("USDC mint constant is the canonical Solana USDC", () => {
  expect(USDC_SOL_MINT).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
});
