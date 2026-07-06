import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// Served at /robots.txt. Allow crawling of the marketing site + demo, but keep
// crawlers out of API routes, the offline fallback, and any Next internals.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/offline"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
