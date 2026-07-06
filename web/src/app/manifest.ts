import type { MetadataRoute } from "next";

// Native Next 16 web app manifest. Served at /manifest.webmanifest and linked
// automatically via the metadata system (see layout.tsx -> metadata.manifest).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Monvera · AI broker for tokenized stocks",
    short_name: "Monvera",
    description:
      "Own tokenized stocks on Robinhood Chain with Vera, your AI broker. Email login, no seed phrase, gasless.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#15191a",
    theme_color: "#15191a",
    categories: ["finance", "investing"],
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
