"use client";

// Custom 404. On-brand (dark emerald, Ledger) with a crashing-chart gag and a
// single click back to the main site. No auto-redirect — the user chooses.
import Link from "next/link";
import { CHAT_STYLE_CSS, CHAT_THEME_CSS, ChatMark } from "@/components/chat/chatKit";

const CSS = `
.nf{min-height:100dvh;display:grid;place-items:center;padding:24px;background:var(--bg);color:var(--ink);font-family:var(--font-ui)}
.nf-line{stroke-dasharray:520;stroke-dashoffset:520;animation:nf-draw 1.4s cubic-bezier(.7,0,.3,1) .15s forwards}
.nf-dot{opacity:0;animation:nf-pop .3s ease 1.5s forwards}
@keyframes nf-draw{to{stroke-dashoffset:0}}
@keyframes nf-pop{from{opacity:0;transform:scale(0)}to{opacity:1;transform:scale(1)}}
.nf-cta{transition:transform 160ms cubic-bezier(.23,1,.32,1),background-color 160ms ease}
.nf-cta:active{transform:scale(.97)}
@media (hover:hover){.nf-cta:hover{background:color-mix(in srgb,var(--primary) 88%,#fff)}}
@media (prefers-reduced-motion:reduce){.nf-line{animation:none;stroke-dashoffset:0}.nf-dot{animation:none;opacity:1}}
`;

export default function NotFound() {
  return (
    <div className="nf mvc" data-mode="dark" data-style="emerald">
      <style dangerouslySetInnerHTML={{ __html: CHAT_THEME_CSS + CHAT_STYLE_CSS + CSS }} />

      <div style={{ width: "100%", maxWidth: 460, textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, marginBottom: 28 }}>
          <ChatMark size={18} />
          <span style={{ fontSize: 15, fontWeight: 800, letterSpacing: "-.02em" }}>Monvera</span>
        </div>

        {/* the gag: a chart that rallies, then rugs straight to this page */}
        <div style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--panel)", padding: "22px 20px 16px", marginBottom: 26 }}>
          <svg viewBox="0 0 320 128" width="100%" height="128" style={{ display: "block" }} aria-hidden>
            <line x1="8" y1="116" x2="312" y2="116" stroke="var(--line)" strokeWidth="1" />
            <polyline
              className="nf-line"
              points="10,92 52,74 96,82 138,44 178,58 206,30 244,104 300,120"
              fill="none" stroke="var(--neg)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            />
            <circle className="nf-dot" cx="300" cy="120" r="4.5" fill="var(--neg)" />
          </svg>
          <div style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 4, textAlign: "right", paddingRight: 8 }}>
            you are here
          </div>
        </div>

        <div className="serif" style={{ fontSize: "clamp(56px, 14vw, 88px)", fontWeight: 600, lineHeight: 1, letterSpacing: "-.04em" }}>
          404<span style={{ color: "var(--primary)" }}>.</span>
        </div>
        <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em", margin: "16px 0 8px", textWrap: "balance" }}>
          This page went to zero.
        </h1>
        <p style={{ fontSize: 14, color: "var(--ink-2)", lineHeight: 1.6, margin: "0 auto 26px", maxWidth: "38ch", textWrap: "pretty" }}>
          Vera priced every venue and found no liquidity here. Whatever you were looking for is not listed on this page.
        </p>

        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          <Link
            href="/"
            className="nf-cta"
            style={{ height: 44, padding: "0 22px", borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 8, background: "var(--primary)", color: "var(--primary-ink)", fontSize: 14, fontWeight: 700, textDecoration: "none" }}
          >
            Back to Monvera
          </Link>
          <Link
            href="/app"
            style={{ height: 44, padding: "0 18px", borderRadius: 8, display: "inline-flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", color: "var(--ink-2)", fontSize: 14, fontWeight: 600, textDecoration: "none" }}
          >
            Open the app
          </Link>
        </div>
      </div>
    </div>
  );
}
