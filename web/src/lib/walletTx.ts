// A normalized wallet transfer (in or out), shared by the /api/transactions
// route and the UI. Direction is relative to the user's wallet.
export interface WalletTx {
  hash: `0x${string}`;
  direction: "in" | "out";
  /** Our registry symbol when known (USDC, AAPL…), else the on-chain asset symbol. */
  symbol: string;
  /** Human amount of the asset moved. */
  amount: number;
  /** The other party (recipient if out, sender if in). */
  counterparty: string;
  /** Token contract address ("" for native MNT). */
  tokenAddress: string;
  blockNumber: number;
  /** Unix seconds, when resolvable. */
  timestamp?: number;
}
