import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";
import { THEME_DEFS } from "@/lib/server/themes";

// Served at /sitemap.xml. Only public, indexable routes belong here — the API
// routes and /offline fallback are excluded (see robots.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${SITE_URL}/demo`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/strategies`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/themes`,
      lastModified,
      changeFrequency: "daily",
      priority: 0.8,
    },
    ...THEME_DEFS.map((d) => ({
      url: `${SITE_URL}/themes/${d.slug}`,
      lastModified,
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    {
      url: `${SITE_URL}/roadmap`,
      lastModified,
      changeFrequency: "weekly",
      priority: 0.6,
    },
    {
      url: `${SITE_URL}/brand`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/app`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
