// Static offline fallback shown when a navigation fails with no connection.
// Fully static (no client data deps) so the service worker precaches it cleanly.
//
// Self-healing: this page must never be a dead end. A transient drop (phone
// waking, elevator, flaky hotel wifi) used to strand people here until they
// manually reloaded — the inline script below returns to the app the moment
// connectivity is back (online event + a 3s reachability ping), plus a manual
// Retry button for impatient thumbs.
const RECOVERY_SCRIPT = `
(function () {
  var target = "/app";
  var going = false;
  function go() { if (going) return; going = true; location.replace(target); }
  function ping() {
    fetch("/manifest.webmanifest", { method: "HEAD", cache: "no-store" })
      .then(function (r) { if (r.ok) go(); })
      .catch(function () {});
  }
  window.addEventListener("online", ping);
  setInterval(ping, 3000);
  ping();
})();
`;

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
            Monvera needs a connection to load your portfolio. The moment you&apos;re back, this
            page returns to the app by itself.
          </p>
          <a
            href="/app"
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              marginTop: 16,
              height: 42,
              padding: "0 26px",
              borderRadius: 999,
              fontSize: 14.5,
              fontWeight: 600,
              background: "var(--primary)",
              color: "var(--primary-ink, #fff)",
              textDecoration: "none",
            }}
          >
            Try again now
          </a>
        </div>
      </div>
      <script dangerouslySetInnerHTML={{ __html: RECOVERY_SCRIPT }} />
    </main>
  );
}
