"use client";

import { useState } from "react";
import s from "./brand.module.css";

// Copies the actual image to the clipboard (clipboard only accepts PNG, so
// webp/svg get rasterized through an offscreen canvas first). Falls back to
// copying the URL when the browser refuses.
async function toPngBlob(url: string): Promise<Blob> {
  const res = await fetch(url);
  const blob = await res.blob();
  if (blob.type === "image/png") return blob;
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || 1024;
    canvas.height = img.naturalHeight || 1024;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas context");
    ctx.drawImage(img, 0, 0);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) throw new Error("canvas toBlob failed");
    return png;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function CopyButton({ url }: { url: string }) {
  const [label, setLabel] = useState("Copy image");
  return (
    <button
      type="button"
      className={s.copyBtn}
      onClick={async () => {
        try {
          const png = await toPngBlob(url);
          await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
          setLabel("Copied");
        } catch {
          try {
            await navigator.clipboard.writeText(url);
            setLabel("URL copied");
          } catch {
            setLabel("Use Open");
          }
        }
        setTimeout(() => setLabel("Copy image"), 1500);
      }}
    >
      {label}
    </button>
  );
}
