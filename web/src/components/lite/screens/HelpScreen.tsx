"use client";

// Help & FAQ — plain-language answers to the questions new investors actually
// ask. Content is shared with the marketing landing via lib/faq (single source).
import { useState } from "react";
import { Icon } from "@/components/design";
import { haptic } from "@/lib/haptics";
import { FAQ } from "@/lib/faq";
import { SUPPORT_EMAIL } from "@/lib/seo";
import { PartnerStrip } from "@/components/shared/Partners";
import { iconBtn } from "./primitives";

// One expandable question. Collapses with a grid-rows 0fr→1fr height animation
// (no JS measurement) so the answer eases open instead of snapping.
function FaqRow({
  q,
  a,
  open,
  onToggle,
  borderTop,
}: {
  q: string;
  a: string;
  open: boolean;
  onToggle: () => void;
  borderTop: boolean;
}) {
  return (
    <div style={{ borderTop: borderTop ? "1px solid var(--line-2)" : "none" }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="row"
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 13,
          padding: "15px 2px",
          textAlign: "left",
        }}
      >
        <span style={{ flex: 1, fontWeight: 600, fontSize: 15.5, letterSpacing: "-.01em", lineHeight: 1.35 }}>
          {q}
        </span>
        <Icon
          name="chevD"
          size={18}
          style={{
            flex: "none",
            color: "var(--ink-3)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform .3s var(--ease-soft)",
          }}
        />
      </button>
      <div
        style={{
          display: "grid",
          gridTemplateRows: open ? "1fr" : "0fr",
          transition: "grid-template-rows .32s var(--ease-soft)",
        }}
      >
        <div style={{ overflow: "hidden" }}>
          <p
            style={{
              margin: 0,
              padding: "0 30px 16px 2px",
              fontSize: 14.5,
              lineHeight: 1.62,
              color: "var(--ink-2)",
            }}
          >
            {a}
          </p>
        </div>
      </div>
    </div>
  );
}

export function HelpScreen({
  go,
}: {
  go: (target: string | number, params?: Record<string, unknown>) => void;
}) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="screen screen-pad-top" style={{ paddingBottom: 40 }}>
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 22px 0" }}>
        <button onClick={() => go(-1)} style={iconBtn} className="tap" aria-label="Back">
          <Icon name="back" size={20} />
        </button>
        <h1 className="serif" style={{ margin: 0, fontSize: 27, letterSpacing: "-.01em" }}>
          Help
        </h1>
      </div>

      <div className="anim-rise" style={{ padding: "14px 22px 0" }}>
        <p style={{ margin: "0 0 18px", fontSize: 15, lineHeight: 1.55, color: "var(--ink-2)" }}>
          The short answers to what people ask most. Still stuck? Ask Vera anything in plain words;
          she’s built to explain.
        </p>
        <div className="card" style={{ padding: "4px 16px" }}>
          {FAQ.map((item, i) => (
            <FaqRow
              key={item.q}
              q={item.q}
              a={item.a}
              open={open === i}
              borderTop={i > 0}
              onToggle={() => {
                haptic.select();
                setOpen((cur) => (cur === i ? null : i));
              }}
            />
          ))}
        </div>

        {/* Contact — a real human, one tap away */}
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="card tap"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 13,
            marginTop: 14,
            padding: "16px",
            textDecoration: "none",
          }}
        >
          <span
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              flex: "none",
              display: "grid",
              placeItems: "center",
              background: "var(--primary-soft)",
              color: "var(--primary)",
            }}
          >
            <Icon name="mail" size={20} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Contact support</div>
            <div style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{SUPPORT_EMAIL}</div>
          </div>
          <Icon name="arrowUR" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />
        </a>

        {/* Who powers Monvera — real partners, credited and linked. */}
        <PartnerStrip />
      </div>
    </div>
  );
}
