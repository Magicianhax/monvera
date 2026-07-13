"use client";

// Success — faithful re-skin of the design (screens_invest.jsx · Success) wired
// to the REAL invest result (InvestSuccess: txHash, holdings, amountUsd). Confetti
// burst, what you now own, and a Blockscout receipt link (the on-chain record).
// The reveal is one GSAP timeline (title → amount line → holdings rows → trust
// card) so the moment reads as a single choreography; content is never gated —
// under reduced motion nothing tweens and everything is simply visible.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Confetti, SectionTitle, HoldingRow, Icon } from "@/components/design";
import { toTile, catFor } from "@/lib/displayAssets";
import { usd, txUrl } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import type { InvestSuccess } from "@/lib/invest-types";

gsap.registerPlugin(useGSAP);

export function SuccessScreen({
  success,
  onDone,
}: {
  success: InvestSuccess;
  onDone: () => void;
}) {
  const { amountUsd, holdings, txHash } = success;

  // Celebrate the moment with a short success buzz (once, on arrival).
  useEffect(() => {
    haptic.success();
  }, []);

  // One success choreography: headline, then the amount line, then each owned
  // holding lands in sequence, then the trust card. Overlapping starts keep the
  // whole reveal under a second.
  const rootRef = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add("(prefers-reduced-motion: no-preference)", () => {
        gsap
          .timeline({ defaults: { ease: "power3.out" } })
          .from("[data-fx='title']", { y: 14, opacity: 0, duration: 0.36, delay: 0.12 })
          .from("[data-fx='sub']", { y: 10, opacity: 0, duration: 0.3 }, "-=0.22")
          .from("[data-fx='own'] > *", { y: 12, opacity: 0, duration: 0.28, stagger: 0.045 }, "-=0.16")
          .from("[data-fx='trust']", { y: 12, opacity: 0, duration: 0.3 }, "-=0.12");
      });
      return () => mm.revert();
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="screen screen-pad-top" style={{ paddingBottom: 0 }}>
      <Confetti />

      <div style={{ padding: "30px 22px 0", textAlign: "center" }}>
        {/* check burst */}
        <div style={{ position: "relative", width: 92, height: 92, margin: "10px auto 22px" }}>
          <span
            aria-hidden
            style={{
              position: "absolute",
              inset: -16,
              borderRadius: "50%",
              background:
                "radial-gradient(circle, color-mix(in srgb, var(--primary) 55%, transparent), transparent 70%)",
              filter: "blur(14px)",
              animation: "softBurst 1.2s var(--ease-out) both",
            }}
          />
          <div
            style={{
              width: 92,
              height: 92,
              borderRadius: "50%",
              background: "var(--hero-grad)",
              display: "grid",
              placeItems: "center",
              animation: "pop .6s var(--ease-soft) both",
              boxShadow: "var(--shadow-lg)",
            }}
          >
            {/* check strokes in after the disc springs (drawCheck via .check-draw) */}
            <svg width="46" height="46" viewBox="0 0 46 46" className="check-draw">
              <path
                d="M12 24l8 8 16-17"
                fill="none"
                stroke="var(--primary-ink)"
                strokeWidth="4.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
        <h1 className="serif" data-fx="title" style={{ fontSize: 32, margin: "0 0 8px", letterSpacing: "-.01em" }}>
          You&apos;re invested.
        </h1>
        <p data-fx="sub" style={{ fontSize: 16, color: "var(--ink-2)", margin: 0 }}>
          <b className="tnum">{usd(amountUsd)}</b> is now working across {holdings.length}{" "}
          {holdings.length === 1 ? "holding" : "holdings"}.
        </p>
        {success.anySettling && (
          <p data-fx="sub" style={{ fontSize: 13, color: "var(--ink-3)", margin: "10px auto 0", maxWidth: 300 }}>
            Some are signed and on-chain now; those shares finish settling in a couple of minutes.
          </p>
        )}
      </div>

      {/* what you own */}
      <div style={{ padding: "26px 22px 0" }}>
        <SectionTitle>What you now own</SectionTitle>
        <div className="card" data-fx="own" style={{ padding: "4px 14px" }}>
          {holdings.map((h, i) => (
            <div
              key={h.symbol}
              style={{ borderBottom: i < holdings.length - 1 ? "1px solid var(--line-2)" : "none" }}
            >
              <HoldingRow
                asset={toTile(h.symbol, h.name)}
                sub={catFor(h.symbol, h.name)}
                showSpark={false}
                right={
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                    <div className="tnum" style={{ fontWeight: 600, fontSize: 16 }}>
                      {usd(h.amountUsd)}
                    </div>
                    {h.txHash && (
                      <a
                        href={txUrl(h.txHash)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="tap"
                        onClick={(e) => e.stopPropagation()}
                        style={{ fontSize: 11.5, fontWeight: 500, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 3, textDecoration: "none" }}
                      >
                        Receipt <Icon name="arrowUR" size={11} />
                      </a>
                    )}
                  </div>
                }
              />
            </div>
          ))}
        </div>
      </div>

      {/* verified on-chain — the trust moment: Vera's risk call was signed +
          checked by the InferenceVerifier contract before any money moved */}
      <div data-fx="trust" style={{ padding: "18px 22px 0" }}>
        {success.verification ? (
          <div className="card" style={{ padding: 18 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 11, marginBottom: 12 }}>
              <span
                style={{ width: 36, height: 36, borderRadius: 5, background: "var(--primary-soft)", display: "grid", placeItems: "center", color: "var(--primary)", flex: "none" }}
              >
                <Icon name="shield" size={20} stroke={2} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 16, letterSpacing: "-.01em" }}>Verified on-chain</div>
                <div style={{ fontSize: 12.5, color: "var(--ink-2)", marginTop: 1 }}>Provable, not just promised.</div>
              </div>
              <span
                style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 6, background: "var(--primary-soft)", color: "var(--primary)", fontSize: 12, fontWeight: 600, flex: "none" }}
              >
                <Icon name="check" size={13} stroke={2.8} /> Signed
              </span>
            </div>

            <p style={{ margin: 0, fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6 }}>
              Vera assessed this plan at{" "}
              <b style={{ color: "var(--ink)" }}>{Math.round(success.verification.riskScore / 100)}% risk</b>, within the{" "}
              <b style={{ color: "var(--ink)" }}>{Math.round(success.verification.maxRisk / 100)}%</b> ceiling she committed to.
              She signed that assessment, and the on-chain verifier checked it{" "}
              <b style={{ color: "var(--ink)" }}>before any money moved</b>.
            </p>

            <div
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--line-2)" }}
            >
              <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>
                sig {success.verification.signature.slice(0, 8)}…{success.verification.signature.slice(-6)}
              </span>
              <a
                href={txUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="tap"
                style={{ fontSize: 13, fontWeight: 500, color: "var(--primary)", display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none" }}
              >
                View on Blockscout <Icon name="arrowUR" size={14} />
              </a>
            </div>
          </div>
        ) : (
          <a
            href={txUrl(txHash)}
            target="_blank"
            rel="noopener noreferrer"
            className="card tap"
            style={{ width: "100%", padding: 16, display: "flex", alignItems: "center", gap: 12, textAlign: "left", background: "var(--accent-soft)", textDecoration: "none", color: "inherit" }}
          >
            <span style={{ width: 40, height: 40, borderRadius: 5, background: "var(--surface)", display: "grid", placeItems: "center", color: "var(--accent)", flex: "none" }}>
              <Icon name="shield" size={22} />
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500, fontSize: 15.5 }}>Vera recorded this plan</div>
              <div className="mono" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 2 }}>
                View the receipt on Blockscout →
              </div>
            </div>
          </a>
        )}
      </div>

      <div
        style={{
          position: "sticky",
          bottom: 0,
          marginTop: "auto",
          padding: "16px 22px calc(18px + env(safe-area-inset-bottom))",
          background: "linear-gradient(to top, var(--paper), var(--paper) 62%, transparent)",
        }}
      >
        <button className="btn btn-primary btn-block btn-lg tap" onClick={onDone}>
          Done
        </button>
      </div>
    </div>
  );
}
