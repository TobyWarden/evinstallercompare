// Post-build guard: fails the build if any page is over budget or leaks private installer data.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const maxBytes = config.build.maxPageKb * 1024;
const dist = path.join(root, 'dist');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const files = walk(dist);
const sizeOf = (f) => fs.statSync(f).size;

// Private values that must never appear in output. DATA_DIR matches src/lib/data.ts (fixture testing).
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(root, 'data'));
const rows = parse(fs.readFileSync(path.join(dataDir, 'installers.csv'), 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
const secrets = rows
  .flatMap((r) => [r.phone, r.email, r.website, r.address, r.postcode, r.latitude, r.longitude])
  .filter((v) => v && v.length > 4);

const errors = [];
// Client-side files (JSON, JS) must not carry private data either.
for (const f of files.filter((f) => /\.(js|json|txt|xml)$/.test(f))) {
  const text = fs.readFileSync(f, 'utf8');
  for (const s of secrets) if (text.includes(s)) errors.push(`${path.relative(dist, f)}: contains private installer data`);
}
for (const html of files.filter((f) => f.endsWith('.html'))) {
  const text = fs.readFileSync(html, 'utf8');
  // Page weight = HTML + local CSS/JS/images it references.
  const refs = [...text.matchAll(/(?:href|src)="(\/[^"#?]+)"/g)].map((m) => path.join(dist, m[1]));
  const assets = [...new Set(refs)].filter((f) => fs.existsSync(f) && fs.statSync(f).isFile() && !f.endsWith('.html'));
  const total = sizeOf(html) + assets.reduce((n, f) => n + sizeOf(f), 0);
  const rel = path.relative(dist, html);
  if (total > maxBytes) errors.push(`${rel}: ${(total / 1024).toFixed(1)} KB exceeds ${config.build.maxPageKb} KB`);
  for (const s of secrets) if (text.includes(s)) errors.push(`${rel}: contains private installer data`);
}

if (errors.length) {
  console.error('check-build failed:\n  ' + errors.join('\n  '));
  process.exit(1);
}
console.log(`check-build: ${files.filter((f) => f.endsWith('.html')).length} pages OK (≤ ${config.build.maxPageKb} KB, no private data).`);
