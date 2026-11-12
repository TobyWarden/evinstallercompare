// Builds the XML sitemaps. Only indexable pages go in: noindex towns/counties and the claim form are left out.
import { config, getDirectory } from './data';

export interface SitemapEntry {
  path: string;
  lastmod?: string | null;
}

const abs = (p: string) => new URL(p, config.site.url).href;
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const latest = (dates: (string | null | undefined)[]) => dates.filter(Boolean).sort().at(-1) ?? null;

export const SITEMAPS = ['pages', 'locations', 'installers'] as const;
export type SitemapName = (typeof SITEMAPS)[number];
export const sitemapPath = (name: SitemapName) => `/sitemap-${name}.xml`;

export function entries(name: SitemapName): SitemapEntry[] {
  const d = getDirectory();
  switch (name) {
    case 'pages':
      return [
        { path: '/', lastmod: d.lastChecked },
        { path: '/quote/' },
      ];
    case 'locations':
      return [
        ...d.counties.filter((c) => c.indexable).map((c) => ({ path: c.url, lastmod: latest(c.installers.map((i) => i.retrieved_at)) })),
        ...d.towns.filter((t) => t.indexable).map((t) => ({ path: t.url, lastmod: latest(t.installers.map((i) => i.retrieved_at)) })),
      ];
    case 'installers':
      return d.installers.map((i) => ({ path: i.url, lastmod: latest(i.sources.map((s) => s.retrieved_at)) }));
  }
}

const xml = (body: string) =>
  new Response(`<?xml version="1.0" encoding="UTF-8"?>\n${body}\n`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });

export function urlset(name: SitemapName) {
  const urls = entries(name)
    .map((e) => `  <url><loc>${esc(abs(e.path))}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}</url>`)
    .join('\n');
  return xml(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`);
}

export function sitemapIndex() {
  const maps = SITEMAPS.map((n) => {
    const lastmod = latest(entries(n).map((e) => e.lastmod));
    return `  <sitemap><loc>${esc(abs(sitemapPath(n)))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</sitemap>`;
  }).join('\n');
  return xml(`<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${maps}\n</sitemapindex>`);
}
