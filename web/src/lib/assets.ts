// Media assets are hosted directly on Cloudflare R2 (bucket: monvera-assets),
// not bundled with the app. NEXT_PUBLIC_ASSETS_BASE overrides the base when the
// bucket moves behind a custom domain; paths keep the same shape either way.
export const ASSETS_BASE =
  process.env.NEXT_PUBLIC_ASSETS_BASE || "https://assets.monvera.best";

/** Absolute URL for a media asset key like "/brand/vera.png". */
export const asset = (path: string): string => `${ASSETS_BASE}${path}`;
