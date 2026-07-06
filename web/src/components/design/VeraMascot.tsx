"use client";

// Vera the mascot — the friendly green leaf-sprite that fronts the landing hero,
// here as the app's warm face (her own screen, her "thinking" state, empty states).
// Portrait art (2:3); `size` is the rendered HEIGHT, width follows.
import type { CSSProperties } from "react";

export function VeraMascot({
  size = 120,
  className,
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static local webp, no loader needed
    <img
      src="/brand/vera-mascot.webp"
      alt="Vera"
      width={Math.round(size * (2 / 3))}
      height={size}
      decoding="async"
      className={className}
      style={{
        height: size,
        width: "auto",
        display: "block",
        filter: "drop-shadow(0 12px 20px rgba(40, 60, 40, 0.18))",
        ...style,
      }}
    />
  );
}
