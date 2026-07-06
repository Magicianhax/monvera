"use client";

// Monvera brand marks.
//   MonveraIcon    — the brand mark: a rising trend line sweeping through a leaf
//                    (money + growth). Brand asset; green on any bg, white knockout.
//   MonveraMark    — deprecated alias for MonveraIcon (kept for back-compat).
//   MonveraTile    — the app-icon tile (green gradient + white mark).
//   MonveraWordmark— bare green mark + serif "Monvera" (matches the master logo).
//   VeraOrb        — Vera's glassy presence (unchanged; product = Monvera, agent = Vera).
//   AssetTile      — a stock/token tile (real logo on white, monogram fallback).
import { useState } from "react";
import { asset } from "@/lib/assets";

export interface MonveraIconProps {
  size?: number;
  /** "green" brand mark (default) or the "white" knockout for green/dark tiles. */
  variant?: "green" | "white";
  className?: string;
}

// The Monvera mark — a rising trend line sweeping through a leaf (money + growth).
// Rendered from the brand asset so it stays pixel-faithful; the green mark works on
// any background, the white knockout sits inside the app-icon tile.
export function MonveraIcon({ size = 28, variant = "green", className }: MonveraIconProps) {
  const src = variant === "white" ? asset("/brand/monvera-icon-white.png") : asset("/brand/monvera-icon.png");
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      decoding="async"
      className={className}
      style={{ width: size, height: size, display: "block", flex: "none" }}
    />
  );
}

export interface MonveraMarkProps {
  size?: number;
  color?: string;
  /** Retained for back-compat; ignored (the mark is a fixed brand asset). */
  weight?: number;
}

// Deprecated alias — prefer MonveraIcon. Maps a white-ish `color` to the white
// knockout so older callers (e.g. on a coloured tile) still render correctly.
export function MonveraMark({ size = 28, color }: MonveraMarkProps) {
  const variant = color && /fff|white|255/i.test(String(color)) ? "white" : "green";
  return <MonveraIcon size={size} variant={variant} />;
}

export interface MonveraTileProps {
  size?: number;
  radius?: number;
}

// App-icon tile: green gradient rounded square with the white mark.
export function MonveraTile({ size = 36, radius }: MonveraTileProps) {
  const br = radius ?? Math.round(size * 0.24);
  return (
    <span
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: br,
        background: "var(--hero-grad)",
        boxShadow: "0 4px 14px rgba(70, 84, 62, 0.18)",
        flex: "none",
      }}
    >
      <MonveraIcon size={Math.round(size * 0.6)} variant="white" />
    </span>
  );
}

export interface MonveraWordmarkProps {
  /** Mark tile size; the wordmark text scales relative to it. */
  size?: number;
}

// Monvera logotype — the bare green mark beside a serif "Monvera", matching the
// master logo (single-colour wordmark; text inherits --ink so it works light/dark).
export function MonveraWordmark({ size = 30 }: MonveraWordmarkProps) {
  const mark = Math.round(size * 1.22);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: Math.round(size * 0.3) }}>
      <MonveraIcon size={mark} />
      <span
        className="serif"
        style={{ fontSize: size * 0.98, lineHeight: 1, letterSpacing: "-.012em", color: "var(--ink)" }}
      >
        Monvera
      </span>
    </span>
  );
}

export interface VeraOrbProps {
  size?: number;
  /** Breathing animation — a calm idle/working presence. */
  pulse?: boolean;
  /** Kept for API compatibility; no longer renders rings. */
  thinking?: boolean;
}

// Vera — the AI broker's presence: a glassy, iridescent sphere (rendered asset at
// /brand/vera.png). Breathes gently when `pulse`.
export function VeraOrb({ size = 36, pulse = false }: VeraOrbProps) {
  return (
    <img
      src={asset("/brand/vera.png")}
      alt=""
      width={size}
      height={size}
      decoding="async"
      style={{
        width: size,
        height: size,
        display: "block",
        flex: "none",
        borderRadius: "50%",
        animation: pulse ? "spin 8s linear infinite" : "none",
      }}
    />
  );
}

// Minimal shape an AssetTile needs. Real asset objects (from lib/tokens.ts)
// can be adapted to this in the screen layer.
export interface TileAsset {
  name: string;
  /** Background color for the tile. */
  color: string;
  /** Optional single-letter glyph; falls back to the first letter of `name`. */
  glyph?: string;
  /** "safe" tiles always render a "$". */
  kind?: string;
  /** Optional brand logo URL — rendered on a white tile, falls back to monogram on error. */
  logo?: string;
}

export interface AssetTileProps {
  asset: TileAsset;
  size?: number;
  radius?: number;
}

// Stock tile — renders the real stock logo on a clean white tile when `asset.logo`
// is set (falling back to the colored monogram if the image fails), else the
// colored monogram lettermark.
export function AssetTile({ asset, size = 44, radius }: AssetTileProps) {
  const letter = asset.glyph || asset.name[0] || "?";
  const fs = size * 0.4;
  const br = radius ?? size * 0.24;
  const [imgFailed, setImgFailed] = useState(false);

  if (asset.logo && !imgFailed) {
    return (
      <div
        className="tile"
        style={{
          width: size,
          height: size,
          background: "#fff",
          borderRadius: br,
          overflow: "hidden",
          padding: 0,
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,.06)",
        }}
      >
        <img
          src={asset.logo}
          alt={asset.name}
          width={size}
          height={size}
          decoding="async"
          onError={() => setImgFailed(true)}
          style={{ width: size, height: size, objectFit: "cover", display: "block" }}
        />
      </div>
    );
  }

  return (
    <div
      className="tile"
      style={{
        width: size,
        height: size,
        background: asset.color,
        borderRadius: br,
        fontSize: fs,
      }}
    >
      {asset.kind === "safe" ? "$" : letter.toUpperCase()}
    </div>
  );
}
