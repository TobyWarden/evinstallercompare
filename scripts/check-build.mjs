// Post-build guard. Fails the build if:
//   - any page is over the size budget (config.build.maxPageKb)
//   - any page or client file leaks private installer data
//   - a live build contains test fixture data (or was built with DATA_DIR)
//   - any internal link, anchor or postcode-search target is broken
//   - the sitemaps / robots.txt are missing, list a noindex or missing page, or miss an indexable page
//
// Usage: node scripts/check-build.mjs                 (live build in dist/)
//        node scripts/check-build.mjs --fixtures      (test build: DATA_DIR + config.tests.outDir)
//        --dist <dir> checks another output folder (used by test-build to prove fixtures are caught)
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const testMode = process.argv.includes('--fixtures');
const distArg = process.argv.indexOf('--dist');
const dist = path.join(root, distArg !== -1 ? process.argv[distArg + 1] : testMode ? config.tests.outDir : 'dist');
const maxBytes = config.build.maxPageKb * 1024;
const marker = config.tests.fixtureSourceMarker;
const errors = [];

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const readCsv = (f) => (fs.existsSync(f) ? parse(fs.readFileSync(f, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true }) : []);
const files = walk(dist).filter((f) => !f.includes(`${path.sep}.prerender${path.sep}`));
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const textFiles = files.filter((f) => /\.(html|js|json|txt|xml|css)$/.test(f));
const text = new Map(textFiles.map((f) => [f, fs.readFileSync(f, 'utf8')]));
const rel = (f) => path.relative(dist, f).split(path.sep).join('/');

// ---------- 1. fixtures never reach the live site ----------
if (!testMode) {
  if (process.env.DATA_DIR) errors.push(`DATA_DIR is set (${process.env.DATA_DIR}). The live build must use /data; run "npm run test:build" for fixtures.`);
  // config.json defines the marker itself, so it's the one file allowed to contain it.
  const dataFiles = walk(path.join(root, 'data')).filter((f) => !f.includes(`${path.sep}raw${path.sep}`) && path.basename(f) !== 'config.json');
  for (const f of dataFiles) {
    if (fs.readFileSync(f, 'utf8').includes(marker)) errors.push(`data/${path.relative(path.join(root, 'data'), f)}: contains "${marker}" rows`);
  }
  const fixtureRows = readCsv(path.join(root, config.tests.fixturesDir, 'installers.csv'));
  const fixtureValues = [marker, ...fixtureRows.flatMap((r) => [r.company_name, r.slug && `/installers/${r.slug}/`])].filter((v) => v && v.length > 4);
  for (const [f, t] of text) {
    const hit = fixtureValues.find((v) => t.includes(v));
    if (hit) errors.push(`${rel(f)}: contains test fixture data ("${hit}")`);
  }
}

// ---------- 2. page weight and private data ----------
const dataDir = testMode ? path.resolve(process.env.DATA_DIR ?? config.tests.fixturesDir) : path.join(root, 'data');
const secrets = readCsv(path.join(dataDir, 'installers.csv'))
  .flatMap((r) => [r.phone, r.email, r.website, r.address, r.postcode, r.latitude, r.longitude])
  .filter((v) => v && v.length > 4);
for (const [f, t] of text) for (const s of secrets) if (t.includes(s)) errors.push(`${rel(f)}: contains private installer data`);
for (const html of htmlFiles) {
  const t = text.get(html);
  const refs = [...t.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)].map((m) => path.join(dist, m[1]));
  const assets = [...new Set(refs)].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile() && !f.endsWith('.html'));
  const total = fs.statSync(html).size + assets.reduce((n, f) => n + fs.statSync(f).size, 0);
  if (total > maxBytes) errors.push(`${rel(html)}: ${(total / 1024).toFixed(1)} KB exceeds ${config.build.maxPageKb} KB`);
}

// ---------- 3. broken links ----------
/** Resolve a site path ("/a/b/", "/x.json") to a built file, or null. */
function resolve(urlPath) {
  const p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  const candidates = p.endsWith('/') ? [path.join(dist, p, 'index.html')] : [path.join(dist, p), path.join(dist, p, 'index.html')];
  return candidates.find((c) => fs.existsSync(c) && fs.statSync(c).isFile()) ?? null;
}
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
let linksChecked = 0;
for (const html of htmlFiles) {
  const t = text.get(html);
  for (const m of t.matchAll(/\s(?:href|src|action)="([^"]*)"/g)) {
    const url = m[1].replace(/&amp;/g, '&');
    if (!url || /^(https?:|mailto:|tel:|data:|javascript:)/i.test(url) || url.startsWith('//')) continue;
    linksChecked++;
    if (url.startsWith('#')) {
      if (url.length > 1 && !ids(t).has(url.slice(1))) errors.push(`${rel(html)}: broken anchor ${url}`);
      continue;
    }
    if (!url.startsWith('/')) {
      errors.push(`${rel(html)}: relative link "${url}" (use a root-relative path)`);
      continue;
    }
    const target = resolve(url);
    if (!target) {
      errors.push(`${rel(html)}: broken link ${url}`);
      continue;
    }
    const hash = url.split('#')[1];
    if (hash && target.endsWith('.html') && !ids(text.get(target) ?? '').has(hash)) errors.push(`${rel(html)}: broken anchor ${url}`);
  }
}
const lookupFile = path.join(dist, 'postcode-lookup.json');
if (fs.existsSync(lookupFile)) {
  for (const u of JSON.parse(fs.readFileSync(lookupFile, 'utf8')).towns) {
    linksChecked++;
    if (!resolve(u)) errors.push(`postcode-lookup.json: points to missing page ${u}`);
  }
}

// ---------- 4. sitemaps and robots.txt ----------
const site = new URL(config.site.url);
const isNoindex = (html) => /<meta name="robots" content="[^"]*noindex/.test(html);
const sitemapPaths = new Set();
const robots = text.get(path.join(dist, 'robots.txt'));
if (!robots) errors.push('robots.txt is missing');
else if (!robots.includes(new URL('/sitemap-index.xml', site).href)) errors.push('robots.txt does not point to /sitemap-index.xml');
const index = text.get(path.join(dist, 'sitemap-index.xml'));
if (!index) errors.push('sitemap-index.xml is missing');
else {
  for (const [, loc] of index.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const u = new URL(loc);
    const file = path.join(dist, u.pathname);
    if (u.origin !== site.origin || !text.has(file)) {
      errors.push(`sitemap-index.xml: lists missing sitemap ${loc}`);
      continue;
    }
    for (const [, pageLoc] of text.get(file).matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const pu = new URL(pageLoc.replace(/&amp;/g, '&'));
      const target = resolve(pu.pathname);
      sitemapPaths.add(pu.pathname);
      if (pu.origin !== site.origin) errors.push(`${u.pathname}: ${pageLoc} is not on ${site.origin}`);
      else if (!target) errors.push(`${u.pathname}: lists missing page ${pu.pathname}`);
      else if (isNoindex(text.get(target) ?? '')) errors.push(`${u.pathname}: lists noindex page ${pu.pathname}`);
    }
  }
  for (const html of htmlFiles) {
    if (isNoindex(text.get(html))) continue;
    const p = `/${rel(html)}`.replace(/index\.html$/, '');
    if (!sitemapPaths.has(p)) errors.push(`${p} is indexable but missing from the sitemaps`);
  }
}

if (errors.length) {
  console.error(`check-build failed (${errors.length}):\n  ` + errors.join('\n  '));
  process.exit(1);
}
console.log(
  `check-build${testMode ? ' (fixtures)' : ''}: ${htmlFiles.length} pages OK — ≤ ${config.build.maxPageKb} KB, no private data${testMode ? '' : ', no fixture data'}, ` +
    `${linksChecked} internal links OK, ${sitemapPaths.size} URLs in sitemaps.`,
);
