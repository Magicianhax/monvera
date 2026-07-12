"use client";

import { useState } from "react";
import s from "./brand.module.css";

export function CopyButton({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className={s.copyBtn}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard denied: the URL is visible via Open anyway */
        }
      }}
    >
      {copied ? "Copied" : "Copy URL"}
    </button>
  );
}
