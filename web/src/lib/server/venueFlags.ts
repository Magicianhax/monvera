import "server-only";

// Per-venue kill switches. Flip via env without touching code:
//   VENUE_ARCUS=on|off     (default OFF — paused while its settles keep failing;
//                           all Arcus code stays wired for the day it's back)
//   VENUE_RIALTO=on|off    (default ON — inert anyway until RIALTO_API_KEY lands)
//   VENUE_LIFI=on|off      (default ON)
//   VENUE_UNISWAP=on|off   (default ON)
export type VenueName = "arcus" | "rialto" | "lifi" | "uniswap";

const DEFAULTS: Record<VenueName, boolean> = {
  arcus: false,
  rialto: true,
  lifi: true,
  uniswap: true,
};

export function venueEnabled(name: VenueName): boolean {
  const raw = process.env[`VENUE_${name.toUpperCase()}`];
  if (raw === "on") return true;
  if (raw === "off") return false;
  return DEFAULTS[name];
}
