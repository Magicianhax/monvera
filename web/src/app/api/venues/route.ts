// GET /api/venues — which execution venues are currently enabled.
//
// The order ticket shows "N venues competing for your best rate" while a quote
// is in flight, and it can't read the server-side kill switches. Public, cheap
// and non-sensitive: it exposes venue NAMES only, never keys, fees or routing.
import { venueEnabled, type VenueName } from "@/lib/server/venueFlags";

const ALL: VenueName[] = ["arcus", "rialto", "lifi", "uniswap", "kyber"];

export async function GET() {
  return Response.json(
    { venues: ALL.filter(venueEnabled) },
    // Flags change on deploy, not per request.
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
  );
}
