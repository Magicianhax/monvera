"use client";

// Scan to Buy — the 100k-$MONVERA holder feature. Photograph (or upload) any
// product; Vera identifies it and maps it to the LISTED companies behind it with
// honest reasoning; the user picks an amount and hands off to the EXISTING invest
// pipeline (go("thinking", { goal, amt }) → plan → confirm → per-leg settle →
// VeraRecord). No execution lives here — this screen only produces the goal.
//
// One file, an internal state machine driven by the holder gate + useScan phase:
//   non-holder → lock explainer · idle → capture/upload · reading|analyzing →
//   live preview · done+connections → connection cards + amount · done+empty →
//   honest "nothing to buy" · error → retry.
import { useEffect, useState } from "react";
import { useScan, type ScanConnection } from "@/hooks/useScan";
import { useMonveraGate } from "@/hooks/useMonveraToken";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { HOLDER_THRESHOLD } from "@/lib/monveraToken";
import { Icon, type IconName } from "@/components/design";
import { haptic } from "@/lib/haptics";
import { TokenLogo } from "../TokenLogo";
import { iconBtn, Spinner } from "./primitives";

// ~$11 per leg is the Arcus RFQ maker floor, so a plan needs at least one leg's
// worth per connection or a tail leg silently won't fill.
const MIN_PER_LEG = 11;
const HOLDER_WHOLE = Number(HOLDER_THRESHOLD / BigInt(10) ** BigInt(18)); // 100000

// Digits + a single decimal point only.
const cleanNum = (v: string) => v.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1");

export function ScanScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const { address } = useSmartAccount();
  const gate = useMonveraGate(address ?? undefined);
  const { phase, error, result, scan, reset } = useScan();

  const [preview, setPreview] = useState<string | null>(null);
  const [amt, setAmt] = useState("");

  // Revoke the previous object URL when the preview changes or on unmount — the
  // effect cleanup captures the value from the render it ran in.
  useEffect(() => {
    if (!preview) return;
    return () => URL.revokeObjectURL(preview);
  }, [preview]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the input so re-picking the SAME file still fires onChange.
    e.target.value = "";
    if (!file) return;
    haptic.light();
    setPreview(URL.createObjectURL(file));
    void scan(file);
  };

  // Full reset back to the capture state (clears preview, amount, scan result).
  const restart = () => {
    haptic.select();
    setPreview(null);
    setAmt("");
    reset();
  };

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      <Header onBack={() => go(-1)} />

      {gate.isLoading && !gate.isHolder ? (
        <CenterState>
          <Spinner />
        </CenterState>
      ) : !gate.isHolder ? (
        <LockState gate={gate} go={go} />
      ) : phase === "idle" ? (
        <InputState onPick={onPick} />
      ) : phase === "reading" || phase === "analyzing" ? (
        <AnalyzingState preview={preview} phase={phase} />
      ) : phase === "error" ? (
        <ErrorState error={error} onRetry={restart} />
      ) : result && result.connections.length > 0 ? (
        <ResultState result={result} amt={amt} setAmt={setAmt} onRestart={restart} go={go} />
      ) : (
        <EmptyState recognized={result?.recognized ?? null} onRestart={restart} go={go} />
      )}
    </div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────
function Header({ onBack }: { onBack: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 22px 0" }}>
      <button onClick={onBack} style={iconBtn} className="tap" aria-label="Back">
        <Icon name="back" size={20} />
      </button>
      <h1 style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 600, letterSpacing: "-.02em" }}>
        Scan to Buy
      </h1>
    </div>
  );
}

// A generic vertically-centred slot for the loading / analyzing states.
function CenterState({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 32px",
        textAlign: "center",
        color: "var(--ink-2)",
      }}
    >
      {children}
    </div>
  );
}

// ── A. Non-holder / deep-link lock — the feature's own landing page ──────────
// Full-height hero: the scan art with real stock logos, a serif headline, the
// three-beat "what is it", then the unlock card pinned at the bottom.
function LockState({
  gate,
  go,
}: {
  gate: ReturnType<typeof useMonveraGate>;
  go: (t: string | number, p?: Record<string, unknown>) => void;
}) {
  const held = Number(gate.balance / BigInt(10) ** BigInt(18));
  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "calc(100dvh - 140px)", padding: "10px 22px 0" }}>
      {/* hero — art + headline */}
      <div className="anim-rise" style={{ textAlign: "center", paddingTop: 14 }}>
        <LockHeroArt />
        <h2 className="serif" style={{ margin: "18px 0 0", fontSize: 30, letterSpacing: "-.01em", lineHeight: 1.15 }}>
          Point. Scan.
          <br />
          Own what's behind it.
        </h2>
        <p style={{ margin: "10px auto 0", maxWidth: 300, fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)" }}>
          Photograph any product and Vera finds the listed companies behind it — then invests, signed on-chain.
        </p>
      </div>

      {/* what is it — three honest beats */}
      <div className="anim-rise" style={{ marginTop: 26, display: "flex", flexDirection: "column", gap: 4, animationDelay: ".08s" }}>
        <LockStep icon="camera" title="Snap any product" note="A can, a sneaker, a laptop — anything with a brand on it." />
        <LockStep icon="spark" title="Vera finds the companies" note="Maker, suppliers, retailers — real connections, each with an honest reason." />
        <LockStep icon="signature" title="Invest in one tap, signed" note="Runs through the same on-chain pipeline as every Vera plan — public and re-checkable." />
      </div>

      {/* unlock card — pinned toward the bottom */}
      <div className="anim-rise" style={{ marginTop: "auto", paddingTop: 26, animationDelay: ".16s" }}>
        <div
          style={{
            background: "var(--surface)",
            borderRadius: "var(--rr)",
            boxShadow: "var(--shadow)",
            padding: "18px 18px 16px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 500, color: "var(--ink)" }}>
              <Icon name="lock" size={14} style={{ color: "var(--ink-3)" }} />
              Holder feature
            </span>
            <span className="tnum" style={{ fontSize: 12.5, color: "var(--ink-2)" }}>
              {held.toLocaleString("en-US")} / {HOLDER_WHOLE.toLocaleString("en-US")} $MONVERA
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 999, background: "var(--surface-2)", overflow: "hidden" }}>
            <div
              style={{
                width: `${Math.round(gate.progress * 100)}%`,
                height: "100%",
                borderRadius: 999,
                background: "var(--primary)",
                transition: "width .4s var(--ease-soft)",
              }}
            />
          </div>
          <button
            className="btn btn-primary btn-block btn-lg tap"
            style={{ marginTop: 16 }}
            onClick={() => {
              haptic.medium();
              go("token");
            }}
          >
            Get $MONVERA
          </button>
          <p style={{ margin: "10px 0 0", textAlign: "center", fontSize: 11.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
            Hold 100,000 $MONVERA (~$100) to unlock. The rest of Monvera stays free.
          </p>
        </div>
      </div>
    </div>
  );
}

// One "what is it" row: icon chip + title + one honest line.
function LockStep({ icon, title, note }: { icon: IconName; title: string; note: string }) {
  return (
    <div style={{ display: "flex", gap: 13, alignItems: "flex-start", padding: "10px 2px" }}>
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          flex: "none",
          display: "grid",
          placeItems: "center",
          background: "var(--primary-soft)",
          color: "var(--primary)",
        }}
      >
        <Icon name={icon} size={19} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600, letterSpacing: "-.01em", color: "var(--ink)" }}>{title}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "var(--ink-2)", marginTop: 2 }}>{note}</div>
      </div>
    </div>
  );
}

// Hero art: the viewfinder + product from the Home banner, scaled up, with real
// stock logos orbiting it (the photo resolves into companies).
function LockHeroArt() {
  const orbit = (symbol: string, style: React.CSSProperties) => (
    <span
      style={{
        position: "absolute",
        borderRadius: "50%",
        boxShadow: "0 0 0 2.5px var(--surface), var(--shadow)",
        lineHeight: 0,
        ...style,
      }}
    >
      <TokenLogo symbol={symbol} size={26} />
    </span>
  );
  return (
    <span aria-hidden style={{ position: "relative", display: "inline-block", width: 148, height: 116 }}>
      {orbit("KO", { top: 0, left: 4 })}
      {orbit("AAPL", { top: 44, right: -8 })}
      {orbit("NVDA", { bottom: 0, left: 22 })}
      {orbit("TSLA", { top: 6, right: 22 })}
      <svg width="148" height="116" viewBox="0 0 96 76" fill="none" style={{ display: "block" }}>
        <circle cx="52" cy="38" r="32" fill="var(--primary)" opacity=".10" />
        <circle cx="52" cy="38" r="22" fill="var(--primary)" opacity=".08" />
        <g stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" fill="none">
          <path d="M30 16 h-8 a5 5 0 0 0 -5 5 v8" />
          <path d="M74 16 h8 a5 5 0 0 1 5 5 v8" />
          <path d="M30 60 h-8 a5 5 0 0 1 -5 -5 v-8" />
          <path d="M74 60 h8 a5 5 0 0 0 5 -5 v-8" />
        </g>
        <rect x="40" y="24" width="24" height="30" rx="6" fill="var(--primary)" opacity=".9" />
        <rect x="40" y="30" width="24" height="4.5" rx="2" fill="#fff" opacity=".5" />
        <path d="M45 48 l5.5 -5.5 l4 3 l6.5 -7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <line x1="26" y1="38" x2="78" y2="38" stroke="var(--primary)" strokeWidth="1.6" opacity=".45" strokeDasharray="3 4" />
        <path d="M76 8 l1.8 4.4 4.4 1.8 -4.4 1.8 -1.8 4.4 -1.8 -4.4 -4.4 -1.8 4.4 -1.8 z" fill="var(--primary)" opacity=".85" />
      </svg>
    </span>
  );
}

// ── B. Input — the scanner. A live-feeling viewfinder stage (sweeping beam,
// floating stock logos) that IS the camera button, a gallery fallback, and a
// trust strip. Keyframes are scoped here (a <style> tag), not in globals.css.
function InputState({ onPick }: { onPick: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div className="anim-rise" style={{ display: "flex", flexDirection: "column", flex: 1, padding: "14px 22px 0", minHeight: "calc(100dvh - 150px)" }}>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          @keyframes scanBeam { 0% { top: 14%; opacity: 0 } 12% { opacity: 1 } 88% { opacity: 1 } 100% { top: 84%; opacity: 0 } }
          @keyframes scanBob  { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-7px) } }
          @keyframes scanPulse { 0%, 100% { opacity: .55 } 50% { opacity: 1 } }
        }
      `}</style>

      <h1 className="serif" style={{ margin: 0, fontSize: 30, letterSpacing: "-.01em", lineHeight: 1.12, textAlign: "center" }}>
        Point at any product
      </h1>
      <p style={{ margin: "8px auto 0", maxWidth: 320, fontSize: 14, lineHeight: 1.6, color: "var(--ink-2)", textAlign: "center" }}>
        Vera finds the listed companies behind it — maker, suppliers, retailers — and invests in the real ones.
      </p>
      <p style={{ margin: "6px auto 0", fontSize: 12.5, color: "var(--ink-3)", textAlign: "center" }}>
        Try a soda can, your sneakers, or the phone in your hand.
      </p>

      {/* the viewfinder stage — tapping it opens the camera */}
      <label
        className="tap"
        aria-label="Take a photo"
        style={{
          position: "relative",
          display: "block",
          height: 264,
          flex: "none",
          marginTop: 16,
          borderRadius: 24,
          overflow: "hidden",
          cursor: "pointer",
          background:
            "radial-gradient(120% 90% at 50% 0%, color-mix(in srgb, var(--primary) 22%, var(--surface)) 0%, var(--surface) 58%, color-mix(in srgb, var(--primary) 8%, var(--surface)) 100%)",
          boxShadow: "var(--shadow)",
        }}
      >
        <input type="file" accept="image/*" capture="environment" onChange={onPick} hidden />

        {/* viewfinder corners */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 14, width: "calc(100% - 28px)", height: "calc(100% - 28px)" }} aria-hidden>
          <g stroke="var(--primary)" strokeWidth="1.6" strokeLinecap="round" fill="none" vectorEffect="non-scaling-stroke">
            <path d="M14 2 H6 Q2 2 2 6 V14" vectorEffect="non-scaling-stroke" />
            <path d="M86 2 H94 Q98 2 98 6 V14" vectorEffect="non-scaling-stroke" />
            <path d="M14 98 H6 Q2 98 2 94 V86" vectorEffect="non-scaling-stroke" />
            <path d="M86 98 H94 Q98 98 98 94 V86" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>

        {/* sweeping scan beam */}
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: "10%",
            right: "10%",
            top: "14%",
            height: 2,
            borderRadius: 2,
            background: "linear-gradient(90deg, transparent, var(--primary) 30%, var(--primary) 70%, transparent)",
            boxShadow: "0 0 14px color-mix(in srgb, var(--primary) 70%, transparent)",
            animation: "scanBeam 3.2s ease-in-out infinite",
          }}
        />

        {/* floating stock logos — a tidy arc; the photo resolves into companies */}
        {[
          { s: "KO", t: "46%", l: "14%", d: ".4s", z: 26 },
          { s: "AAPL", t: "30%", l: "31%", d: "0s", z: 30 },
          { s: "NVDA", t: "24%", l: "50%", d: ".8s", z: 34 },
          { s: "MSFT", t: "30%", l: "69%", d: ".3s", z: 30 },
          { s: "TSLA", t: "46%", l: "86%", d: "1.1s", z: 26 },
        ].map(({ s, t, l, d, z }) => (
          <span
            key={s}
            aria-hidden
            style={{ position: "absolute", top: t, left: l, transform: "translate(-50%, -50%)", lineHeight: 0 }}
          >
            {/* inner span carries the bob so it can't fight the centering transform */}
            <span
              style={{
                display: "inline-block",
                borderRadius: "50%",
                lineHeight: 0,
                boxShadow: "0 0 0 2px color-mix(in srgb, var(--surface) 80%, transparent), 0 6px 18px rgba(0,0,0,.25)",
                animation: `scanBob 3.6s ease-in-out ${d} infinite`,
              }}
            >
              <TokenLogo symbol={s} size={z} />
            </span>
          </span>
        ))}

        {/* center prompt */}
        <span
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 20,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span
            style={{
              width: 58,
              height: 58,
              borderRadius: "50%",
              display: "grid",
              placeItems: "center",
              background: "var(--primary)",
              color: "var(--primary-ink, #fff)",
              boxShadow: "0 8px 24px color-mix(in srgb, var(--primary) 45%, transparent)",
            }}
          >
            <Icon name="camera" size={27} weight="fill" />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)", animation: "scanPulse 2.4s ease-in-out infinite" }}>
            Tap to scan
          </span>
        </span>
      </label>

      {/* gallery fallback */}
      <label className="btn btn-ghost btn-block tap" style={{ marginTop: 12, cursor: "pointer" }}>
        Upload from gallery
        <input type="file" accept="image/*" onChange={onPick} hidden />
      </label>

      {/* trust strip — why this can be believed */}
      <div style={{ display: "flex", justifyContent: "center", gap: 18, margin: "14px 0 4px" }}>
        {(
          [
            { icon: "signature", label: "Signed on-chain" },
            { icon: "trend", label: "Live quotes" },
            { icon: "shield", label: "Self-custody" },
          ] as { icon: IconName; label: string }[]
        ).map(({ icon, label }) => (
          <span key={label} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, fontWeight: 500, color: "var(--ink-3)" }}>
            <Icon name={icon} size={14} style={{ color: "var(--primary)" }} />
            {label}
          </span>
        ))}
      </div>

      <p style={{ margin: "6px 2px 0", textAlign: "center", fontSize: 12, lineHeight: 1.55, color: "var(--ink-3)" }}>
        If nothing listed is behind it, Vera says so — no force-fits.
      </p>
    </div>
  );
}

// ── C. Analyzing — live preview + staged status ──────────────────────────────
const ANALYZING_COPY = ["Vera is looking…", "Matching to listed companies…", "Checking the connections…"];

function AnalyzingState({ preview, phase }: { preview: string | null; phase: "reading" | "analyzing" }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (phase !== "analyzing") return;
    const t = setInterval(() => setStep((p) => Math.min(p + 1, ANALYZING_COPY.length - 1)), 2200);
    return () => clearInterval(t);
  }, [phase]);

  const line = phase === "reading" ? "Reading your photo…" : ANALYZING_COPY[step];

  return (
    <div className="anim-rise" style={{ padding: "24px 22px 0", flex: 1 }}>
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- local object URL, no loader
        <img
          src={preview}
          alt=""
          style={{
            width: "100%",
            maxHeight: 260,
            objectFit: "cover",
            borderRadius: 16,
            display: "block",
            opacity: 0.72,
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          marginTop: 24,
          fontSize: 15.5,
          fontWeight: 500,
          color: "var(--ink-2)",
        }}
      >
        <Spinner small />
        {line}
      </div>
    </div>
  );
}

// ── D. Result — Vera's connections + amount → plan handoff ────────────────────
function ResultState({
  result,
  amt,
  setAmt,
  onRestart,
  go,
}: {
  result: NonNullable<ReturnType<typeof useScan>["result"]>;
  amt: string;
  setAmt: (v: string) => void;
  onRestart: () => void;
  go: (t: string | number, p?: Record<string, unknown>) => void;
}) {
  const { recognized, connections } = result;
  const brand = recognized?.brand ?? "it";
  const product = recognized?.product ?? "this product";
  const min = connections.length * MIN_PER_LEG;
  const amount = parseFloat(amt) || 0;
  const under = amount > 0 && amount < min;
  const ready = amount >= min;

  const buildPlan = () => {
    haptic.medium();
    const legs = connections.map((c) => `${c.symbol} (${c.connectionType}, ${c.weight}%)`).join(", ");
    const goal =
      `Invest in the real companies behind ${brand} ${product}: ${legs}` +
      ` — keep to exactly these companies and weights.`;
    go("thinking", { goal, amt: amount });
  };

  return (
    <div className="anim-rise" style={{ padding: "22px 22px 0" }}>
      {/* "Vera sees" headline card */}
      <div
        style={{
          background: "var(--surface)",
          borderRadius: "var(--rr)",
          boxShadow: "var(--shadow)",
          padding: "16px 18px",
        }}
      >
        <div className="label-eyebrow">Vera sees</div>
        <div style={{ marginTop: 6, fontSize: 18, fontWeight: 600, letterSpacing: "-.01em", color: "var(--ink)" }}>
          {recognized ? `${brand} ${product}` : "A product"}
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: "var(--ink-3)" }}>
          The listed companies behind it, weighted by how real the link is.
        </p>
      </div>

      {/* connection cards */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
        {connections.map((c, i) => (
          <ConnectionCard key={c.symbol + i} c={c} index={i} />
        ))}
      </div>

      {/* amount */}
      <div style={{ marginTop: 20 }}>
        <div className="label-eyebrow" style={{ marginBottom: 8 }}>
          How much to invest
        </div>
        <div className="field" style={{ display: "flex", alignItems: "center", gap: 6, padding: "12px 16px" }}>
          <span className="tnum" style={{ fontSize: 30, fontWeight: 600, color: "var(--ink-3)" }}>
            $
          </span>
          <input
            value={amt}
            onChange={(e) => setAmt(cleanNum(e.target.value))}
            inputMode="decimal"
            placeholder="0"
            aria-label="Amount to invest"
            className="tnum"
            style={{ flex: 1, fontSize: 30, fontWeight: 600, letterSpacing: "-.02em", width: "100%" }}
          />
        </div>
        <div style={{ marginTop: 8, fontSize: 12.5, color: under ? "var(--neg)" : "var(--ink-3)" }}>
          Min ${min} — about ${MIN_PER_LEG} per company so every leg fills.
        </div>
      </div>

      <button
        className="btn btn-primary btn-block btn-lg tap"
        style={{ marginTop: 16 }}
        disabled={!ready}
        onClick={buildPlan}
      >
        Build this plan
      </button>
      <button className="btn btn-ghost btn-block tap" style={{ marginTop: 10 }} onClick={onRestart}>
        Scan something else
      </button>
    </div>
  );
}

// One connection: real company logo, symbol/name, type chip, weight%, reasoning.
function ConnectionCard({ c, index }: { c: ScanConnection; index: number }) {
  return (
    <div
      className="anim-rise"
      style={{
        animationDelay: `${index * 0.05}s`,
        background: "var(--surface)",
        borderRadius: "var(--rr)",
        boxShadow: "var(--shadow)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <TokenLogo symbol={c.symbol} name={c.name} size={38} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{c.symbol}</span>
            <span
              style={{
                flex: "none",
                padding: "2px 8px",
                borderRadius: 999,
                background: "var(--surface-2)",
                color: "var(--ink-2)",
                fontSize: 11,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {c.connectionType}
            </span>
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: "var(--ink-3)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.name}
          </div>
        </div>
        <span className="tnum" style={{ flex: "none", fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>
          {c.weight}%
        </span>
      </div>
      <p style={{ margin: "10px 0 0", fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)" }}>{c.reasoning}</p>
    </div>
  );
}

// ── E. Empty result — nothing honest to buy ──────────────────────────────────
function EmptyState({
  recognized,
  onRestart,
  go,
}: {
  recognized: { product: string; brand: string } | null;
  onRestart: () => void;
  go: (t: string | number, p?: Record<string, unknown>) => void;
}) {
  const identified = recognized !== null;
  const brand = recognized?.brand ?? "it";
  const product = recognized?.product ?? "";

  return (
    <div className="anim-rise" style={{ padding: "28px 22px 0" }}>
      <div
        style={{
          background: "var(--surface)",
          borderRadius: "var(--rr)",
          boxShadow: "var(--shadow)",
          padding: "22px 20px",
          textAlign: "center",
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            borderRadius: "50%",
            margin: "0 auto",
            display: "grid",
            placeItems: "center",
            background: "var(--surface-2)",
            color: "var(--ink-2)",
          }}
        >
          <Icon name={identified ? "info" : "eye"} size={24} />
        </span>
        <p style={{ margin: "16px auto 0", maxWidth: 320, fontSize: 15, lineHeight: 1.6, color: "var(--ink)" }}>
          {identified
            ? `That's a ${brand} ${product} — ${brand} isn't among the 95 listed stocks, so there's nothing honest to buy here.`
            : "Vera couldn't identify a product in that photo. Try a clearer shot of the label or logo."}
        </p>
      </div>

      {identified ? (
        <button
          className="btn btn-primary btn-block btn-lg tap"
          style={{ marginTop: 16 }}
          onClick={() => {
            haptic.medium();
            go("goal");
          }}
        >
          Build with Vera instead
        </button>
      ) : null}
      <button
        className={`btn ${identified ? "btn-ghost" : "btn-primary btn-lg"} btn-block tap`}
        style={{ marginTop: identified ? 10 : 16 }}
        onClick={onRestart}
      >
        Scan something else
      </button>
    </div>
  );
}

// ── F. Error ─────────────────────────────────────────────────────────────────
function ErrorState({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  return (
    <div className="anim-rise" style={{ padding: "28px 22px 0" }}>
      <div
        style={{
          background: "color-mix(in srgb, var(--neg) 12%, var(--surface))",
          borderRadius: "var(--rr)",
          boxShadow: "var(--shadow)",
          padding: "20px",
          textAlign: "center",
        }}
      >
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: "var(--neg)", fontWeight: 500 }}>
          {error ?? "Vera couldn't read that one. Try another photo."}
        </p>
      </div>
      <button className="btn btn-primary btn-block btn-lg tap" style={{ marginTop: 16 }} onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
