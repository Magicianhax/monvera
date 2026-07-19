/**
 * The six top-level sections, shared by the header strip and the sidebar so
 * they can never disagree about which one you are in.
 *
 * `label` must match the sidebar group label in astro.config.mjs exactly — the
 * sidebar is filtered by it.
 */
export interface Category {
  label: string;
  href: string;
  /** URL prefix that puts a page in this category. */
  match: string;
}

export const CATEGORIES: Category[] = [
  { label: 'Start', href: '/start/', match: '/start/' },
  { label: 'Guide', href: '/use/', match: '/use/' },
  { label: 'Safety', href: '/safety/', match: '/safety/' },
  { label: 'How it works', href: '/how/', match: '/how/' },
  { label: 'Developers', href: '/dev/', match: '/dev/' },
  { label: 'API', href: '/dev/api/', match: '/dev/api/' },
];

/**
 * The category a path belongs to. Longest match wins so /dev/api/* resolves to
 * API rather than Developers.
 */
export function categoryFor(pathname: string): Category | undefined {
  return [...CATEGORIES]
    .sort((a, b) => b.match.length - a.match.length)
    .find((c) => pathname.startsWith(c.match));
}
