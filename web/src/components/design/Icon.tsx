// Monvera icon set — backed by the Phosphor icon pack (@phosphor-icons/react).
// The public API (name union + {name,size,stroke,style,className} props) is
// preserved so every call site keeps working via the same import.
//
// Default weight is "duotone" for a soft, friendly two-tone look (the icon's
// color for the line + a 20% tint fill) that gives the app its playful feel.
// The old `stroke` prop maps to weight for back-compat: a thick stroke (>= 2.4)
// renders "bold", everything else "duotone". Pass `weight` to override directly.
import type { CSSProperties } from "react";
import {
  House,
  Sparkle,
  SquaresFour,
  MagnifyingGlass,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  CaretRight,
  CaretLeft,
  CaretDown,
  Check,
  ShieldCheck,
  Shield,
  Planet,
  CreditCard,
  Bank,
  Envelope,
  Wallet,
  GearSix,
  Bell,
  LinkSimple,
  Info,
  X,
  ArrowLeft,
  PaperPlaneTilt,
  Lock,
  SlidersHorizontal,
  Receipt,
  Eye,
  Clock,
  TrendUp,
  Sun,
  Moon,
  Vibrate,
  Signature,
  Globe,
  Star,
  TrendDown,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

export type IconName =
  | "home"
  | "spark"
  | "grid"
  | "search"
  | "plus"
  | "arrowUR"
  | "arrowDR"
  | "chevR"
  | "chevL"
  | "chevD"
  | "check"
  | "shield"
  | "shieldPlain"
  | "orbit"
  | "card"
  | "bank"
  | "mail"
  | "wallet"
  | "settings"
  | "bell"
  | "link"
  | "info"
  | "close"
  | "back"
  | "send"
  | "lock"
  | "sliders"
  | "receipt"
  | "eye"
  | "clock"
  | "trend"
  | "sun"
  | "moon"
  | "vibrate"
  | "signature"
  | "globe"
  | "star"
  | "trendDown";

export type IconWeight = "thin" | "light" | "regular" | "bold" | "fill" | "duotone";

export interface IconProps {
  name: IconName;
  size?: number;
  /** Back-compat: a thick stroke (>= 2.4) renders the "bold" weight. */
  stroke?: number;
  /** Phosphor weight override (defaults to "duotone", or "bold" for thick strokes). */
  weight?: IconWeight;
  style?: CSSProperties;
  className?: string;
}

// name → Phosphor glyph. Chosen for semantic clarity + visual cohesion.
const MAP: Record<IconName, PhosphorIcon> = {
  home: House,
  spark: Sparkle,
  grid: SquaresFour,
  search: MagnifyingGlass,
  plus: Plus,
  arrowUR: ArrowUpRight,
  arrowDR: ArrowDownRight,
  chevR: CaretRight,
  chevL: CaretLeft,
  chevD: CaretDown,
  check: Check,
  shield: ShieldCheck,
  shieldPlain: Shield,
  orbit: Planet,
  card: CreditCard,
  bank: Bank,
  mail: Envelope,
  wallet: Wallet,
  settings: GearSix,
  bell: Bell,
  link: LinkSimple,
  info: Info,
  close: X,
  back: ArrowLeft,
  send: PaperPlaneTilt,
  lock: Lock,
  sliders: SlidersHorizontal,
  receipt: Receipt,
  eye: Eye,
  clock: Clock,
  trend: TrendUp,
  sun: Sun,
  moon: Moon,
  vibrate: Vibrate,
  signature: Signature,
  globe: Globe,
  star: Star,
  trendDown: TrendDown,
};

// Line glyphs whose Phosphor "duotone" secondary is a faint rounded-square
// CONTAINER box (not the icon's own shape) — it reads as an ugly border around
// the icon. Render these as clean "bold" strokes instead.
const NO_DUOTONE = new Set<IconName>(["close", "plus", "check"]);

export function Icon({ name, size = 22, stroke, weight, style, className }: IconProps) {
  const Glyph = MAP[name];
  const w: IconWeight =
    weight ??
    (stroke !== undefined && stroke >= 2.4
      ? "bold"
      : NO_DUOTONE.has(name)
        ? "bold"
        : "duotone");
  return (
    <Glyph
      size={size}
      weight={w}
      className={className}
      // currentColor is Phosphor's default; keep block display for crisp alignment.
      style={{ display: "block", ...style }}
      aria-hidden
    />
  );
}
