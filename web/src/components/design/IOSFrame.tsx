"use client";

// Monvera iOS device frame — adapted from the design handoff (ios-frame.jsx).
// Renders the bezel, dynamic island, status bar and home indicator. The Monvera
// app mounts *inside* this frame (wrapped in a `.stax` element by the caller).
//
// Responsive behavior: on phones it fills the screen edge-to-edge; on larger
// screens it renders as a centered device with bezel + shadow.
import type { ReactNode } from "react";

export interface IOSStatusBarProps {
  dark?: boolean;
  time?: string;
}

export function IOSStatusBar({ dark = false, time = "9:41" }: IOSStatusBarProps) {
  const c = dark ? "#fff" : "#000";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "21px 30px 19px",
        boxSizing: "border-box",
        position: "relative",
        zIndex: 20,
        width: "100%",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", paddingTop: 1.5 }}>
        <span
          style={{
            fontFamily: '-apple-system, "SF Pro", system-ui',
            fontWeight: 590,
            fontSize: 17,
            lineHeight: "22px",
            color: c,
          }}
        >
          {time}
        </span>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 7, paddingTop: 1, paddingRight: 1 }}>
        <svg width="19" height="12" viewBox="0 0 19 12">
          <rect x="0" y="7.5" width="3.2" height="4.5" rx="0.7" fill={c} />
          <rect x="4.8" y="5" width="3.2" height="7" rx="0.7" fill={c} />
          <rect x="9.6" y="2.5" width="3.2" height="9.5" rx="0.7" fill={c} />
          <rect x="14.4" y="0" width="3.2" height="12" rx="0.7" fill={c} />
        </svg>
        <svg width="17" height="12" viewBox="0 0 17 12">
          <path
            d="M8.5 3.2C10.8 3.2 12.9 4.1 14.4 5.6L15.5 4.5C13.7 2.7 11.2 1.5 8.5 1.5C5.8 1.5 3.3 2.7 1.5 4.5L2.6 5.6C4.1 4.1 6.2 3.2 8.5 3.2Z"
            fill={c}
          />
          <path
            d="M8.5 6.8C9.9 6.8 11.1 7.3 12 8.2L13.1 7.1C11.8 5.9 10.2 5.1 8.5 5.1C6.8 5.1 5.2 5.9 3.9 7.1L5 8.2C5.9 7.3 7.1 6.8 8.5 6.8Z"
            fill={c}
          />
          <circle cx="8.5" cy="10.5" r="1.5" fill={c} />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.5" stroke={c} strokeOpacity="0.35" fill="none" />
          <rect x="2" y="2" width="20" height="9" rx="2" fill={c} />
          <path d="M25 4.5V8.5C25.8 8.2 26.5 7.2 26.5 6.5C26.5 5.8 25.8 4.8 25 4.5Z" fill={c} fillOpacity="0.4" />
        </svg>
      </div>
    </div>
  );
}

export interface IOSFrameProps {
  children: ReactNode;
  dark?: boolean;
}

// The device shell. `children` is the app surface (it should fill the frame and
// own its own scrolling — the design's `.screen` does this).
export function IOSFrame({ children, dark = false }: IOSFrameProps) {
  return (
    <div className="ios-frame" data-dark={dark ? "true" : "false"}>
      {/* dynamic island */}
      <div className="ios-island" />

      {/* status bar (absolute, over content) with a frosted backdrop so scrolling
          content passes behind it cleanly instead of colliding with the clock. */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 30,
          background: dark ? "rgba(21,25,26,0.55)" : "rgba(238,241,232,0.5)",
          backdropFilter: "blur(16px) saturate(180%)",
          WebkitBackdropFilter: "blur(16px) saturate(180%)",
          // soften the bottom edge so the frost doesn't read as a hard line
          maskImage: "linear-gradient(to bottom, #000 70%, transparent)",
          WebkitMaskImage: "linear-gradient(to bottom, #000 70%, transparent)",
        }}
      >
        <IOSStatusBar dark={dark} />
      </div>

      {/* app content */}
      <div className="ios-content">{children}</div>

      {/* home indicator */}
      <div className="ios-home-indicator" aria-hidden>
        <div className="ios-home-bar" />
      </div>
    </div>
  );
}
