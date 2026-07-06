"use client";

// A star toggle for the watchlist. Renders as a span (not a button) so it can
// sit inside a row-button without nesting; stops propagation so tapping the star
// never navigates.
import { Icon } from "@/components/design";
import { useIsWatched, toggleWatch } from "@/lib/watchlist";
import { haptic } from "@/lib/haptics";

export function WatchStar({ symbol, size = 20 }: { symbol: string; size?: number }) {
  const on = useIsWatched(symbol);
  const act = (e: { stopPropagation: () => void; preventDefault?: () => void }) => {
    e.stopPropagation();
    e.preventDefault?.();
    haptic.select();
    toggleWatch(symbol);
  };
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={on ? "Remove from watchlist" : "Add to watchlist"}
      aria-pressed={on}
      onClick={act}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") act(e);
      }}
      style={{
        display: "grid",
        placeItems: "center",
        width: 38,
        height: 38,
        flex: "none",
        cursor: "pointer",
        color: on ? "var(--accent)" : "var(--ink-3)",
        transition: "color .18s var(--ease-out)",
      }}
    >
      <Icon name="star" size={size} weight={on ? "fill" : "regular"} />
    </span>
  );
}
