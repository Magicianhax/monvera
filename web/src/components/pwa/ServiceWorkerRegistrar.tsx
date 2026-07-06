"use client";

import { useEffect } from "react";

// Registers /sw.js in production only. Renders null; mount once in Providers.
// Dev is intentionally skipped so Turbopack HMR never fights a precaching SW
// (the "stale CSS / stale asset" failure mode).
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let reg: ServiceWorkerRegistration | undefined;

    const register = async () => {
      try {
        reg = await navigator.serviceWorker.register("/sw.js", {
          scope: "/",
          updateViaCache: "none", // always re-fetch the worker file
        });
      } catch (err) {
        console.error("SW registration failed:", err);
      }
    };

    // Pick up a new worker whenever the app regains focus (a PWA can stay open
    // for days; this pulls updated cache versions without a hard reload).
    const onVisible = () => {
      if (document.visibilityState === "visible") reg?.update();
    };

    void register();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  return null;
}
