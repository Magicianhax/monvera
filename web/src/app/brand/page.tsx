import type { Metadata } from "next";
import { SiteDocShell } from "@/components/site/SiteDocShell";
import { CopyButton } from "./CopyButton";
import s from "./brand.module.css";

export const metadata: Metadata = {
  title: "Brand assets",
  description:
    "Monvera's public brand kit: logos, Vera the mascot, city art, colors, and fonts. Free to use for community content.",
  alternates: { canonical: "/brand" },
  openGraph: {
    title: "Monvera · Brand assets",
    description: "Logos, Vera the mascot, city art, colors, and fonts. Free to use for community content.",
    url: "/brand",
  },
};

// Public, world-readable. Everything is served from the assets CDN.
export const revalidate = 86400;

const CDN = "https://assets.monvera.best";

interface Asset {
  file: string;
  name: string;
  dark?: boolean;
  cover?: boolean;
}

const LOGOS: Asset[] = [
  { file: "/brand/monvera-icon.png", name: "App icon" },
  { file: "/brand/monvera-icon-white.png", name: "White mark (PNG)", dark: true },
  { file: "/brand/monvera-mark-white.svg", name: "White mark (SVG)", dark: true },
  { file: "/brand/monvera-logo.png", name: "Full logo", dark: true },
  { file: "/brand/monvera-wordmark.png", name: "Icon + wordmark" },
];

const MASCOTS: Asset[] = [
  { file: "/brand/vera-mascot.webp", name: "Vera" },
  { file: "/brand/hero/vera-00-default.webp", name: "Vera · default" },
  { file: "/brand/hero/vera-01-tokyo.webp", name: "Vera · Tokyo" },
  { file: "/brand/hero/vera-02-tajmahal.webp", name: "Vera · Taj Mahal" },
  { file: "/brand/hero/vera-03-dubai.webp", name: "Vera · Dubai" },
  { file: "/brand/hero/vera-04-istanbul.webp", name: "Vera · Istanbul" },
  { file: "/brand/hero/vera-05-singapore.webp", name: "Vera · Singapore" },
  { file: "/brand/hero/vera-06-rio.webp", name: "Vera · Rio" },
  { file: "/brand/hero/vera-07-capetown.webp", name: "Vera · Cape Town" },
  { file: "/brand/hero/vera-08-cairo.webp", name: "Vera · Cairo" },
];

const HEROES: Asset[] = Array.from({ length: 8 }, (_, i) => {
  const cities = ["tokyo", "tajmahal", "dubai", "istanbul", "singapore", "rio", "capetown", "cairo"];
  const names = ["Tokyo", "Taj Mahal", "Dubai", "Istanbul", "Singapore", "Rio", "Cape Town", "Cairo"];
  return {
    file: `/brand/hero/hero-0${i + 1}-${cities[i]}.webp`,
    name: names[i],
    cover: true,
  };
});

const COLORS = [
  { name: "Forest", hex: "#0b110d", use: "dark canvas" },
  { name: "Sage", hex: "#57a07e", use: "primary" },
  { name: "Sage deep", hex: "#3f8765", use: "accents" },
  { name: "Mint", hex: "#7fd4ab", use: "dark-mode highlight" },
  { name: "Paper", hex: "#eef1e8", use: "light canvas" },
  { name: "Ink", hex: "#232a24", use: "text on light" },
];

function AssetCard({ a }: { a: Asset }) {
  const url = `${CDN}${a.file}`;
  return (
    <div className={s.card}>
      <div className={`${s.preview} ${a.dark ? s.dark : ""} ${a.cover ? s.cover : ""}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- CDN asset, no loader needed */}
        <img src={url} alt={a.name} loading="lazy" />
      </div>
      <div className={s.meta}>
        <div className={s.name}>{a.name}</div>
        <div className={s.actions}>
          <a className={s.openLink} href={url} target="_blank" rel="noreferrer">
            Open
          </a>
          <CopyButton url={url} />
        </div>
      </div>
    </div>
  );
}

export default function BrandPage() {
  return (
    <SiteDocShell
      wide
      eyebrow="Brand assets"
      title="Everything you need to talk about Monvera"
      lead={
        <>
          Logos, Vera the mascot, city art, colors, and fonts, all hosted and free to use for community
          content, posts, and memes. Tap Copy image and paste it straight into whatever you are making,
          or Open to save the file.
        </>
      }
    >
      <h2 className={s.sectionTitle}>Logos</h2>
      <p className={s.sectionSub}>Use the white marks on dark backgrounds. Please do not stretch, recolor, or add effects to the marks.</p>
      <div className={s.grid}>
        {LOGOS.map((a) => (
          <AssetCard key={a.file} a={a} />
        ))}
      </div>

      <h2 className={s.sectionTitle}>Vera</h2>
      <p className={s.sectionSub}>The mascot, at home and around the world. Meme freely, she does not mind.</p>
      <div className={s.grid}>
        {MASCOTS.map((a) => (
          <AssetCard key={a.file} a={a} />
        ))}
      </div>

      <h2 className={s.sectionTitle}>City backdrops</h2>
      <p className={s.sectionSub}>The landing-page art behind Vera, full size.</p>
      <div className={s.grid}>
        {HEROES.map((a) => (
          <AssetCard key={a.file} a={a} />
        ))}
      </div>

      <h2 className={s.sectionTitle}>Colors</h2>
      <div className={s.colors}>
        {COLORS.map((c) => (
          <div key={c.hex} className={s.swatch}>
            <div className={s.swatchColor} style={{ background: c.hex }} />
            <div className={s.swatchMeta}>
              <b>{c.name}</b>
              <code>
                {c.hex} · {c.use}
              </code>
            </div>
          </div>
        ))}
      </div>

      <h2 className={s.sectionTitle}>Fonts</h2>
      <p className={s.sectionSub}>
        Display: Fraunces (500 to 600). UI and body: Hanken Grotesk. Data and hashes: JetBrains Mono. All on
        Google Fonts.
      </p>

      <p className={s.note}>
        These assets are provided for content about Monvera. Do not use them to impersonate the project, and
        never present anything made with them as an official announcement. Official news comes only from
        monvera.best, our X, and our Telegram.
      </p>
    </SiteDocShell>
  );
}
