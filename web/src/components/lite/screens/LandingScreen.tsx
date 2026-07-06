"use client";

// Editorial landing / signed-out screen — faithful re-skin of the design
// (screens_onboarding.jsx · Landing). Wired to the REAL Privy auth:
//   - "Get started" / Google / X / Connect account open the Privy modal scoped
//     to that login method via useLogin().login({ loginMethods }).
//   - In-progress + error states come from Privy's modal lifecycle callbacks.
import { useEffect, useRef, useState } from "react";
import { useLogin, useModalStatus } from "@privy-io/react-auth";
import { Icon, MonveraWordmark, AssetTile } from "@/components/design";
import { VeraMascot } from "@/components/design/VeraMascot";
import { displayFor } from "@/lib/displayAssets";

type Method = "email" | "google" | "x" | "wallet";

// A handful of recognisable names for the floating proof tiles.
const PROOF = ["AAPL", "NVDA", "GOOGL", "SPY", "META"].map((s) => displayFor(s));

function Spinner({ small }: { small?: boolean }) {
  const s = small ? 18 : 22;
  return (
    <span
      className="spin"
      style={{
        width: s,
        height: s,
        borderRadius: "50%",
        border: "2.4px solid color-mix(in srgb, currentColor 35%, transparent)",
        borderTopColor: "currentColor",
        display: "inline-block",
      }}
    />
  );
}

export function LandingScreen() {
  const [signing, setSigning] = useState<Method | null>(null);
  const [error, setError] = useState(false);

  const { login } = useLogin({
    onComplete: () => setSigning(null),
    onError: () => {
      setSigning(null);
      setError(true);
    },
  });

  // If the user dismisses the Privy modal without finishing, neither callback
  // fires — clear the in-progress spinner when the modal closes after opening.
  const { isOpen } = useModalStatus();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) {
      wasOpen.current = true;
    } else if (wasOpen.current) {
      wasOpen.current = false;
      setSigning(null);
    }
  }, [isOpen]);

  // Privy presents a single modal; we scope it to the chosen method so the UI
  // matches the design's per-button intent. The AppShell handles what happens
  // *after* auth (new accounts -> funding, etc.).
  const onSignIn = (m: Method) => {
    setError(false);
    setSigning(m);
    const loginMethods =
      m === "google" ? (["google"] as const)
      : m === "x" ? (["twitter"] as const)
      : m === "wallet" ? (["wallet"] as const)
      : (["email", "google", "twitter", "wallet"] as const);
    login({ loginMethods: [...loginMethods] });
  };

  return (
    <div className="screen screen-pad-top" style={{ justifyContent: "space-between" }}>
      {/* Vera, the brand watermark — big, half off the right edge, behind the
          content (z 0 vs content z 1), with a soft brand glow beneath her. */}
      <div aria-hidden style={{ position: "absolute", right: 0, bottom: "21%", zIndex: 0, pointerEvents: "none", transform: "translateX(46%)" }}>
        <span
          style={{
            position: "absolute",
            inset: "-12%",
            borderRadius: "50%",
            background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 30%, transparent), transparent 68%)",
            filter: "blur(30px)",
          }}
        />
        <VeraMascot size={400} style={{ opacity: 0.3, position: "relative" }} />
      </div>

      {/* hero */}
      <div style={{ padding: "30px 22px 0", position: "relative", zIndex: 1 }}>
        <div className="anim-rise" style={{ marginBottom: 40 }}>
          <MonveraWordmark size={30} />
        </div>

        <div className="anim-rise" style={{ animationDelay: ".05s" }}>
          <h1 className="display-xl" style={{ margin: 0 }}>
            Own a piece of
            <br />
            what you
            <br />
            believe in.
          </h1>
          <p className="body" style={{ marginTop: 20, fontSize: 17, maxWidth: 320 }}>
            Tell Vera your goal in your own words. She builds a real investment in companies you
            know, and places it in one tap.
          </p>
        </div>

        {/* floating proof tiles */}
        <div
          className="anim-rise"
          style={{ animationDelay: ".12s", display: "flex", gap: 8, marginTop: 28, flexWrap: "wrap" }}
        >
          {PROOF.map((a) => (
            <AssetTile key={a.name} asset={a} size={40} />
          ))}
          <div className="body-sm" style={{ display: "flex", alignItems: "center", paddingLeft: 4 }}>
            Apple, Nvidia,
            <br />
            the S&amp;P 500 &amp; more
          </div>
        </div>
      </div>

      {/* actions */}
      <div
        className="anim-rise"
        style={{ animationDelay: ".18s", padding: "20px 22px calc(26px + env(safe-area-inset-bottom))", position: "relative", zIndex: 1 }}
      >
        {error && (
          <div
            className="anim-rise"
            style={{
              display: "flex",
              gap: 9,
              alignItems: "center",
              background: "color-mix(in srgb, var(--neg) 12%, transparent)",
              color: "var(--neg)",
              padding: "12px 14px",
              borderRadius: "var(--rr)",
              marginBottom: 12,
              fontSize: 14,
              fontWeight: 500,
            }}
          >
            <Icon name="info" size={18} /> Couldn&apos;t sign you in. Please try again.
          </div>
        )}

        <button
          className="btn btn-primary btn-block btn-lg tap"
          disabled={signing !== null}
          onClick={() => onSignIn("email")}
        >
          {signing === "email" ? <Spinner /> : <>Get started</>}
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "16px 2px" }}>
          <div className="divider" style={{ flex: 1 }} />
          <span className="caption" style={{ color: "var(--ink-3)" }}>or continue with</span>
          <div className="divider" style={{ flex: 1 }} />
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <button
            className="btn btn-outline tap"
            style={{ flex: 1, height: 52 }}
            disabled={signing !== null}
            onClick={() => onSignIn("google")}
            aria-label="Continue with Google"
          >
            {signing === "google" ? <Spinner small /> : <span style={{ fontWeight: 600, fontSize: 18 }}>G</span>}
          </button>
          <button
            className="btn btn-outline tap"
            style={{ flex: 1, height: 52 }}
            disabled={signing !== null}
            onClick={() => onSignIn("x")}
            aria-label="Continue with X"
          >
            {signing === "x" ? <Spinner small /> : <span style={{ fontWeight: 600, fontSize: 18 }}>X</span>}
          </button>
          <button
            className="btn btn-outline tap"
            style={{ flex: 1, height: 52 }}
            disabled={signing !== null}
            onClick={() => onSignIn("wallet")}
            title="Connect existing account"
            aria-label="Connect existing account"
          >
            {signing === "wallet" ? <Spinner small /> : <Icon name="wallet" size={22} />}
          </button>
        </div>

        <p className="caption" style={{ textAlign: "center", marginTop: 18, lineHeight: 1.5, fontWeight: 500, color: "var(--ink-2)" }}>
          No seed phrases, no paperwork. Stocks can go down as well as up.
        </p>
      </div>
    </div>
  );
}
