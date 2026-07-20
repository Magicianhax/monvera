// GroveCover — code-native generative cover art for the Grove cards and detail
// bands. One distinctive inline-SVG motif per grove, drawn in currentColor so
// it follows each surface's theme tokens (app glass + public emerald room both
// define --primary). No raster assets, no chat deps — safe to import from the
// public site pages AND the in-app chat surfaces.
//
// Override: when GroveDef.coverImage is set (owner drops generated art into
// web/public/groves/<id>.jpg and points the registry at "/groves/<id>.jpg"),
// the raster replaces the SVG motif; the accent wash stays on top so the card
// keeps its tint either way.
//
// The component fills its parent (parent controls the aspect ratio / height).
import type { CSSProperties, ReactNode } from "react";

// Per-grove accent hues — always color-mix against the surface's own --primary
// so the brand green dominates and the hue is only a tint, never a raw hex
// taking over: tayyib emerald-gold, titan deep blue-green, silic teal, rails
// amber-green.
const ACCENTS: Record<string, string> = {
  tayyib: "color-mix(in srgb, var(--primary) 60%, #c9a24f)",
  titan: "color-mix(in srgb, var(--primary) 52%, #2e6f8f)",
  silic: "color-mix(in srgb, var(--primary) 56%, #2fb3ab)",
  rails: "color-mix(in srgb, var(--primary) 56%, #d9982f)",
};

/** The grove's accent color (falls back to plain --primary for unknown ids). */
export function groveAccent(id: string): string {
  return ACCENTS[id] ?? "var(--primary)";
}

function MotifSvg({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 400 200"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    >
      {children}
    </svg>
  );
}

/** Tayyib — geometric eight-fold star lattice (two rotated squares per tile),
 *  quiet field with one focal star. */
function TayyibMotif() {
  return (
    <MotifSvg>
      <defs>
        <pattern id="gcp-tayyib" width="50" height="50" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1">
            <rect x="13" y="13" width="24" height="24" />
            <rect x="13" y="13" width="24" height="24" transform="rotate(45 25 25)" />
          </g>
        </pattern>
      </defs>
      <rect width="400" height="200" fill="url(#gcp-tayyib)" opacity="0.15" />
      <g fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.55" transform="translate(298 64) scale(1.9)">
        <rect x="-12" y="-12" width="24" height="24" />
        <rect x="-12" y="-12" width="24" height="24" transform="rotate(45)" />
        <circle r="17.5" opacity="0.55" />
      </g>
    </MotifSvg>
  );
}

/** Titan — seven orbital rings around a bright anchor, a few bodies in orbit. */
function TitanMotif() {
  return (
    <MotifSvg>
      {[18, 36, 54, 72, 90, 108, 126].map((r, i) => (
        <circle key={r} cx="268" cy="102" r={r} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.42 - i * 0.045} />
      ))}
      <circle cx="268" cy="102" r="5.5" fill="currentColor" opacity="0.85" />
      <circle cx="312" cy="71" r="3" fill="currentColor" opacity="0.7" />
      <circle cx="190" cy="147" r="2.5" fill="currentColor" opacity="0.55" />
      <circle cx="150" cy="59" r="2" fill="currentColor" opacity="0.4" />
    </MotifSvg>
  );
}

/** Silic — wafer/die grid with one lit trace routing across the die. */
function SilicMotif() {
  const trace = "0,150 90,150 90,82 192,82 192,116 300,116 300,48 400,48";
  return (
    <MotifSvg>
      <defs>
        <pattern id="gcp-silic" width="34" height="34" patternUnits="userSpaceOnUse">
          <rect x="3" y="3" width="28" height="28" rx="3" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="400" height="200" fill="url(#gcp-silic)" opacity="0.14" />
      <polyline points={trace} fill="none" stroke="currentColor" strokeWidth="6" opacity="0.16" strokeLinejoin="round" />
      <polyline points={trace} fill="none" stroke="currentColor" strokeWidth="2" opacity="0.75" strokeLinejoin="round" />
      {[[90, 150], [192, 82], [300, 116]].map(([x, y]) => (
        <rect key={`${x}-${y}`} x={x - 3.5} y={y - 3.5} width="7" height="7" rx="1.5" fill="currentColor" opacity="0.6" />
      ))}
    </MotifSvg>
  );
}

/** Rails — track lines converging on a signal light, sleepers fading with
 *  distance. */
function RailsMotif() {
  // Sleepers between the two center rails A(60,200→330,18) and B(150,200→330,18),
  // sampled at equal t so they stay horizontal and shrink toward the vanishing
  // point. Precomputed — no runtime math for a static motif.
  const sleepers: Array<[number, number, number, number]> = [
    [92.4, 171.6, 178.2, 3.2],
    [141, 204, 145.4, 2.6],
    [189.6, 236.4, 112.6, 2],
    [238.2, 268.8, 79.9, 1.5],
    [281.4, 297.6, 50.8, 1],
  ];
  return (
    <MotifSvg>
      {[-30, 60, 150, 250, 360].map((x0, i) => (
        <line key={x0} x1={x0} y1="200" x2="330" y2="18" stroke="currentColor" strokeWidth="1.2" opacity={i === 1 || i === 2 ? 0.42 : 0.2} />
      ))}
      {sleepers.map(([xa, xb, y, w]) => (
        <line key={y} x1={xa} y1={y} x2={xb} y2={y} stroke="currentColor" strokeWidth={w} opacity={0.5 - (200 - y) * 0.002} />
      ))}
      <circle cx="330" cy="18" r="3.5" fill="currentColor" opacity="0.8" />
      <circle cx="330" cy="18" r="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
    </MotifSvg>
  );
}

const MOTIFS: Record<string, () => ReactNode> = {
  tayyib: TayyibMotif,
  titan: TitanMotif,
  silic: SilicMotif,
  rails: RailsMotif,
};

/** Fallback for ids without a bespoke motif — quiet concentric arcs. */
function DefaultMotif() {
  return (
    <MotifSvg>
      {[30, 60, 90, 120].map((r, i) => (
        <circle key={r} cx="290" cy="100" r={r} fill="none" stroke="currentColor" strokeWidth="1" opacity={0.35 - i * 0.07} />
      ))}
    </MotifSvg>
  );
}

/** The cover itself: motif (or raster override) + the grove's accent wash.
 *  Fills its parent — the parent sets the aspect ratio / height and rounding. */
export function GroveCover({ id, coverImage, style }: {
  id: string;
  /** Raster override from GroveDef.coverImage (e.g. "/groves/tayyib.jpg"). */
  coverImage?: string;
  style?: CSSProperties;
}) {
  const accent = groveAccent(id);
  const Motif = MOTIFS[id] ?? DefaultMotif;
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, overflow: "hidden", color: accent, ...style }}>
      {coverImage ? (
        // eslint-disable-next-line @next/next/no-img-element -- decorative cover, plain img keeps this component boundary-free
        <img src={coverImage} alt="" loading="lazy" decoding="async" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <Motif />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(165deg, color-mix(in srgb, ${accent} 28%, transparent), color-mix(in srgb, ${accent} 9%, transparent) 55%, transparent 88%)`,
        }}
      />
    </div>
  );
}
