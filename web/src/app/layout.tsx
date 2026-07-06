import type { Metadata, Viewport } from "next";
import { Geist, Hanken_Grotesk, Fraunces, JetBrains_Mono, Roboto_Flex } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  TWITTER_HANDLE,
} from "@/lib/seo";

// Monvera "Soft" theme fonts (see globals.css):
//   UI       → Hanken Grotesk  → --font-hanken     (clean humanist sans)
//   Display  → Fraunces        → --font-fraunces   (warm old-style serif, optical)
//   Mono     → JetBrains Mono  → --font-jetbrains  (data / addresses / receipts)
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

// Primary UI sans — clean, neutral, premium (the injector points --font-ui here).
// App UI typeface — Roboto (variable "Flex" cut so every weight 100-1000 exists;
// the app runs light, mostly 400-600). The marketing site keeps Geist.
const roboto = Roboto_Flex({
  variable: "--font-roboto",
  subsets: ["latin"],
  display: "swap",
});

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  display: "swap",
});

const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

const DEFAULT_TITLE = "Monvera · Invest with Vera";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  applicationName: SITE_NAME,
  title: {
    default: DEFAULT_TITLE,
    template: "%s · Monvera",
  },
  description: SITE_DESCRIPTION,
  keywords: [
    "tokenized stocks",
    "invest with AI",
    "AI broker",
    "buy stocks crypto",
    "Robinhood Chain",
    "no seed phrase wallet",
    "gasless investing",
    "fractional shares",
    "Vera",
    "Monvera",
  ],
  manifest: "/manifest.webmanifest",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: DEFAULT_TITLE,
    description: SITE_DESCRIPTION,
    site: TWITTER_HANDLE,
    creator: TWITTER_HANDLE,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: SITE_NAME,
  },
  formatDetection: { telephone: false },
  // Icons are served via Next file conventions (app/icon.png, app/apple-icon.png)
  // and the OG/Twitter cards via the static app/opengraph-image.png +
  // app/twitter-image.png (with .alt.txt) — no manual config needed.
};

export const viewport: Viewport = {
  // Soft "paper" — light by default, dark variant for dark mode.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef1e8" },
    { media: "(prefers-color-scheme: dark)", color: "#15191a" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Structured data (schema.org JSON-LD). One @graph with the publisher
// (Organization), the site (WebSite), and the product (the Monvera app as a
// WebApplication) — improves Google rich results and AI/LLM citability.
const JSON_LD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}/icon-512.png`,
      description: SITE_DESCRIPTION,
      sameAs: [`https://x.com/${TWITTER_HANDLE.replace("@", "")}`],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
    {
      "@type": "WebApplication",
      "@id": `${SITE_URL}/#app`,
      name: SITE_NAME,
      url: `${SITE_URL}/app`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web, iOS, Android",
      description: SITE_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "No account fees. Gasless trading on Robinhood Chain.",
      },
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${roboto.variable} ${hanken.variable} ${fraunces.variable} ${jetbrains.variable} h-full antialiased`}
    >
      <body className="min-h-full antialiased">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        <Providers>{children}</Providers>

      </body>
    </html>
  );
}
