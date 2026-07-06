// Monvera design system — shared, presentational components for the Soft theme.
// Import surface for the screen/feature layers.

// Icons + brand
export { Icon, type IconName, type IconProps } from "./Icon";
export {
  MonveraIcon,
  MonveraMark,
  MonveraTile,
  MonveraWordmark,
  VeraOrb,
  AssetTile,
  type MonveraIconProps,
  type MonveraMarkProps,
  type MonveraTileProps,
  type MonveraWordmarkProps,
  type VeraOrbProps,
  type AssetTileProps,
  type TileAsset,
} from "./Brand";

// Charts / data-viz
export {
  Sparkline,
  PriceChart,
  RiskMeter,
  Donut,
  CountUp,
  type SparklineProps,
  type PriceChartProps,
  type RiskMeterProps,
  type DonutProps,
  type DonutSegment,
  type CountUpProps,
} from "./Charts";

// Surfaces / layout primitives
export {
  BottomSheet,
  Crossfade,
  HoldingRow,
  Eyebrow,
  VerifiedBadge,
  Seal,
  Stat,
  SectionTitle,
  Confetti,
  type BottomSheetProps,
  type CrossfadeProps,
  type HoldingRowProps,
  type EyebrowProps,
  type VerifiedBadgeProps,
  type StatProps,
  type SectionTitleProps,
  type ConfettiProps,
} from "./Surfaces";

// Motion primitives
export { useDragDismiss } from "../../hooks/useDragDismiss";
export type {
  UseDragDismissOptions,
  UseDragDismissResult,
} from "../../hooks/useDragDismiss";

// Navigation
export { TabBar, type TabBarProps, type TabId } from "./TabBar";

// Toast
export {
  Toast,
  ToastProvider,
  useToast,
  type ToastData,
} from "./Toast";

// Device frame
export {
  IOSFrame,
  IOSStatusBar,
  type IOSFrameProps,
  type IOSStatusBarProps,
} from "./IOSFrame";
