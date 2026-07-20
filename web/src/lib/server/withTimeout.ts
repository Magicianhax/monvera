import "server-only";

// Race a promise against a deadline.
//
// `.catch()` only handles a REJECTION — a promise that never settles (a hung
// RPC, a stalled upstream fetch with no signal) blocks forever. On an ISR page
// that means the visitor stares at a blank tab until the edge gives up: the
// landing page was measured hanging for 90s+ during a cold regeneration while
// it awaited an on-chain scan.
//
// Server rendering must degrade, never hang: every page-level await of a live
// data source should carry a ceiling and a fallback the UI already handles.
export async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T, label?: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => {
          if (label) console.warn(`[timeout] ${label} exceeded ${ms}ms — rendering without it`);
          resolve(fallback);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
