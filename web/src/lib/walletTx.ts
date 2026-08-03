// A normalized wallet transfer (in or out), shared by the /api/transactions
// route and the UI. Direction is relative to the account that was swept.
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
  /** Which of the user's accounts this row was swept from. Absent = the EOA
   *  (rows predating the smart-account sweep). Grove buys/exits happen at the
   *  SMART account, so without its rows those events were invisible or showed
   *  as a bare "Sent cash" to a stranger. */
  account?: "eoa" | "smart";
}
