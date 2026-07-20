"use client";

// Route-level error boundary. There was none before, which mattered more once
// the app's panels became lazy chunks: if a chunk fails to arrive — a flaky
// phone connection, or a deploy that replaced the file while a tab sat open —
// React throws during render and, with no boundary, the entire app unmounts to
// a blank screen. That is unacceptable on a money app.
//
// Two recovery paths, because the two failure classes differ:
//   reset()  — re-render in place; fixes transient render errors.
//   reload   — fetches fresh HTML with current chunk names; the ONLY fix for a
//              stale chunk after a deploy, which is the likeliest cause here.
import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[route-error]", error);
    // A failed dynamic import is almost always a stale chunk: the tab was open
    // across a deploy. Reload once (guarded by sessionStorage so a genuinely
    // broken build can never trap the user in a refresh loop).
    const stale = /Loading chunk|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i;
    if (stale.test(error.message)) {
      try {
        if (!sessionStorage.getItem("mv.chunkReload")) {
          sessionStorage.setItem("mv.chunkReload", "1");
          location.reload();
        }
      } catch {
        /* storage blocked (private mode) — fall through to the manual buttons */
      }
    }
  }, [error]);

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: 28,
        textAlign: "center",
        background: "#12181b",
        color: "#eef2f0",
        fontFamily: "system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ maxWidth: 400 }}>
        <h1 style={{ fontSize: 21, fontWeight: 700, color: "#43ba85", margin: 0 }}>
          That screen didn&rsquo;t load
        </h1>
        <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.55, color: "#aeb6b3" }}>
          Nothing happened to your money — this is the page failing to load, not a
          problem with your account. Your holdings are safe in your wallet.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "center" }}>
          <button
            onClick={() => reset()}
            style={{
              height: 42,
              padding: "0 22px",
              borderRadius: 999,
              border: 0,
              background: "#43ba85",
              color: "#0f1413",
              fontSize: 14.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
          <button
            onClick={() => location.reload()}
            style={{
              height: 42,
              padding: "0 22px",
              borderRadius: 999,
              border: "1px solid #303840",
              background: "transparent",
              color: "#eef2f0",
              fontSize: 14.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </div>
    </div>
  );
}
