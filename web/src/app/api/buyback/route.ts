// GET /api/buyback — public $MONVERA buyback transparency data: treasury revenue,
// the 20%-of-net buyback budget, totals, average price, expenses, and the full
// list of on-chain buybacks. Runs the (throttled) indexer first so new buys are
// recorded. No auth; not geo-gated.
import { maybeIndex, getBuybackData } from "@/lib/server/buybackStore";
import { serverError } from "@/lib/server/respond";

export const revalidate = 0;

export async function GET() {
  try {
    try {
      await maybeIndex();
    } catch {
      /* indexing is best-effort; still serve the current stored data */
    }
    const data = await getBuybackData();
    return Response.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=180",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return serverError("buyback", err);
  }
}
