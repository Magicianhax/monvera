"use client";

// TokenLogo — a real asset/token logo (from displayAssets) as a round badge,
// with a graceful coloured-monogram fallback if the image fails to load. One
// consistent treatment for cash, send chips, transaction rows, etc.
import { useState } from "react";
import { displayFor } from "@/lib/displayAssets";

export function TokenLogo({
  symbol,
  name,
  size = 38,
}: {
  symbol: string;
  name?: string;
  size?: number;
}) {
  const d = displayFor(symbol, name);
  const [failed, setFailed] = useState(false);
  const showImg = d.logo && !failed;

  if (showImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote/SVG token logos, no Image loader
      <img
        src={d.logo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        style={{ width: size, height: size, borderRadius: "50%", flex: "none", display: "block", objectFit: "cover" }}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flex: "none",
        display: "grid",
        placeItems: "center",
        background: d.color,
        color: "#fff",
        fontWeight: 700,
        fontSize: size * 0.42,
      }}
    >
      {d.glyph ?? (d.name || symbol)[0]?.toUpperCase()}
    </span>
  );
}
