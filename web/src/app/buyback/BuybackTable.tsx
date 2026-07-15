"use client";

// Paginated buyback log (10 per view). Client island so the server page stays
// static; shares the page's CSS module so the styling matches exactly.
import { useState } from "react";
import s from "./buyback.module.css";

export interface Buyback {
  txHash: string;
  blockNumber: number;
  boughtAt: number;
  monveraAmount: number;
  usdgSpent: number;
  priceUsd: number;
}

const EXPLORER = "https://robinhoodchain.blockscout.com";
const PER_PAGE = 10;

const usd = (n: number, dp = 2) => `$${n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const priceStr = (p: number) => (p < 0.01 ? `$${Number(p.toPrecision(3))}` : usd(p, 4));
const short = (h: string) => `${h.slice(0, 6)}…${h.slice(-4)}`;
function when(unix: number): string {
  const d = new Date(unix * 1000);
  return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
}

export function BuybackTable({ buybacks }: { buybacks: Buyback[] }) {
  const [page, setPage] = useState(0);
  const pages = Math.ceil(buybacks.length / PER_PAGE);
  const view = buybacks.slice(page * PER_PAGE, page * PER_PAGE + PER_PAGE);

  return (
    <>
      <div className={s.tableWrap}>
        <table className={s.table}>
          <thead>
            <tr>
              <th>Time</th>
              <th className={s.r}>$MONVERA bought</th>
              <th className={s.r}>Spent</th>
              <th className={s.r}>Price</th>
              <th>Tx</th>
            </tr>
          </thead>
          <tbody>
            {view.map((b) => (
              <tr key={b.txHash}>
                <td>{when(b.boughtAt)}</td>
                <td className={`${s.r} ${s.tnum}`}>{num(b.monveraAmount)}</td>
                <td className={`${s.r} ${s.tnum}`}>{usd(b.usdgSpent)}</td>
                <td className={`${s.r} ${s.tnum} ${s.price}`}>{priceStr(b.priceUsd)}</td>
                <td>
                  <a className={s.txLink} href={`${EXPLORER}/tx/${b.txHash}`} target="_blank" rel="noreferrer">
                    {short(b.txHash)}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className={s.pager}>
          <button className={s.pagerBtn} onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
            Previous
          </button>
          <span className={s.pagerInfo}>
            Page {page + 1} of {pages}
          </span>
          <button className={s.pagerBtn} onClick={() => setPage((p) => Math.min(pages - 1, p + 1))} disabled={page >= pages - 1}>
            Next
          </button>
        </div>
      )}
    </>
  );
}
