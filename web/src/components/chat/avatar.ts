"use client";

// The user's chat avatar — a device preference (localStorage, same policy as
// theme), never synced or uploaded anywhere. Three shapes:
//   default  — a quiet gradient disc (distinct from Vera's orb)
//   preset   — one of a small set of gradient discs
//   upload   — the user's own image, resized client-side to a tiny data URL
import { useSyncExternalStore } from "react";

export interface UserAvatar {
  kind: "default" | "preset" | "upload";
  /** preset: the preset id; upload: a data: URL. */
  value?: string;
}

const KEY = "mv.avatar";

// Small, tasteful gradient presets (id -> css gradient).
export const AVATAR_PRESETS: { id: string; css: string }[] = [
  { id: "moss", css: "linear-gradient(135deg,#2e7d5b,#124430)" },
  { id: "dusk", css: "linear-gradient(135deg,#5b6bd6,#2a2f6e)" },
  { id: "ember", css: "linear-gradient(135deg,#d67b4a,#7a3018)" },
  { id: "rose", css: "linear-gradient(135deg,#d65b8a,#6e2a48)" },
  { id: "sand", css: "linear-gradient(135deg,#cbb26a,#6e5a1f)" },
  { id: "slate", css: "linear-gradient(135deg,#8a99a8,#3a4049)" },
];

const DEFAULT_CSS = "linear-gradient(135deg,#9ad6b9,#3a7d5f)";

let cache: UserAvatar = { kind: "default" };
const subs = new Set<() => void>();

function read(): UserAvatar {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { kind: "default" };
    const p = JSON.parse(raw) as UserAvatar;
    if (p.kind === "preset" && AVATAR_PRESETS.some((x) => x.id === p.value)) return p;
    if (p.kind === "upload" && typeof p.value === "string" && p.value.startsWith("data:image/")) return p;
    return { kind: "default" };
  } catch {
    return { kind: "default" };
  }
}

export function setAvatar(a: UserAvatar): void {
  cache = a;
  try {
    if (a.kind === "default") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(a));
  } catch { /* storage full/blocked — in-memory still applies this session */ }
  subs.forEach((f) => f());
}

export function useAvatar(): UserAvatar {
  return useSyncExternalStore(
    (cb) => {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    () => cache,
    () => cache,
  );
}

// Hydrate once on the client (module scope runs before first render there).
if (typeof window !== "undefined") cache = read();

/** css background for a non-upload avatar (default or preset). */
export function avatarCss(a: UserAvatar): string {
  if (a.kind === "preset") return AVATAR_PRESETS.find((x) => x.id === a.value)?.css ?? DEFAULT_CSS;
  return DEFAULT_CSS;
}

/** Resize a picked image file to a small square data URL (~96px). */
export async function fileToAvatar(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const el = new Image();
      el.onload = () => res(el);
      el.onerror = rej;
      el.src = url;
    });
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    // cover-crop to square
    const s = Math.min(img.width, img.height);
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
