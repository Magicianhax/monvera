"use client";

// Last-resort boundary: catches errors thrown by the root layout itself, where
// app/error.tsx cannot help (it renders INSIDE that layout). Next replaces the
// whole document here, so this file must ship its own <html>/<body> and cannot
// rely on providers, fonts, or global CSS — everything is inline on purpose.
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global-error]", error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            textAlign: "center",
            background: "#12181b",
            color: "#eef2f0",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ maxWidth: 400 }}>
            <h1 style={{ fontSize: 21, fontWeight: 700, color: "#43ba85", margin: 0 }}>
              Monvera hit an error
            </h1>
            <p style={{ marginTop: 10, fontSize: 15, lineHeight: 1.55, color: "#aeb6b3" }}>
              Your funds are untouched — they live in your own wallet on-chain, not in
              this page. Reload to come back.
            </p>
            <button
              onClick={() => reset()}
              style={{
                marginTop: 20,
                height: 42,
                padding: "0 24px",
                borderRadius: 999,
                border: 0,
                background: "#43ba85",
                color: "#0f1413",
                fontSize: 14.5,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Reload Monvera
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
