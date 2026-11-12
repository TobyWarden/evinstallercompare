import { config } from '../lib/data';

export const GET = () =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${new URL('/sitemap-index.xml', config.site.url).href}\n`, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
