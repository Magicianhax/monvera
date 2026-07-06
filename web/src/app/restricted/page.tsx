import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Not available in your region",
  robots: { index: false },
};

// Shown (via middleware rewrite) to visitors in regions where Monvera is not
// offered (US, Canada, UK, Switzerland). Plain words, no jargon, no dead end.
export default function RestrictedPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        padding: "0 28px",
        textAlign: "center",
        background: "#0f1211",
        color: "#eef2f0",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <span
        style={{
          width: 56,
          height: 56,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 14,
          background: "linear-gradient(135deg, #47b585, #24895a)",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/brand/monvera-icon-white.png" alt="" width={34} height={34} decoding="async" style={{ width: 34, height: 34, display: "block" }} />
      </span>
      <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, letterSpacing: "-.02em" }}>
        Monvera isn&apos;t available in your region
      </h1>
      <p style={{ margin: 0, maxWidth: 440, fontSize: 15.5, lineHeight: 1.6, color: "#aeb6b3" }}>
        Due to local regulations, Monvera can&apos;t offer tokenized stocks in the United States,
        Canada, the United Kingdom, or Switzerland. If you believe you&apos;re seeing this by
        mistake, contact us on X{" "}
        <a href="https://x.com/monvera_best" style={{ color: "#43ba85" }}>
          @monvera_best
        </a>
        .
      </p>
    </main>
  );
}
