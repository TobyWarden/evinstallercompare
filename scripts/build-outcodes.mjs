#!/usr/bin/env node
// Builds data/outcodes.csv (one row per postcode district, e.g. "TN9", with its centre point)
// from the ONS Postcode Directory. The homepage postcode search uses it to send a visitor to
// the nearest town page.
//
// Usage: node scripts/build-outcodes.mjs --postcodes path/to/ONSPD_<MON>_<YEAR>_UK.csv

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--postcodes');
const file = i === -1 ? undefined : process.argv[i + 1];
if (!file) {
  console.error('Missing --postcodes <ONSPD csv>');
  process.exit(1);
}
const release = path.basename(file).match(/ONSPD_([A-Z]{3})_(\d{4})/i);
const source = release ? `ONS Postcode Directory (${release[1].toUpperCase()} ${release[2]})` : `Postcode file ${path.basename(file)}`;
const today = new Date().toISOString().slice(0, 10);

const acc = new Map(); // outcode -> [sumLat, sumLng, n]
let cols;
const parser = fs.createReadStream(file).pipe(parse({ columns: (h) => (cols = h.map((x) => x.trim().toLowerCase())), bom: true, relax_column_count: true }));
for await (const r of parser) {
  if (r.doterm) continue;
  const lat = Number(r.lat);
  const lng = Number(r.long);
  if (!Number.isFinite(lat) || lat > 90 || lat === 0) continue;
  const pc = String(r.pcds || '').toUpperCase().trim();
  const out = pc.split(' ')[0];
  if (!out) continue;
  const a = acc.get(out) ?? acc.set(out, [0, 0, 0]).get(out);
  a[0] += lat;
  a[1] += lng;
  a[2]++;
}
const rows = [...acc].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
const csv = ['outcode,latitude,longitude,live_postcodes,source,source_url,retrieved_at']
  .concat(rows.map(([o, [la, ln, n]]) => [o, (la / n).toFixed(5), (ln / n).toFixed(5), n, `"${source}"`, 'https://geoportal.statistics.gov.uk/', today].join(',')))
  .join('\n');
fs.writeFileSync(path.join(ROOT, 'data/outcodes.csv'), csv + '\n');
console.log(`Wrote ${rows.length} postcode districts to data/outcodes.csv`);
