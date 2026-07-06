"use client";

// Injects the chosen color style's brand-token overrides as a global <style>.
// Because the palette lives in committed data (lib/colorStyles) and is emitted on
// the server too, the brand color ships regardless of globals.css (which is
// edit-local-only) and is present from first paint (no flash).
import { colorStyleCss, ROUND_THEME_CSS, SOFT_THEME_CSS } from "@/lib/colorStyles";
import { useColorStyle } from "@/hooks/useColorStyle";

export function ColorStyleTag() {
  const { colorStyle } = useColorStyle();
  return (
    <style
      id="monvera-color"
      dangerouslySetInnerHTML={{ __html: colorStyleCss(colorStyle) + ROUND_THEME_CSS + SOFT_THEME_CSS }}
    />
  );
}
