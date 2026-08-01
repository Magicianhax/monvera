"use client";

// Whether the desktop shell layout is active (viewport ≥ 1024px). Drives the
// persistent SideNav and the desktop affordances that hang off it (centered-modal
// bottom sheets, chart hover-scrub, toast placement). SSR-safe: false on the
// server and first client paint, then reconciled from a matchMedia listener.
import { useEffect, useState } from "react";

const QUERY = "(min-width: 1024px)";

export function useDesktopLayout(): { active: boolean } {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const update = () => setActive(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return { active };
}
