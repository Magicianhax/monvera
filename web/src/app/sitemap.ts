import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

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
      url: `${SITE_URL}/app`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    },
  ];
}
