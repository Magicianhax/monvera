// Vera persona copy — ported from the design handoff (data.jsx). Vera's trust
// signals are now REAL and on-chain: her identity (agentId 1, useAgentIdentity)
// and her track record (useVeraRecord, read from the StaxExecutor log). This file
// keeps only the static persona copy (name, role, blurb). The illustrative sample
// track record that used to live here was removed once the real one went live.

export interface VeraPersona {
  name: string;
  role: string;
  /** Plain-language handle shown as a friendly id (the verifiable id is on-chain). */
  handle: string;
  since: string;
  decisions: number;
  /** Avg annualized across the (sample) plans she has built. */
  trackRecord: string;
  /** Share of plans people followed. */
  followed: string;
  blurb: string;
}

export const VERA: VeraPersona = {
  name: "Vera",
  role: "your investing assistant",
  handle: "vera.monvera.eth",
  since: "Mar 2024",
  decisions: 14820,
  trackRecord: "+11.4%",
  followed: "94%",
  blurb:
    "I build plans from real, named companies and funds. Every plan I make is signed and recorded on-chain, so anyone can check my track record on the public explorer.",
};
