# Design

Visual system for Monvera, captured from the live implementation. Theme name: **Ledger** — flat, sharp, precise; a premium consumer-fintech surface, not a crypto dashboard and not a soft toy. Light and dark are both first-class. All app styling is scoped under `.stax` (legacy scope name) and toggled with `[data-mode="light|dark"]`.

**Where the theme lives (important):** `src/app/globals.css` holds the legacy base but is edit-local-only (never committed). The shipping theme is the committed injector: `components/ColorStyleTag.tsx` emits `colorStyleCss(chosen) + SHARP_THEME_CSS + FLAT_THEME_CSS` from `lib/colorStyles.ts` as a `<style>` after globals.css, so equal-specificity overrides win by order. Change the theme there, not in globals.css.

## Theme

Flat, solid, sharp. Separation comes from 1px hairline borders, not blur or elevation: near-zero shadows, no glassmorphism, no aurora backdrop, radii 4–8px. The feeling target sits between a clean brokerage ledger and Linear/Stripe restraint, warmed by the brand green and the serif reserved for a few emotional moments. Mobile-first inside a centered iOS device frame on desktop.

## Color

A single brand color carries primary actions; everything else is quiet neutrals + hairlines. The brand color is **user-switchable**: six palettes (Emerald default, Sapphire, Violet, Amber, Rose, Slate) defined in `lib/colorStyles.ts`, picked in Settings → Color, persisted as `monvera:color`. Semantic up/down (`--pos` green / `--neg` red) never change with the palette. **Never hardcode a brand hex in a component — always the CSS variables.**

### Light (default)
- `--paper` / `--app-bg` `#f4f6f3` — flat, no gradient wash
- `--surface` `#ffffff`, `--surface-2` `#eef1ec` (recessed)
- Lines: `--line` `#e0e4de`, `--line-2` `#e9ece7`
- Ink ramp: `--ink` `#232a25`, `--ink-2` `#545d52`, `--ink-3` `#6e7768`
- Brand (per color style): `--primary`, `--primary-soft`, `--primary-ink`, `--hero-grad`, `--accent`, `--accent-soft`, `--glow`

### Dark
- `--paper` / `--app-bg` `#0f1211` — flat deep ink
- `--surface` `#161a18`, `--surface-2` `#1d2220`; lines `#252b28` / `#1f2422`
- Ink: `--ink` `#eef2f0`, `--ink-2` `#aeb6b3`, `--ink-3` `#8a938f`

### Contrast watch (a11y)
- Body text ≥ 4.5:1; `--ink-3` is metadata-only — anything users must read uses `--ink-2` or `--ink`.
- Day-move percentages render neutral (`--ink-3`) until live market data arrives — a fallback number must never wear a real ±color.

## Typography

Three families by role, loaded in `app/layout.tsx`:
- **Display:** Fraunces serif — now reserved for the Home greeting, the marketing hero, and success moments ONLY. Screen h1s elsewhere are strong sans (26–28px, weight 800, letter-spacing −0.02em). Never serif on labels, buttons, or data.
- **UI/body:** Hanken Grotesk, weights 400–800, carries all interface text.
- **Mono:** JetBrains Mono for addresses, receipts, on-chain lines. Numerals use `.tnum`.

Section headers in the Ledger language: 13px / weight 700 / `--ink-2`, in the 22px gutter, spacing `28px 22px 10px`.

## Ledger layout language (the bones)

- **Edge-to-edge sections, not floating card stacks.** A list is a full-width section bounded by 1px `--line` top/bottom; rows are padded `14px 22px` and separated by 1px `--line-2` hairlines. `className="card"` is reserved for genuinely standalone panels (a notice, the recover box, a confirm sheet) — never wraps a list.
- **Stat blocks are left-aligned, never centered.** Big `tnum` number with its meta (day move, sub-label) in one block.
- **No decorative glows.** The old radial aurora spans are gone. The only sanctioned halo is the focal glow on Vera's orb during the Thinking/Placing/Success moments (state, not decoration).
- Radii: 4–8px everywhere (`--r-sm` 3 / `--r` 5 / `--r-lg` 8 / `--rr` 5 / `--rr-lg` 7; chips 8, tiles 5). Genuinely circular things stay circles: avatars, the orb, toggle knobs, icon dots, thin progress bars.
- Screen padding: horizontal 22px gutter; single scrolling column; sticky action bars are solid `--surface` with a 1px `--line` top hairline (no gradient fade, no blur).
- Chrome: the bottom TabBar is a flat, full-width, hairline-topped solid bar; the center Invest action is an inline solid-primary square (no raised FAB).

## Material

Solid panels only. The `--glass*` tokens still exist but resolve flat (solid fills, `--glass-blur: none`, no-op highlight, hairline stroke) so legacy class compositions stay valid. No backdrop-filter on content; no translucency. Primary CTAs are solid `--primary`/`--hero-grad` (the per-style gradient is subtle) with text in `--primary-ink`.

## Components

Atoms under `.stax`: `.btn` (+`.btn-primary`, `.btn-ghost`, `.btn-outline`, `.btn-lg`, `.btn-block`), `.card` (standalone panels only), `.chip` (+`.is-on`), `.tile`, `.field`, `.seg`/`.seg-thumb`/`.seg-item`, `.row`, `.tap` press feedback, `.skeleton` shimmer.

State coverage (product register): default / hover (gated to `hover:hover`) / focus-visible / active / disabled / loading on every interactive element. Loading uses `.skeleton` rows matching the ledger grammar — not spinners in content. Empty states teach the next step and serve both paths ("Start with Vera" + "Browse the market").

## Motion

Transform/opacity only, 150–250ms, `--ease-out` `cubic-bezier(.23,1,.32,1)`. Motion conveys state; no page-load choreography on task screens. Delight is budgeted to the moments: plan landing, invest success (confetti + draw-in check), Vera thinking (orb). Full `prefers-reduced-motion` support: entrances never gate visibility.

## Marketing site (`.site`, brand register)

Same Ledger flatness, brand-register freedom: asymmetric left-anchored hero (copy column + interactive phone right), flat solid panels (`--s-surface` + 1px `--s-line`), hairline marquee/trust strips, mesh/aurora killed (`.site-bg-mesh` display:none), sharp radii (`--s-r` 6 / 10 / 14). The serif display stays on the hero headline (brand identity). Site brand color follows the chosen app color style via the injector (`--s-primary`).
