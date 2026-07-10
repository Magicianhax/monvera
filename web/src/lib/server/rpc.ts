import "server-only";

// Server-side RPC selection: prefer the keyed Alchemy endpoint, fall back to the
// public one. The public RPC rate-limits and drops long eth_getLogs scans, which
// surfaced as flaky 500s on /api/vera-record and slow portfolio reads. The key
// already lives in env for walletTransfers; every server chain-reader should be
// on the same endpoint. Client-side code keeps the public NEXT_PUBLIC_RPC_URL —
// the key must never reach a browser bundle.
import { RPC_URL } from "@/lib/chain";

const ALCHEMY_KEY = process.env.ALCHEMY_API_KEY;

export const SERVER_RPC_URL = ALCHEMY_KEY
  ? `https://robinhood-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
  : RPC_URL;

/** True when server reads go through the keyed Alchemy endpoint. */
export const HAS_KEYED_RPC = Boolean(ALCHEMY_KEY);
