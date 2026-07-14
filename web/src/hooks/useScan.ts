"use client";

// useScan — Scan to Buy's client side: turn a product photo into Vera's
// listed-company connections. Two jobs: (1) downscale the picked image in the
// browser so the request to /api/scan stays ~100-300KB (Virtuals rejects tiny
// images and chokes on huge ones), (2) POST it authed and surface the validated
// result through a small phase machine the ScanScreen drives its UI off of.
// No execution here — the screen hands the result to the existing invest flow.
import { useCallback, useState } from "react";
import { authHeader } from "@/lib/authedFetch";

/** One real, explainable link from the photographed brand to a listed symbol. */
export interface ScanConnection {
  symbol: string;
  name: string;
  connectionType: "maker" | "parent" | "supplier" | "component" | "retailer" | "competitor";
  reasoning: string;
  weight: number;
}

/** What /api/scan returns: what Vera saw + how it maps to the tradable universe. */
export interface ScanResult {
  recognized: {
    product: string;
    brand: string;
    /** 1-2 plain sentences: what the product is and who makes it. */
    about?: string;
    /** The actual making company (brand owner/parent), listed or not. */
    makerName?: string | null;
  } | null;
  connections: ScanConnection[];
}

type Phase = "idle" | "reading" | "analyzing" | "done" | "error";

const MAX_EDGE = 1024; // longest side, px

/**
 * Downscale a picked image to a JPEG data URL whose longest side is <= 1024px.
 * Prefers createImageBitmap (fast, off-thread); falls back to an HTMLImageElement
 * loaded from an object URL where that isn't available.
 */
export async function downscale(file: File): Promise<string> {
  const { width, height, draw } = await loadDrawable(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't read that image. Try another photo.");
  draw(ctx, w, h);

  return canvas.toDataURL("image/jpeg", 0.85);
}

interface Drawable {
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

async function loadDrawable(file: File): Promise<Drawable> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => {
          ctx.drawImage(bitmap, 0, 0, w, h);
          bitmap.close();
        },
      };
    } catch {
      // fall through to the HTMLImageElement path
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Couldn't read that image. Try another photo."));
      el.src = url;
    });
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function useScan() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const reset = useCallback(() => {
    setPhase("idle");
    setError(null);
    setResult(null);
  }, []);

  const scan = useCallback(async (file: File) => {
    setError(null);
    setResult(null);
    try {
      setPhase("reading");
      const image = await downscale(file);

      setPhase("analyzing");
      const res = await fetch("/api/scan", {
        method: "POST",
        headers: { "content-type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ image }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          typeof json?.error === "string" ? json.error : "Vera couldn't read that one. Try another photo.",
        );
      }

      setResult(json as ScanResult);
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vera couldn't read that one. Try another photo.");
      setPhase("error");
    }
  }, []);

  return { phase, error, result, scan, reset };
}
