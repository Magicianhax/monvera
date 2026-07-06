// Small, jargon-free formatting helpers for the Monvera UI.
// Copy rule: we say "free" not "gas", "account" not "wallet".
import { EXPLORER_URL } from "./chain";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const USD_WHOLE = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** $1,234.56 — for precise dollar amounts. */
export function usd(n: number): string {
  if (!Number.isFinite(n)) return "$0.00";
  return USD.format(n);
}

/** $1,234 — for round-number CTAs/headlines. */
export function usdWhole(n: number): string {
  if (!Number.isFinite(n)) return "$0";
  return USD_WHOLE.format(n);
}

/** 12.5% */
export function pct(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  return `${Number(n.toFixed(2))}%`;
}

/** Convert a raw token amount (bigint) at `decimals` to a JS number (display only). */
export function fromUnits(raw: bigint, decimals: number): number {
  if (decimals <= 0) return Number(raw);
  const s = raw.toString().padStart(decimals + 1, "0");
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals);
  return Number(`${whole}.${frac}`);
}

/** Token quantity, trimmed to a sensible number of significant places for display. */
export function tokenQty(raw: bigint, decimals: number): string {
  const n = fromUnits(raw, decimals);
  if (n === 0) return "0";
  if (n < 0.0001) return n.toExponential(2);
  if (n < 1) return n.toFixed(4);
  if (n < 1000) return n.toFixed(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** 0xabc…1234 — shortened address for trust signals. */
export function shortAddress(addr?: string): string {
  if (!addr || addr.length < 10) return addr ?? "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** A token amount, up to 4 dp, grouped. */
export function fmtAmt(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

/** Relative time ("just now", "3h ago", "Mar 4") from a unix-seconds stamp. */
export function relTime(sec?: number): string {
  if (!sec) return "";
  const diff = Math.floor(Date.now() / 1000) - sec;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86_400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604_800) return `${Math.floor(diff / 86_400)}d ago`;
  return new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Map a 0-10000 bps risk score to a friendly label + 0-100 meter value.
 * Lower = steadier, higher = bolder.
 */
export function riskLabel(bps: number): { label: string; value: number; tone: "success" | "warning" | "danger" | "accent" } {
  const value = Math.max(0, Math.min(100, Math.round(bps / 100)));
  if (value < 25) return { label: "Steady", value, tone: "success" };
  if (value < 50) return { label: "Balanced", value, tone: "accent" };
  if (value < 75) return { label: "Bold", value, tone: "warning" };
  return { label: "Spicy", value, tone: "danger" };
}

/** Block explorer tx link (Blockscout). */
export function txUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

/** Block explorer address/token link (Blockscout). */
export function addressUrl(addr: string): string {
  return `${EXPLORER_URL}/address/${addr}`;
}
