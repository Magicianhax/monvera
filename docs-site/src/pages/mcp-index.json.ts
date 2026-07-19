import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

// The corpus behind /mcp, emitted as a static asset at build time.
//
// The Worker fetches this once per isolate and answers search/get from it, so
// the MCP endpoint needs no database, no bundled content, and no rebuild
// coupling — it always serves whatever the last deploy published.

const SITE = 'https://docs.monvera.best';

/** MDX source → plain-ish markdown an agent can read. */
function toText(body: string): string {
  return (
    body
      // frontmatter is already parsed out by the loader, but be defensive
      .replace(/^---\n[\s\S]*?\n---\n/, '')
      // import lines for MDX components
      .replace(/^import\s+.*?from\s+['"].*?['"];?\s*$/gm, '')
      // JSX/Astro component tags, keeping their inner text
      .replace(/<\/?[A-Z][\w.]*(\s[^>]*)?\/?>/g, '')
      .replace(/<\/?[a-z][\w-]*(\s[^>]*)?\/?>/g, '')
      // MDX expression braces that carry no prose
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

export const prerender = true;

export const GET: APIRoute = async () => {
  const docs = await getCollection('docs');
  const pages = docs
    .filter((e) => e.id !== 'index')
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((e) => ({
      id: e.id,
      url: `${SITE}/${e.id}/`,
      title: e.data.title,
      description: e.data.description ?? '',
      // a section landing page ("use") sits in its own section, not 'reference'
      section: ['start', 'use', 'safety', 'how', 'dev'].includes(e.id.split('/')[0])
        ? e.id.split('/')[0]
        : 'reference',
      text: toText(e.body ?? ''),
    }));

  return new Response(JSON.stringify({ generated: true, count: pages.length, pages }), {
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
};
