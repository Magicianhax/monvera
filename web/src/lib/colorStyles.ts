// Monvera color styles — selectable brand palettes.
//
// The base theme lives in globals.css (which is edit-local-only / uncommittable),
// so the shippable brand color lives HERE as committed data and is injected as a
// <style> that overrides the .stax base tokens for both modes (see ColorStyleTag).
// Only BRAND tokens change per style (--primary/--hero-grad/--accent/--glow/…);
// the semantic up=green / down=red (--pos/--neg) stay put so gains always read green.

export interface StyleVars {
  primary: string;
  primarySoft: string;
  primaryInk: string;
  heroGrad: string;
  accent: string;
  accentSoft: string;
  /** rgba(...) inner color for the --glow ring. */
  glow: string;
}

export interface ColorStyle {
  key: string;
  name: string;
  /** Representative hex for the picker swatch (the light-mode primary). */
  swatch: string;
  light: StyleVars;
  dark: StyleVars;
}

export const DEFAULT_COLOR = "emerald";

export const COLOR_STYLES: ColorStyle[] = [
  {
    key: "emerald",
    name: "Emerald",
    swatch: "#2f9d67",
    light: { primary: "#2f9d67", primarySoft: "#e0f2e8", primaryInk: "#ffffff", heroGrad: "linear-gradient(145deg, #47b585 0%, #2f9d67 52%, #24895a 100%)", accent: "#2f9d8a", accentSoft: "#e1f1ee", glow: "rgba(47, 157, 103, 0.18)" },
    dark: { primary: "#43ba85", primarySoft: "#1e2c25", primaryInk: "#0f1413", heroGrad: "linear-gradient(145deg, #57c99b 0%, #43ba85 55%, #37a473 100%)", accent: "#40bfa6", accentSoft: "#16292b", glow: "rgba(67, 186, 133, 0.22)" },
  },
  {
    key: "sapphire",
    name: "Sapphire",
    swatch: "#2f6ad0",
    light: { primary: "#2f6ad0", primarySoft: "#e2ebfb", primaryInk: "#ffffff", heroGrad: "linear-gradient(145deg, #4d84e6 0%, #2f6ad0 52%, #2456b0 100%)", accent: "#2f8ad0", accentSoft: "#e2eefb", glow: "rgba(47, 106, 208, 0.18)" },
    dark: { primary: "#5b8cf0", primarySoft: "#1c2438", primaryInk: "#0f1220", heroGrad: "linear-gradient(145deg, #77a2f6 0%, #5b8cf0 55%, #4a78de 100%)", accent: "#5ba8f0", accentSoft: "#16202e", glow: "rgba(91, 140, 240, 0.22)" },
  },
  {
    key: "violet",
    name: "Violet",
    swatch: "#7a4fd0",
    light: { primary: "#7a4fd0", primarySoft: "#ece4fb", primaryInk: "#ffffff", heroGrad: "linear-gradient(145deg, #9068e6 0%, #7a4fd0 52%, #653cb4 100%)", accent: "#a04fd0", accentSoft: "#f0e4fb", glow: "rgba(122, 79, 208, 0.18)" },
    dark: { primary: "#a07ff0", primarySoft: "#241c38", primaryInk: "#0f0f20", heroGrad: "linear-gradient(145deg, #b79bf6 0%, #a07ff0 55%, #8a6bde 100%)", accent: "#b47ff0", accentSoft: "#201628", glow: "rgba(160, 127, 240, 0.22)" },
  },
  {
    key: "amber",
    name: "Amber",
    swatch: "#cf8a2a",
    light: { primary: "#cf8a2a", primarySoft: "#f7ecd8", primaryInk: "#ffffff", heroGrad: "linear-gradient(145deg, #e0a24a 0%, #cf8a2a 52%, #b5741e 100%)", accent: "#cf6a2a", accentSoft: "#f7e6d8", glow: "rgba(207, 138, 42, 0.18)" },
    dark: { primary: "#e0a94a", primarySoft: "#2e2616", primaryInk: "#1a1408", heroGrad: "linear-gradient(145deg, #eec06a 0%, #e0a94a 55%, #cf9438 100%)", accent: "#e0864a", accentSoft: "#2a2016", glow: "rgba(224, 169, 74, 0.22)" },
  },
  {
    key: "rose",
    name: "Rose",
    swatch: "#d0466f",
    light: { primary: "#d0466f", primarySoft: "#fbe2ea", primaryInk: "#ffffff", heroGrad: "linear-gradient(145deg, #e6688b 0%, #d0466f 52%, #b43458 100%)", accent: "#d04690", accentSoft: "#fbe2f0", glow: "rgba(208, 70, 111, 0.18)" },
    dark: { primary: "#ef6a8f", primarySoft: "#381c26", primaryInk: "#200f16", heroGrad: "linear-gradient(145deg, #f68aa8 0%, #ef6a8f 55%, #de5578 100%)", accent: "#ef6ab4", accentSoft: "#2e1620", glow: "rgba(239, 106, 143, 0.22)" },
  },
  {
    key: "slate",
    name: "Slate",
    swatch: "#4a5568",
    light: { primary: "#4a5568", primarySoft: "#e8eaef", primaryInk: "#ffffff", heroGrad: "linear-gradient(145deg, #5f6b80 0%, #4a5568 52%, #3a4356 100%)", accent: "#4a6068", accentSoft: "#e8ecef", glow: "rgba(74, 85, 104, 0.16)" },
    dark: { primary: "#8a94a8", primarySoft: "#22262e", primaryInk: "#0f1218", heroGrad: "linear-gradient(145deg, #a2acbe 0%, #8a94a8 55%, #767f92 100%)", accent: "#8aa4a8", accentSoft: "#1a1e26", glow: "rgba(138, 148, 168, 0.20)" },
  },
];

export function colorStyleByKey(key: string): ColorStyle {
  return COLOR_STYLES.find((s) => s.key === key) ?? COLOR_STYLES[0];
}

// Radius theme — big, friendly rounded corners (the "cute" look). Radii only;
// surfaces + shadows live in SOFT_THEME_CSS below. Committed, so it ships
// regardless of globals.css.
export const ROUND_THEME_CSS =
  ".stax{--r-sm:12px;--r:16px;--r-lg:22px;--r-xl:28px;}" +
  ".stax .chip{border-radius:999px}" + // pills
  ".stax .tile{border-radius:15px}" +
  ".stax .seg{border-radius:999px}" +
  ".stax .seg-item,.stax .seg-thumb{border-radius:999px}" +
  '.stax[data-mode="light"]{--rr:22px;--rr-lg:28px;}' +
  '.stax[data-mode="dark"]{--rr:22px;--rr-lg:28px;}';

// Soft "cute" theme — a gentle pastel backdrop, clean white/ink cards that FLOAT
// on soft, diffuse shadows (elevation, not hairlines). Applied to the app (.stax)
// only; the marketing site (.site) keeps its own design (just brand color + font).
// Emitted AFTER globals.css AND ROUND_THEME_CSS, so its surface/shadow values win.
export const SOFT_THEME_CSS =
  // UI typeface: Geist (loaded in layout.tsx). The serif stays Fraunces.
  ".stax{--font-ui:var(--font-roboto),Roboto,system-ui,-apple-system,sans-serif;}" +
  ".site{--s-ui:var(--font-geist),system-ui,-apple-system,sans-serif;}" +
  // ── App: light — brand-tinted aurora (blobs shift with the chosen color) ──
  '.stax,.stax[data-mode="light"]{' +
  "--paper:#eef2ec;" +
  "--app-bg:" +
  "radial-gradient(58% 46% at 6% 0%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 60%)," +
  "radial-gradient(56% 44% at 100% 8%, color-mix(in srgb, var(--accent) 18%, transparent), transparent 58%)," +
  "radial-gradient(70% 42% at 92% 62%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 60%)," +
  "radial-gradient(90% 60% at 50% 116%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 66%)," +
  "linear-gradient(165deg, #f5f9f4 0%, #ecf2ec 58%, #e5eee6 100%);" +
  "--surface:#ffffff;--surface-grad:linear-gradient(180deg,#ffffff,#fbfdfb);--surface-2:#f1f5f0;" +
  "--line:#e6ebe3;--line-2:#eef2ec;" +
  // Frosted-glass fills so section boxes let the aurora bleed through and dissolve
  // into the background (opaque --surface stays for CTAs / modals / tab bar).
  "--glass:#ffffff;--glass-2:#f4f7f3;--glass-stroke:#e6ebe3;--glass-blur:blur(22px) saturate(1.25);" +
  "--glass-bg:rgba(255,255,255,.60);--glass-bg-2:rgba(243,247,243,.5);" +
  "--glass-hi:inset 0 0 0 0 transparent;" +
  "--glass-shadow:0 2px 12px rgba(60,80,60,.06),0 1px 3px rgba(60,80,60,.04);" +
  // Feathered shadows so cards dissolve into the background rather than cut a hard edge.
  "--shadow:0 4px 18px rgba(60,80,60,.045),0 18px 44px rgba(60,80,60,.075);" +
  "--shadow-lg:0 6px 22px rgba(60,80,60,.06),0 28px 60px rgba(60,80,60,.11);}" +
  // ── App: dark — glowing brand aurora over near-black ──
  '.stax[data-mode="dark"]{' +
  "--paper:#0f1315;" +
  "--app-bg:" +
  "radial-gradient(56% 44% at 4% 0%, color-mix(in srgb, var(--primary) 26%, transparent), transparent 58%)," +
  "radial-gradient(54% 42% at 100% 6%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 56%)," +
  "radial-gradient(66% 40% at 96% 60%, color-mix(in srgb, var(--primary) 14%, transparent), transparent 58%)," +
  "radial-gradient(88% 58% at 50% 118%, color-mix(in srgb, var(--primary) 20%, transparent), transparent 64%)," +
  "linear-gradient(165deg, #12181b 0%, #0f1417 60%, #0b0f12 100%);" +
  "--surface:#1b2124;--surface-grad:linear-gradient(180deg,#1e2427,#191f22);--surface-2:#232b2e;" +
  "--line:#2a3236;--line-2:#222a2d;" +
  "--glass:#1b2124;--glass-2:#20282b;--glass-stroke:#2a3236;--glass-blur:blur(22px) saturate(1.25);" +
  "--glass-bg:rgba(27,34,39,.52);--glass-bg-2:rgba(44,53,58,.42);" +
  "--glass-hi:inset 0 0 0 0 transparent;" +
  "--glass-shadow:0 2px 14px rgba(0,0,0,.30);" +
  "--shadow:0 4px 18px rgba(0,0,0,.24),0 18px 46px rgba(0,0,0,.34);" +
  "--shadow-lg:0 6px 24px rgba(0,0,0,.30),0 28px 62px rgba(0,0,0,.44);}" +
  // Frosted glass for section cards: translucent fill + backdrop blur so the
  // aurora shows through and the edges dissolve into the background.
  ".stax .card{background:var(--glass-bg);backdrop-filter:var(--glass-blur);-webkit-backdrop-filter:var(--glass-blur);}" +
  // Custom pull-to-refresh owns the top overscroll (blocks the browser's own).
  ".stax .screen{overscroll-behavior-y:contain;}" +
  // Screens are fixed-height flex columns: without this, when content exceeds
  // the viewport every child gets vertically CRUSHED (default flex-shrink:1)
  // instead of the screen scrolling — the recurring "range chips / cards are
  // hidden" bug. Children that should flex set flex:1 inline, which still wins.
  ".stax .screen>*{flex-shrink:0;}" +
  // Lighter type register: the app avoids true bold almost everywhere (Roboto
  // reads solid at 500-600). Inline weights are softened in the components.
  ".stax b,.stax strong{font-weight:600;}" +
  ".stax .btn{font-weight:600;}" +
  ".stax .label-eyebrow{font-weight:600;}" +
  // Gentle, unhurried entrances.
  ".stax .anim-rise{animation-duration:.30s;}" +
  ".stax .anim-fade{animation-duration:.24s;}" +
  ".stax .stagger-in>*{animation-duration:.30s;}" +
  ".stax .stagger-in>*:nth-child(1){animation-delay:.02s}" +
  ".stax .stagger-in>*:nth-child(2){animation-delay:.05s}" +
  ".stax .stagger-in>*:nth-child(3){animation-delay:.08s}" +
  ".stax .stagger-in>*:nth-child(4){animation-delay:.11s}" +
  ".stax .stagger-in>*:nth-child(5){animation-delay:.14s}" +
  ".stax .stagger-in>*:nth-child(6){animation-delay:.17s}" +
  ".stax .stagger-in>*:nth-child(7){animation-delay:.20s}" +
  ".stax .stagger-in>*:nth-child(8){animation-delay:.23s}" +
  // Desktop backdrop behind the phone frame — soft brand-tinted aurora.
  ".stax-backdrop{background:" +
  "radial-gradient(45% 40% at 12% 8%, color-mix(in srgb, var(--primary) 18%, transparent), transparent 60%)," +
  "radial-gradient(42% 38% at 88% 18%, #e7defb 0%, transparent 60%)," +
  "radial-gradient(50% 45% at 78% 92%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 62%)," +
  "linear-gradient(160deg, #eef0f7 0%, #eaf3ee 100%);}" +
  '.stax-backdrop[data-mode="dark"]{background:' +
  "radial-gradient(45% 40% at 12% 8%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 60%)," +
  "radial-gradient(50% 45% at 85% 90%, color-mix(in srgb, var(--accent) 12%, transparent), transparent 62%)," +
  "#0a0d0c;}" +
  "";

// Desktop shell (≥1024px). The mobile app is a 440px column; on desktop it widens
// into a two-region layout — a persistent SideNav + a content region holding the
// existing screens. Everything real is gated on min-width:1024px, so below that
// not one rule changes and mobile stays byte-for-byte identical. Emitted after
// globals.css so the .stax width/shape override wins by cascade order (globals.css
// is edit-local-only and never touched).
export const DESKTOP_CSS =
  // Shell scaffolding, present at all widths. Inert on mobile: SideNav is hidden
  // and app-shell/app-content simply fill .stax exactly as the screen did before.
  ".stax .app-shell{position:absolute;inset:0;}" +
  ".stax .app-content{position:absolute;inset:0;}" +
  ".stax .sidenav{display:none;}" +
  "@media (min-width:1024px){" +
  // Full-screen desktop app — edge to edge, no floating phone/tablet card.
  ".stax-backdrop{padding:0;align-items:stretch;}" +
  ".stax-backdrop .stax{max-width:none;width:100%;height:100dvh;border-radius:0;box-shadow:none;}" +
  '.stax-backdrop[data-mode="dark"] .stax{box-shadow:none;}' +
  ".stax .app-shell{display:flex;flex-direction:row;}" +
  ".stax .app-content{position:relative;inset:auto;flex:1 1 0;min-width:0;height:100%;}" +
  ".stax .sidenav{display:flex;}" +
  ".stax .app-tabbar{display:none;}" +
  // Desktop-native dashboard screens (DesktopHome, …) own the full content width.
  ".stax .app-content .deskscreen{position:absolute;inset:0;overflow-y:auto;}" +
  // Reused mobile *flow* screens (invest, receipt, …) still read as a centered
  // column rather than stretching edge to edge.
  ".stax .app-content .screen{max-width:560px;margin-inline:auto;}" +
  // Live ticker tape pinned to the top of the content area (the screen below is
  // offset by 40px inline when it's shown). Only rendered on desktop dashboards.
  ".stax .desk-ticker{position:absolute;top:0;left:0;right:0;height:40px;z-index:6;overflow:hidden;border-bottom:1px solid var(--line);background:color-mix(in srgb,var(--surface) 92%,transparent);backdrop-filter:saturate(150%) blur(6px);display:flex;align-items:center;}" +
  ".stax .desk-ticker-track{display:flex;align-items:center;width:max-content;animation:mvticker 64s linear infinite;}" +
  // Nav + row + tile interaction states.
  ".stax .sidenav-item{transition:background .16s var(--ease-out),color .16s var(--ease-out);cursor:pointer;}" +
  ".stax .sidenav-item:focus-visible{outline:2px solid var(--primary);outline-offset:2px;}" +
  ".stax .navlogo{cursor:pointer;}" +
  ".stax .desk-row,.stax .desk-tile,.stax .desk-chip{transition:background .14s var(--ease-out),border-color .14s var(--ease-out),color .14s var(--ease-out);cursor:pointer;}" +
  "}" +
  "@keyframes mvticker{from{transform:translateX(0)}to{transform:translateX(-50%)}}" +
  // Hover only on real pointers (touch laptops fire hover-on-tap; don't).
  "@media (min-width:1024px) and (hover:hover) and (pointer:fine){" +
  ".stax .sidenav-item:not(.is-active):hover{background:var(--surface-2);color:var(--ink);}" +
  ".stax .desk-row:hover{background:var(--surface-2);}" +
  ".stax .desk-tile:hover{border-color:var(--primary);}" +
  ".stax .desk-chip:hover{border-color:var(--primary);color:var(--ink);}" +
  ".stax .navlogo:hover{opacity:.85;}" +
  "}";

function block(selector: string, v: StyleVars): string {
  return (
    `${selector}{` +
    `--primary:${v.primary};--primary-soft:${v.primarySoft};--primary-ink:${v.primaryInk};` +
    `--hero-grad:${v.heroGrad};--accent:${v.accent};--accent-soft:${v.accentSoft};` +
    `--glow:0 0 0 6px ${v.glow};` +
    `}`
  );
}

/** CSS that overrides the base brand tokens for the chosen style (app + marketing). */
export function colorStyleCss(key: string): string {
  const s = colorStyleByKey(key);
  return (
    block('.stax[data-mode="light"]', s.light) +
    block('.stax[data-mode="dark"]', s.dark) +
    `.site[data-mode="light"]{--s-primary:${s.light.primary};}` +
    `.site[data-mode="dark"]{--s-primary:${s.dark.primary};}`
  );
}
