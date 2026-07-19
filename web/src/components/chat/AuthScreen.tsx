"use client";

// Signed-out screen on the chat design language — one responsive component for
// phone AND desktop. Liquid aurora background, Vera's orb breathing in a glow
// ring, Fraunces headline, a glass sign-in card, and a slow marquee of real
// stocks drifting along the bottom. Wired to the REAL Privy auth exactly like
// the old LandingScreen: each button scopes the Privy modal to its method.
import { useEffect, useRef, useState } from "react";
import { useLogin, useModalStatus } from "@privy-io/react-auth";
import { useTheme } from "@/hooks/useTheme";
import { AssetTile } from "@/components/design";
import { displayFor } from "@/lib/displayAssets";
import { CHAT_THEME_CSS, CHAT_STYLE_CSS, ChatMark, PIcon, panel } from "./chatKit";
import { useColorStyle } from "@/hooks/useColorStyle";

type Method = "email" | "google" | "x" | "wallet";

// Recognisable names for the drifting proof strip (rendered twice for a
// seamless loop).
const PROOF = ["AAPL", "NVDA", "MSFT", "GOOGL", "META", "AMZN", "TSLA", "SPY", "PLTR", "AMD"].map((s) => ({ symbol: s, d: displayFor(s) }));

// Screen-local CSS: the marquee drift + entrance stagger. Everything else
// (aurora, glass, tokens) comes from CHAT_THEME_CSS.
const AUTH_CSS = `
@keyframes mvadrift{from{transform:translateX(0)}to{transform:translateX(-50%)}}
.mvc .mva-drift{animation:mvadrift 80s linear infinite;width:max-content}
.mvc .mva-in{animation:mvcrise .5s cubic-bezier(.23,1,.32,1) both}
@media (prefers-reduced-motion:reduce){.mvc .mva-drift{animation:none}}
`;

function Spinner({ size = 20 }: { size?: number }) {
  return <PIcon name="ph-circle-notch" size={size} weight="bold" style={{ animation: "mvcspin .8s linear infinite" }} />;
}

/** Small trust badge under the card. */
function Trust({ icon, label }: { icon: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 500, color: "var(--ink-2)" }}>
      <PIcon name={icon} size={15} style={{ color: "var(--primary)" }} /> {label}
    </span>
  );
}

export function AuthScreen({ ready = true }: { ready?: boolean }) {
  const { colorMode } = useTheme();
  const { colorStyle } = useColorStyle();
  const [signing, setSigning] = useState<Method | null>(null);
  const [error, setError] = useState(false);

  // 761px is the same breakpoint the signed-in shells split on.
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 761px)");
    const sync = () => setWide(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const { login } = useLogin({
    onComplete: () => setSigning(null),
    onError: () => { setSigning(null); setError(true); },
  });

  // Privy fires neither callback when the modal is dismissed — clear the
  // in-flight spinner once the modal closes after having opened.
  const { isOpen } = useModalStatus();
  const wasOpen = useRef(false);
  useEffect(() => {
    if (isOpen) wasOpen.current = true;
    else if (wasOpen.current) { wasOpen.current = false; setSigning(null); }
  }, [isOpen]);

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

  const social = (m: Method, icon: string, label: string) => (
    <button
      onClick={() => onSignIn(m)}
      disabled={signing !== null}
      aria-label={label}
      title={label}
      style={{ flex: 1, height: 50, display: "grid", placeItems: "center", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 15, color: "var(--ink)", opacity: signing !== null && signing !== m ? 0.55 : 1 }}
    >
      {signing === m ? <Spinner size={18} /> : <PIcon name={icon} size={21} weight={m === "wallet" ? "duotone" : "fill"} />}
    </button>
  );

  return (
    <div className="mvc" data-mode={colorMode} data-style={colorStyle} style={{ height: "100dvh", width: "100%", display: "flex", flexDirection: "column", fontFamily: "var(--font-ui)", color: "var(--ink)", background: "var(--bg)", overflow: "hidden", position: "relative" }}>
      <style dangerouslySetInnerHTML={{ __html: CHAT_THEME_CSS + CHAT_STYLE_CSS + AUTH_CSS }} />

      {/* wordmark, top-left */}
      <div className="mva-in" style={{ position: "absolute", top: 0, left: 0, right: 0, display: "flex", alignItems: "center", gap: 9, padding: wide ? "22px 28px" : "18px 20px calc(0px + env(safe-area-inset-top))", zIndex: 2 }}>
        <ChatMark size={17} color="var(--ink)" />
        <span className="serif" style={{ fontSize: 19, fontWeight: 600 }}>Monvera</span>
      </div>

      {/* centered column */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: wide ? "0 24px" : "0 20px", position: "relative", zIndex: 1 }}>
        {/* The Monvera mark in a soft static halo — always on, even while Privy boots */}
        <div style={{ position: "relative", marginBottom: wide ? 26 : 20 }}>
          <span aria-hidden style={{ position: "absolute", inset: "-55%", zIndex: -1, borderRadius: "50%", background: "radial-gradient(circle, color-mix(in srgb, var(--primary) 34%, transparent), transparent 68%)", filter: "blur(14px)" }} />
          <ChatMark size={wide ? 62 : 52} color="var(--primary)" />
        </div>

        {ready && (
          <>
            <h1 className="serif mva-in" style={{ margin: 0, fontSize: wide ? 46 : 33, lineHeight: 1.08, fontWeight: 600, textAlign: "center", animationDelay: ".05s", maxWidth: 560 }}>
              Own a piece of what
              <br />
              you believe in.
            </h1>
            <p className="mva-in" style={{ margin: "14px 0 0", fontSize: wide ? 16 : 14.5, lineHeight: 1.55, color: "var(--ink-2)", textAlign: "center", maxWidth: 400, animationDelay: ".1s" }}>
              Tell Vera your goal in your own words. She builds a real investment in companies you know — and places it in one tap.
            </p>

            {/* sign-in card */}
            <div className="mva-in" style={{ ...panel({ borderRadius: 24, padding: wide ? 22 : 18, width: "100%", maxWidth: 380, marginTop: wide ? 34 : 26 }), animationDelay: ".16s" }}>
              {error && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", background: "color-mix(in srgb, var(--neg) 13%, transparent)", color: "var(--neg)", padding: "11px 13px", borderRadius: 14, marginBottom: 12, fontSize: 13.5, fontWeight: 500 }}>
                  <PIcon name="ph-shield-check" size={17} /> Couldn&apos;t sign you in. Please try again.
                </div>
              )}

              <button
                onClick={() => onSignIn("email")}
                disabled={signing !== null}
                style={{ width: "100%", height: 54, display: "grid", placeItems: "center", background: "var(--primary)", color: "var(--primary-ink)", borderRadius: 16, fontSize: 16, fontWeight: 700, opacity: signing !== null && signing !== "email" ? 0.55 : 1, boxShadow: "0 10px 26px color-mix(in srgb, var(--primary) 35%, transparent)" }}
              >
                {signing === "email" ? <Spinner /> : "Get started"}
              </button>

              <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "14px 2px" }}>
                <span style={{ flex: 1, height: 1, background: "var(--line-2)" }} />
                <span style={{ fontSize: 12, color: "var(--ink-3)", fontWeight: 500 }}>or continue with</span>
                <span style={{ flex: 1, height: 1, background: "var(--line-2)" }} />
              </div>

              <div style={{ display: "flex", gap: 10 }}>
                {social("google", "ph-google-logo", "Continue with Google")}
                {social("x", "ph-x-logo", "Continue with X")}
                {social("wallet", "ph-wallet", "Connect existing account")}
              </div>
            </div>

            {/* trust row */}
            <div className="mva-in" style={{ display: "flex", gap: wide ? 18 : 13, marginTop: 20, flexWrap: "wrap", justifyContent: "center", animationDelay: ".22s" }}>
              <Trust icon="ph-lock-key" label="Self-custody" />
              <Trust icon="ph-sparkle" label="AI-built plans" />
              <Trust icon="ph-seal-check" label="Signed on-chain" />
            </div>
          </>
        )}
      </div>

      {/* drifting proof strip + footnote */}
      {ready && (
        <div className="mva-in" style={{ flex: "none", paddingBottom: `calc(${wide ? 22 : 16}px + env(safe-area-inset-bottom))`, position: "relative", zIndex: 1, animationDelay: ".3s" }}>
          <div aria-hidden style={{ overflow: "hidden", maskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)", WebkitMaskImage: "linear-gradient(90deg, transparent, #000 12%, #000 88%, transparent)" }}>
            {/* 4 copies: each -50% loop half is two full lists, so the strip stays
                wider than any viewport for the whole cycle — no visible end. */}
            <div className="mva-drift" style={{ display: "flex", gap: 10, padding: "4px 10px 4px 0" }}>
              {[...PROOF, ...PROOF, ...PROOF, ...PROOF].map((p, i) => (
                <span key={p.symbol + i} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "7px 13px 7px 8px", borderRadius: 999, background: "var(--panel-2)", border: "1px solid var(--line)", flex: "none" }}>
                  <AssetTile asset={p.d} size={24} radius={8} />
                  <span style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" }}>{p.d.name}</span>
                </span>
              ))}
            </div>
          </div>
          <p style={{ margin: "13px 0 0", textAlign: "center", fontSize: 12, lineHeight: 1.5, color: "var(--ink-3)", fontWeight: 500, padding: "0 24px" }}>
            No seed phrases, no paperwork. Stocks can go down as well as up.
          </p>
        </div>
      )}
    </div>
  );
}
