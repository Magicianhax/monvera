"use client";

// First-time, mobile-only "Install this app" prompt for the Monvera PWA.
// Android/Chrome: captures beforeinstallprompt and drives a custom Install button.
// iOS Safari: shows manual Share -> Add to Home Screen instructions (no BIP event).
// Renders only on phones, only on the real /app shell, only when not already
// installed, and effectively once (30-day snooze on dismiss).
import { useCallback, useEffect, useRef, useState } from "react";
import { haptic } from "@/lib/haptics";

const SEEN_KEY = "monvera:pwa-install"; // "installed" | "dismissed"
const SNOOZE_KEY = "monvera:pwa-snooze"; // epoch ms; re-show allowed after this
const SNOOZE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const APPEAR_DELAY_MS = 2600; // let the app settle before nudging

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  prompt: () => Promise<void>;
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mm = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const androidApp = document.referrer.startsWith("android-app://");
  return mm || iosStandalone || androidApp;
}

function isPhone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const uaPhone = /iPhone|iPod|Android.*Mobile|Windows Phone/i.test(ua);
  const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touch = (navigator.maxTouchPoints ?? 0) > 0;
  const narrow = Math.min(window.innerWidth, window.innerHeight) <= 820;
  return uaPhone || (coarse && touch && narrow);
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iDevice = /iPhone|iPod/i.test(ua);
  const iPadOS = navigator.platform === "MacIntel" && (navigator.maxTouchPoints ?? 0) > 1;
  const ios = iDevice || iPadOS;
  const realSafari = /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA|FBAN|FBAV|Instagram|Line/i.test(ua);
  return ios && realSafari;
}

function alreadyHandled(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY) || localStorage.getItem("stax:pwa-install")) return true;
    const snooze = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return Number.isFinite(snooze) && snooze > Date.now();
  } catch {
    return false;
  }
}

function persist(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — best effort */
  }
}

function ShareGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0, color: "var(--primary)" }}>
      <path d="M12 3v11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M8.5 6.5 12 3l3.5 3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M6 11.5H5.2A1.2 1.2 0 0 0 4 12.7v6.1A1.2 1.2 0 0 0 5.2 20h13.6a1.2 1.2 0 0 0 1.2-1.2v-6.1a1.2 1.2 0 0 0-1.2-1.2H18"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function InstallPrompt() {
  const [mode, setMode] = useState<"android" | "ios" | null>(null);
  const [show, setShow] = useState(false);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Only in the real product shell — never the marketing site or the demo.
    if (!window.location.pathname.startsWith("/app")) return;
    if (isStandalone() || !isPhone() || alreadyHandled()) return;

    let appearTimer: ReturnType<typeof setTimeout> | null = null;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault(); // suppress Chrome's mini-infobar; we drive our own UI
      deferred.current = e as BeforeInstallPromptEvent;
      setMode("android");
      setShow(true);
    };

    const onInstalled = () => {
      persist(SEEN_KEY, "installed");
      setShow(false);
      deferred.current = null;
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);

    // iOS never fires beforeinstallprompt → show manual instructions after a beat.
    if (isIosSafari()) {
      appearTimer = setTimeout(() => {
        if (!isStandalone() && !alreadyHandled()) {
          setMode("ios");
          setShow(true);
        }
      }, APPEAR_DELAY_MS);
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      if (appearTimer) clearTimeout(appearTimer);
    };
  }, []);

  const dismiss = useCallback(() => {
    haptic.select();
    persist(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    setShow(false);
  }, []);

  const install = useCallback(async () => {
    const ev = deferred.current;
    if (!ev) return;
    haptic.medium();
    try {
      await ev.prompt();
      const { outcome } = await ev.userChoice;
      if (outcome === "accepted") persist(SEEN_KEY, "installed");
      else persist(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } catch {
      persist(SNOOZE_KEY, String(Date.now() + SNOOZE_MS));
    } finally {
      deferred.current = null; // a BIP event can only be used once
      setShow(false);
    }
  }, []);

  if (!show || !mode) return null;

  return (
    <div
      role="dialog"
      aria-label="Install Monvera"
      className="anim-rise"
      style={{
        position: "absolute",
        left: 14,
        right: 14,
        bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)", // clear the floating TabBar
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: "var(--rr, 18px)",
        background: "var(--glass)",
        backdropFilter: "var(--glass-blur)",
        WebkitBackdropFilter: "var(--glass-blur)",
        border: "1px solid var(--glass-stroke)",
        boxShadow: "var(--glass-hi), var(--glass-shadow)",
        color: "var(--ink)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/icon-192.png"
        alt=""
        width={40}
        height={40}
        style={{ borderRadius: 11, flexShrink: 0, boxShadow: "inset 0 0 0 1px var(--glass-stroke)" }}
      />

      <div style={{ minWidth: 0, flex: 1, lineHeight: 1.3 }}>
        <div style={{ fontWeight: 700, fontSize: 14.5 }}>Install Monvera</div>
        {mode === "android" ? (
          <div style={{ fontSize: 12.5, color: "var(--ink-2)" }}>Add to your home screen for a faster, full-screen app.</div>
        ) : (
          <div style={{ fontSize: 12.5, color: "var(--ink-2)", display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
            Tap <ShareGlyph /> then <strong style={{ color: "var(--ink)" }}>Add to Home Screen</strong>.
          </div>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {mode === "android" && (
          <button type="button" className="btn tap" onClick={install} style={{ padding: "9px 16px", fontSize: 13.5 }}>
            Install
          </button>
        )}
        <button
          type="button"
          aria-label="Dismiss"
          className="tap"
          onClick={dismiss}
          style={{
            width: 32,
            height: 32,
            display: "grid",
            placeItems: "center",
            borderRadius: 99,
            border: "1px solid var(--glass-stroke)",
            background: "var(--glass-2)",
            color: "var(--ink-2)",
            cursor: "pointer",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
