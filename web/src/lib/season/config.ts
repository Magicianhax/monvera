// Season 1 configuration. One object, so no magic numbers leak elsewhere.
//
// TESTNET (Robinhood Chain Testnet 46630). seasonStart and the deploy block are
// the two values that must be pinned before a real season is computed; both are
// env-overridable so the same code serves testnet rehearsal and mainnet.
import type { SeasonParams } from "./compute";
import { STAKING_ADDRESSES } from "@/lib/staking";

const E = (typeof process !== "undefined" ? process.env : {}) as Record<string, string | undefined>;

/** Block MonveraStaking was deployed at (records the log-scan floor). On the
 *  tiny testnet, scanning from 0 is fine; on mainnet set SEASON_DEPLOY_BLOCK. */
export const DEPLOY_BLOCK = BigInt(E.SEASON_DEPLOY_BLOCK ?? "0");

/** UTC unix seconds of Season 1 day-0 00:00. Owner-set; no safe default, so a
 *  rehearsal must pass it explicitly. Falls back to NEXT_PUBLIC_SEASON_START so a
 *  single value drives both the server preview (this) and the client strip
 *  (staking.ts). NEVER open a real season without setting it. */
export const SEASON_START = BigInt(E.SEASON_START ?? E.NEXT_PUBLIC_SEASON_START ?? "0");

export const SEASON1: SeasonParams = {
  seasonId: BigInt(0),
  seasonStart: SEASON_START,
  days: 90,
  pool: BigInt(2_000_000) * BigInt(10) ** BigInt(18),
  exclude: new Set<string>(), // sybil cluster, if any; lowercased addresses
};

export const STAKING = STAKING_ADDRESSES.staking;
