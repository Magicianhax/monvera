// Static offline fallback shown when a navigation fails with no connection.
// Fully static (no client data deps) so the service worker precaches it cleanly.
export default function OfflinePage() {
  return (
    <main className="stax" data-theme="soft" data-mode="dark">
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
          background: "var(--surface-2)",
          color: "var(--ink)",
        }}
      >
        <div
          style={{
            maxWidth: 380,
            padding: "26px 24px",
            borderRadius: "var(--rr-lg, 22px)",
            background: "var(--glass)",
            backdropFilter: "var(--glass-blur)",
            WebkitBackdropFilter: "var(--glass-blur)",
            border: "1px solid var(--glass-stroke)",
            boxShadow: "var(--glass-hi), var(--glass-shadow)",
          }}
        >
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--primary)" }}>You&apos;re offline</h1>
          <p style={{ marginTop: 10, fontSize: 15, color: "var(--ink-2)", lineHeight: 1.5 }}>
            Monvera needs a connection to load your portfolio. Reconnect and we&apos;ll pick up right where you left
            off.
          </p>
        </div>
      </div>
    </main>
  );
}
