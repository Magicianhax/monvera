import "server-only";

// Per-venue kill switches. Flip via env without touching code:
//   VENUE_ARCUS=on|off     (default OFF — paused while its settles keep failing;
//                           all Arcus code stays wired for the day it's back)
//   VENUE_RIALTO=on|off    (default ON — inert anyway until RIALTO_API_KEY lands)
//   VENUE_LIFI=on|off      (default ON)
//   VENUE_UNISWAP=on|off   (default ON)
//   VENUE_KYBER=on|off     (default OFF — quotes verified, settlement path not
//                           yet proven on a real fill; flip on after testing)
export type VenueName = "arcus" | "rialto" | "lifi" | "uniswap" | "kyber";

const DEFAULTS: Record<VenueName, boolean> = {
  arcus: false,
  rialto: true,
  lifi: true,
  uniswap: true,
  kyber: false,
};

// A venue can be flagged ON and still be structurally unable to quote, because
// its credentials are missing. That used to leak two ways: /api/quote burned a
// parallel slot on a guaranteed null, and /api/venues counted it toward the
// "N venues competing for your best rate" line the UI shows the user. Claiming
// a competitor that never bids is not something a money surface should do, so
// capability is part of "enabled".
const REQUIRES: Partial<Record<VenueName, () => boolean>> = {
  rialto: () => Boolean(process.env.RIALTO_API_KEY),
  lifi: () => Boolean(process.env.LIFI_API_KEY),
};

export function venueEnabled(name: VenueName): boolean {
  const raw = process.env[`VENUE_${name.toUpperCase()}`];
  const on = raw === "on" ? true : raw === "off" ? false : DEFAULTS[name];
  if (!on) return false;
  const capable = REQUIRES[name];
  return capable ? capable() : true;
}
