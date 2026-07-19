"use client";

// Scan to Buy — chat-native port of the classic ScanScreen. The REAL holder
// gate (100k $MONVERA read on-chain) decides locked vs unlocked; unlocked gets
// the real flow: pick/shoot a photo → /api/scan → the listed companies behind
// it → hand the plan idea to Vera in chat. No execution here — chat owns it.
import { useEffect, useRef, useState } from "react";
import { useSmartAccount } from "@/hooks/useSmartAccount";
import { useMonveraGate } from "@/hooks/useMonveraToken";
import { useScan } from "@/hooks/useScan";
import { toTile } from "@/lib/displayAssets";
import { AssetTile } from "@/components/design";
import { PIcon, panel, type ChatNav, type CSSProperties } from "./chatKit";
import { setAdoptedPlan } from "./autopilotPrefill";

const CONNECTION_LABEL: Record<string, string> = {
  maker: "Makes it", parent: "Parent company", supplier: "Supplier",
  component: "Inside it", retailer: "Sells it", competitor: "Competitor",
};

const corner = (pos: CSSProperties, radius: string): CSSProperties => ({ position: "absolute", width: 20, height: 20, borderRadius: radius, ...pos });

function Viewfinder({ spinning }: { spinning?: boolean }) {
  return (
    <div style={{ position: "relative", width: 104, height: 104, margin: "0 auto" }}>
      <span style={corner({ top: 0, left: 0, borderTop: "3px solid var(--primary)", borderLeft: "3px solid var(--primary)" }, "7px 0 0 0")} />
      <span style={corner({ top: 0, right: 0, borderTop: "3px solid var(--primary)", borderRight: "3px solid var(--primary)" }, "0 7px 0 0")} />
      <span style={corner({ bottom: 0, left: 0, borderBottom: "3px solid var(--primary)", borderLeft: "3px solid var(--primary)" }, "0 0 0 7px")} />
      <span style={corner({ bottom: 0, right: 0, borderBottom: "3px solid var(--primary)", borderRight: "3px solid var(--primary)" }, "0 0 7px 0")} />
      <div style={{ position: "absolute", inset: 16, borderRadius: 18, background: "linear-gradient(145deg,var(--primary-2),var(--primary))", display: "grid", placeItems: "center", color: "#fff", boxShadow: "0 14px 34px color-mix(in srgb, var(--primary) 40%, transparent)" }}>
        <PIcon name={spinning ? "ph-circle-notch" : "ph-camera"} size={34} style={spinning ? { animation: "mvcspin .8s linear infinite" } : undefined} />
      </div>
    </div>
  );
}

// ── the scanner show: the photo under a sweeping beam + staged checklist ──
const MATCH_TICKER = ["AAPL", "NVDA", "META", "TSLA", "MSFT", "AMD", "SPY", "GOOGL", "TSM", "AVGO", "QQQ", "NFLX"];
const SCAN_ANIM_CSS = `
@media (prefers-reduced-motion: no-preference){
@keyframes mvscanBeam{0%{top:6%}50%{top:90%}100%{top:6%}}
@keyframes mvscanKen{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes mvscanTicker{0%{transform:translateX(0)}100%{transform:translateX(-50%)}}
}`;

function AnalyzingStage({ preview, phase }: { preview: string | null; phase: "reading" | "analyzing" }) {
  // seconds since mount — drives the staged checklist
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const activeIdx = phase === "reading" ? 0 : elapsed < 5 ? 1 : 2;
  const STEPS = ["Reading your photo", "Identifying the product", "Matching against 95 listed stocks"];

  return (
    <div style={panel({ borderRadius: 22, padding: 16, overflow: "hidden" })}>
      <style dangerouslySetInnerHTML={{ __html: SCAN_ANIM_CSS }} />
      {/* the photo, being scanned */}
      <div style={{ position: "relative", borderRadius: 16, overflow: "hidden", height: 260 }}>
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL, no loader
          <img src={preview} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", display: "block", opacity: 0.82, animation: "mvscanKen 9s ease-in-out infinite" }} />
        ) : (
          <span aria-hidden style={{ position: "absolute", inset: 0, background: "var(--panel-2)" }} />
        )}
        {/* dim wash so brackets/beam read on any photo */}
        <span aria-hidden style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.18)" }} />
        {/* corner brackets */}
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 12, width: "calc(100% - 24px)", height: "calc(100% - 24px)" }} aria-hidden>
          <g stroke="var(--primary)" strokeWidth={1.8} strokeLinecap="round" fill="none">
            <path d="M14 2 H6 Q2 2 2 6 V14" vectorEffect="non-scaling-stroke" />
            <path d="M86 2 H94 Q98 2 98 6 V14" vectorEffect="non-scaling-stroke" />
            <path d="M14 98 H6 Q2 98 2 94 V86" vectorEffect="non-scaling-stroke" />
            <path d="M86 98 H94 Q98 98 98 94 V86" vectorEffect="non-scaling-stroke" />
          </g>
        </svg>
        {/* the beam, sweeping the actual photo */}
        <span aria-hidden style={{ position: "absolute", left: "6%", right: "6%", top: "6%", height: 2, borderRadius: 2, background: "linear-gradient(90deg,transparent,var(--primary) 25%,var(--primary) 75%,transparent)", boxShadow: "0 0 16px color-mix(in srgb,var(--primary) 75%,transparent)", animation: "mvscanBeam 2.6s ease-in-out infinite" }} />
      </div>

      {/* staged checklist — Vera's work, ticking off */}
      <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {STEPS.map((label, i) => {
            const st = i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
            return (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 2px", opacity: st === "pending" ? 0.45 : 1, transition: "opacity .3s ease-out" }}>
                <span style={{ width: 24, height: 24, flex: "none", display: "grid", placeItems: "center" }}>
                  {st === "done" ? (
                    <span style={{ width: 21, height: 21, borderRadius: "50%", display: "grid", placeItems: "center", background: "var(--primary-soft)", color: "var(--primary)" }}><PIcon name="ph-check" size={12} weight="bold" /></span>
                  ) : st === "active" ? (
                    <PIcon name="ph-circle-notch" size={17} weight="bold" style={{ color: "var(--primary)", animation: "mvcspin .8s linear infinite" }} />
                  ) : (
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--ink-3)", opacity: 0.5 }} />
                  )}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: st === "active" ? 600 : 500, color: st === "active" ? "var(--ink)" : "var(--ink-2)" }}>{label}{st === "active" ? "…" : ""}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* the universe she's matching against */}
      <div style={{ marginTop: 14, overflow: "hidden", maskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)", WebkitMaskImage: "linear-gradient(90deg,transparent,#000 12%,#000 88%,transparent)" }}>
        <div style={{ display: "flex", gap: 16, width: "max-content", animation: "mvscanTicker 16s linear infinite" }}>
          {[...MATCH_TICKER, ...MATCH_TICKER].map((sym, i) => (
            <span key={`${sym}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.8 }}>
              <AssetTile asset={toTile(sym)} size={20} radius={6} />
              <span className="tnum" style={{ fontSize: 11.5, fontWeight: 600, color: "var(--ink-3)" }}>{sym}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ScanCanvas({ nav }: { nav: ChatNav }) {
  const { address } = useSmartAccount();
  const gate = useMonveraGate(address ?? undefined);
  const { phase, error, result, scan, reset } = useScan();
  const fileRef = useRef<HTMLInputElement>(null);
  // Local object URL of the picked photo — the analyzing stage scans it live.
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const busy = phase === "reading" || phase === "analyzing";
  const held = Number(gate.balance / BigInt(10) ** BigInt(18));

  const pick = () => { if (!busy) fileRef.current?.click(); };
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setPreview((old) => { if (old) URL.revokeObjectURL(old); return URL.createObjectURL(f); });
    void scan(f);
  };

  // ── locked: the honest gate with live progress ──
  if (!gate.isLoading && !gate.isHolder) {
    return (
      <div>
        <div style={{ background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 10%,transparent),transparent 62%),var(--panel)", border: "1px solid var(--line)", borderRadius: 22, padding: "26px 20px", textAlign: "center" }}>
          <Viewfinder />
          <div style={{ marginTop: 16, display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, background: "var(--primary-soft)", color: "var(--primary)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase" }}>
            <PIcon name="ph-lock" size={11} weight="fill" /> Locked · hold 100k $MONVERA
          </div>
          <div className="serif" style={{ fontSize: 24, fontWeight: 500, marginTop: 10, letterSpacing: "-.01em" }}>Point. Shoot. Own it.</div>
          <p style={{ margin: "8px auto 16px", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, maxWidth: 300 }}>
            Photograph any product — Vera finds the real companies behind it and builds a plan you can place in one tap.
          </p>
          {/* live progress toward the gate */}
          <div style={{ maxWidth: 300, margin: "0 auto 14px" }}>
            <div style={{ height: 8, borderRadius: 99, background: "var(--panel-2)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(gate.progress * 100)}%`, borderRadius: 99, background: "linear-gradient(90deg,var(--primary-2),var(--primary))" }} />
            </div>
            <div className="tnum" style={{ marginTop: 6, fontSize: 11.5, color: "var(--ink-2)" }}>
              {Math.round(held).toLocaleString("en-US")} / 100,000 · {Math.round(gate.progress * 100)}%
            </div>
          </div>
          <button onClick={() => nav.openCanvas("token")} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 48, padding: "0 22px", borderRadius: 999, fontSize: 14.5, fontWeight: 600, color: "var(--primary-ink)", background: "var(--primary)" }}>
            Get $MONVERA to unlock
          </button>
        </div>
      </div>
    );
  }

  // ── unlocked: the real scan flow ──
  return (
    <div>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} style={{ display: "none" }} aria-hidden />

      {busy ? (
        <AnalyzingStage preview={preview} phase={phase === "reading" ? "reading" : "analyzing"} />
      ) : phase === "done" && result ? (
        <>
          {/* what Vera saw */}
          <div style={panel({ borderRadius: 22, padding: 18 })}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 11px", borderRadius: 999, background: "var(--primary-soft)", color: "var(--primary)", fontSize: 10.5, fontWeight: 800, letterSpacing: ".07em", textTransform: "uppercase" }}>
              <PIcon name="ph-check-circle" size={12} weight="fill" /> Recognized
            </div>
            <div className="serif" style={{ fontSize: 22, fontWeight: 500, marginTop: 8 }}>{result.recognized?.product ?? "That product"}</div>
            {result.recognized?.brand && <div style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 2 }}>{result.recognized.brand}{result.recognized.makerName ? ` · by ${result.recognized.makerName}` : ""}</div>}
            {result.recognized?.about && <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--ink-2)", lineHeight: 1.55 }}>{result.recognized.about}</p>}
          </div>

          {/* the companies behind it — naked list */}
          <div style={{ marginTop: 16, padding: "0 4px" }}>
            <div style={{ padding: "0 0 6px", fontSize: 13.5, fontWeight: 700 }}>The companies behind it</div>
            {result.connections.map((c, i) => (
              <button key={c.symbol} className="hgl" onClick={() => nav.openCanvas("holding", c.symbol)} style={{ display: "flex", alignItems: "flex-start", gap: 11, width: "100%", padding: "11px 2px", borderTop: i === 0 ? "none" : "1px solid var(--line-2)", borderRadius: 12, textAlign: "left" }}>
                <AssetTile asset={toTile(c.symbol, c.name)} size={34} radius={10} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "flex", alignItems: "baseline", gap: 7 }}>
                    <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                    <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", color: "var(--primary)" }}>{CONNECTION_LABEL[c.connectionType] ?? c.connectionType}</span>
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--ink-3)", lineHeight: 1.45, marginTop: 1 }}>{c.reasoning}</span>
                </span>
                <span className="tnum" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ink-2)", flex: "none" }}>{Math.round(c.weight)}%</span>
              </button>
            ))}
          </div>

          <button
            onClick={() => {
              const brand = result.recognized?.brand ?? result.recognized?.product ?? "this product";
              // Hand the EXACT basket to chat — weights intact, no re-planning.
              setAdoptedPlan({
                brand,
                connections: result.connections.map((c) => ({ symbol: c.symbol, weightPct: Math.round(c.weight), reason: c.reasoning })),
              });
              nav.goChat();
            }}
            style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 8, height: 50, marginTop: 14, borderRadius: 14, fontSize: 15, fontWeight: 600, color: "var(--primary-ink)", background: "var(--primary)" }}
          >
            <PIcon name="ph-sparkle" size={17} weight="fill" /> Ask Vera to build this plan
          </button>
          <button onClick={() => { reset(); }} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "center", gap: 7, height: 42, marginTop: 8, borderRadius: 13, border: "1px solid var(--line)", background: "transparent", color: "var(--ink-2)", fontSize: 13, fontWeight: 600 }}>
            <PIcon name="ph-camera" size={15} /> Scan something else
          </button>
        </>
      ) : (
        <>
          {/* ready / working / error */}
          <div style={{ background: "linear-gradient(135deg,color-mix(in srgb,var(--primary) 12%,transparent),transparent 62%),var(--panel)", border: "1px solid var(--line)", borderRadius: 22, padding: "26px 20px", textAlign: "center" }}>
            <Viewfinder spinning={busy} />
            <div className="serif" style={{ fontSize: 24, fontWeight: 500, marginTop: 14, letterSpacing: "-.01em" }}>
              {busy ? (phase === "reading" ? "Reading your photo…" : "Vera is looking…") : "Point. Shoot. Own it."}
            </div>
            <p style={{ margin: "8px auto 16px", fontSize: 13.5, color: "var(--ink-2)", lineHeight: 1.6, maxWidth: 300 }}>
              {busy
                ? "Finding the real, listed companies behind what you photographed."
                : "Photograph any product — Vera finds the listed companies behind it."}
            </p>
            {phase === "error" && error && (
              <div style={{ margin: "0 auto 14px", maxWidth: 320, background: "color-mix(in srgb,var(--neg) 12%,transparent)", color: "var(--neg)", padding: "10px 13px", borderRadius: 13, fontSize: 12.5, fontWeight: 500, lineHeight: 1.5 }}>{error}</div>
            )}
            <button onClick={pick} disabled={busy} style={{ display: "inline-flex", alignItems: "center", gap: 8, height: 50, padding: "0 24px", borderRadius: 999, fontSize: 15, fontWeight: 700, color: "var(--primary-ink)", background: "var(--primary)", opacity: busy ? 0.6 : 1 }}>
              <PIcon name="ph-camera" size={18} /> {phase === "error" ? "Try another photo" : "Snap or pick a photo"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
