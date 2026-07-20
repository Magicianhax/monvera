// Single source of truth for SEO/canonical metadata.
import type { Metadata } from "next";

export const SITE_URL = "https://monvera.best";
export const SITE_NAME = "Monvera";

export const SITE_TAGLINE = "The AI broker for real tokenized stocks";
export const SITE_DESCRIPTION =
  "Monvera is the AI stockbroker on Robinhood Chain. Tell Vera what you want in plain words and buy tokenized stocks of real companies — email login, no seed phrase, gasless, non-custodial.";

// NOTE: secure this handle before launch (placeholder for the Monvera brand).
export const TWITTER_HANDLE = "@monvera_best";

// Support / contact inbox — surfaced in-app (Help) and on the marketing site.
export const SUPPORT_EMAIL = "support@monvera.best";

// OG/Twitter share image dimensions (Open Graph standard).
export const OG_SIZE = { width: 1200, height: 630 } as const;

/** Per-page metadata with everything the root layout can't inherit down.
 *  A page that defines its own `openGraph` silently loses the root og:image
 *  and twitter card — this builds the full set so link previews always carry
 *  the brand image and the PAGE's title/description, not the homepage's. */
export function pageMeta(opts: { title: string; description: string; path: string }): Metadata {
  const { title, description, path } = opts;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: `${title} · ${SITE_NAME}`,
      description,
      url: path,
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: ["/opengraph-image.png"],
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} · ${SITE_NAME}`,
      description,
      site: TWITTER_HANDLE,
      images: ["/twitter-image.png"],
    },
  };
}
