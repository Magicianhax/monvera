// Per-page social cards. Starlight sets `twitter:card: summary_large_image`
// but ships no `og:image`, so X reserved a large card and rendered a broken
// placeholder. Every docs page now gets an image carrying its own title.
//
// Keys match the page path: `dev/verify-vera` -> /og/dev/verify-vera.png, and
// the home page is `index`. src/components/DocsHead.astro derives the same key
// from the pathname, so the two can never drift.
//
// Note: OGImageRoute is async in astro-og-canvas v0.13 and derives the route
// param from the filename itself, so it takes no `param` option.

import { OGImageRoute } from "astro-og-canvas";
import { getCollection } from "astro:content";

const entries = await getCollection("docs");

const pages = Object.fromEntries(
  entries.map((entry) => {
    const key = entry.id.replace(/\.(md|mdx)$/, "") || "index";
    return [key, entry];
  }),
);

export const { getStaticPaths, GET } = await OGImageRoute({
  pages,
  getImageOptions: (_path, page) => ({
    title: page.data.title,
    description: page.data.description ?? "Monvera documentation",
    logo: { path: "./public/favicon.png", size: [72] },
    // Brand green, deepened so white type clears contrast comfortably.
    bgGradient: [
      [15, 26, 20],
      [26, 47, 36],
    ],
    padding: 68,
    font: {
      title: {
        size: 62,
        weight: "Bold",
        color: [255, 255, 255],
        lineHeight: 1.16,
      },
      description: {
        size: 27,
        color: [173, 191, 178],
        lineHeight: 1.45,
      },
    },
  }),
});
