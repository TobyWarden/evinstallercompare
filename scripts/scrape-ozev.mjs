#!/usr/bin/env node
// Collects every OZEV-approved chargepoint installer from the GOV.UK finder
// (https://www.gov.uk/electric-vehicle-chargepoint-installers) into data/raw/ozev.csv.
//
// How it guarantees full coverage
// -------------------------------
// The finder takes a postcode and returns the 10 nearest installers, sorted by distance,
// with no paging. So one search at point S whose 10th result is r km away proves that every
// installer within r of S has been seen. Installers are located at postcodes, so if every
// live UK postcode lies inside at least one search's radius, no installer can be missed.
//
// The script loads every live postcode (from the ONS Postcode Directory or any CSV with
// postcode + lat/long columns), then repeatedly searches the next postcode that no earlier
// search has covered, until every postcode is covered. Rural searches cover tens of km; dense
// urban ones cover a few hundred metres, so the number of searches adapts to installer density.
//
// It is polite: one request at a time, a random 2–3 s gap between requests (data/config.json
// -> ozevScrape), backs off on 429/5xx, and every search is appended to a log so a stopped run
// resumes where it left off.
//
// Usage
//   node scripts/scrape-ozev.mjs --postcodes path/to/ONSPD.csv [--max-searches N] [--fresh]
//   node scripts/scrape-ozev.mjs --postcodes ... --report-only   (rebuild CSV + summary from log)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config.json'), 'utf8')).ozevScrape;
const regionsFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/ons-regions.json'), 'utf8'));
const RAW_DIR = path.join(ROOT, 'data/raw');
const LOG_FILE = path.join(RAW_DIR, 'ozev-searches.jsonl');
const OUT_FILE = path.join(RAW_DIR, 'ozev.csv');

// ---------- args ----------
const args = process.argv.slice(2);
const arg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);
const postcodeFile = arg('postcodes');
const maxSearches = arg('max-searches') ? Number(arg('max-searches')) : Infinity;
if (!postcodeFile) {
  console.error('Missing --postcodes <csv>. Use the ONS Postcode Directory (ONSPD) CSV, or any CSV with postcode, lat and long columns.');
  process.exit(1);
}
fs.mkdirSync(RAW_DIR, { recursive: true });
if (flag('fresh') && fs.existsSync(LOG_FILE)) fs.renameSync(LOG_FILE, `${LOG_FILE}.${Date.now()}.bak`);

// ---------- helpers ----------
const today = () => new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const normPostcode = (p) => {
  const s = String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length > 3 ? `${s.slice(0, -3)} ${s.slice(-3)}` : s;
};
const postcodeArea = (p) => (normPostcode(p).match(/^[A-Z]{1,2}/) || [''])[0];
const toRad = (d) => (d * Math.PI) / 180;
function km(lat1, lng1, lat2, lng2) {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.sqrt(h));
}
const decode = (s) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// ---------- load postcodes ----------
async function loadPostcodes(file) {
  const pick = (cols, re) => cols.find((c) => re.test(c));
  let cols;
  let pcCol, latCol, lngCol, termCol, rgnCol;
  const live = { pc: [], lat: [], lng: [] };
  const regionOf = new Map(); // postcode -> region code (live and terminated, for installer lookup)
  const parser = fs.createReadStream(file).pipe(
    parse({ columns: (h) => (cols = h.map((x) => x.trim().toLowerCase())), bom: true, skip_empty_lines: true, relax_column_count: true }),
  );
  for await (const row of parser) {
    if (!pcCol) {
      pcCol = pick(cols, /^pcds$/) || pick(cols, /^pcd2?$/) || pick(cols, /^postcode$/);
      latCol = pick(cols, /^lat(itude)?$/);
      lngCol = pick(cols, /^(long|lng|longitude)$/);
      termCol = pick(cols, /^doterm/);
      rgnCol = pick(cols, /^rgn(\d+)?(cd)?$/);
      if (!pcCol || !latCol || !lngCol) throw new Error(`Couldn't find postcode/lat/long columns in ${file}. Columns: ${cols.join(', ')}`);
      console.log(`Postcode columns: postcode=${pcCol} lat=${latCol} long=${lngCol} terminated=${termCol ?? '(none)'} region=${rgnCol ?? '(none)'}`);
    }
    const pc = normPostcode(row[pcCol]);
    if (!pc) continue;
    if (rgnCol && row[rgnCol]) regionOf.set(pc, row[rgnCol]);
    if (termCol && row[termCol]) continue; // terminated postcode: nobody lives/works there now
    const lat = Number(row[latCol]);
    const lng = Number(row[lngCol]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat > 90 || lat === 0) continue; // ONSPD uses 99.999999 for "no location"
    live.pc.push(pc);
    live.lat.push(lat);
    live.lng.push(lng);
  }
  // Sort by postcode so searches move through the country area by area (and progress is readable).
  const order = live.pc.map((_, i) => i).sort((a, b) => (live.pc[a] < live.pc[b] ? -1 : 1));
  return {
    pc: order.map((i) => live.pc[i]),
    lat: Float64Array.from(order.map((i) => live.lat[i])),
    lng: Float64Array.from(order.map((i) => live.lng[i])),
    regionOf,
  };
}

// ---------- coverage index ----------
class Coverage {
  constructor(P) {
    this.P = P;
    this.covered = new Uint8Array(P.pc.length);
    this.attempted = new Uint8Array(P.pc.length); // searched, whether or not that covered it
    this.cell = config.gridCellDegrees;
    this.grid = new Map();
    for (let i = 0; i < P.pc.length; i++) {
      const k = this.key(P.lat[i], P.lng[i]);
      let a = this.grid.get(k);
      if (!a) this.grid.set(k, (a = []));
      a.push(i);
    }
    this.remaining = P.pc.length;
  }
  key(lat, lng) {
    return `${Math.floor(lat / this.cell)},${Math.floor(lng / this.cell)}`;
  }
  mark(i) {
    if (!this.covered[i]) {
      this.covered[i] = 1;
      this.remaining--;
    }
  }
  /** Mark every postcode strictly within radiusKm of (lat, lng). null = the search returned everything. */
  cover(lat, lng, radiusKm) {
    if (radiusKm === null) {
      for (let i = 0; i < this.covered.length; i++) this.mark(i);
      return;
    }
    if (radiusKm <= 0) return;
    const dLat = radiusKm / 111;
    const dLng = radiusKm / (111 * Math.max(0.1, Math.cos(toRad(lat))));
    const r0 = Math.floor((lat - dLat) / this.cell), r1 = Math.floor((lat + dLat) / this.cell);
    const c0 = Math.floor((lng - dLng) / this.cell), c1 = Math.floor((lng + dLng) / this.cell);
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const a = this.grid.get(`${r},${c}`);
        if (!a) continue;
        for (const i of a) if (!this.covered[i] && km(lat, lng, this.P.lat[i], this.P.lng[i]) < radiusKm) this.mark(i);
      }
  }
}

// ---------- GOV.UK client ----------
let token;
async function request(url, init, what) {
  for (let attempt = 0; ; attempt++) {
    let res, err;
    try {
      res = await fetch(url, { ...init, headers: { 'User-Agent': config.userAgent, ...(init?.headers || {}) } });
    } catch (e) {
      err = e;
    }
    const retryable = err || res.status === 429 || res.status >= 500;
    if (!retryable) return res;
    if (attempt >= config.maxRetries) throw new Error(`${what}: giving up after ${attempt + 1} attempts (${err?.message ?? res.status})`);
    const after = Number(res?.headers.get('retry-after')) * 1000;
    const wait = after > 0 ? after : config.retryBaseDelayMs * 2 ** attempt;
    console.warn(`  ${what}: ${err?.message ?? `HTTP ${res.status}`}, waiting ${Math.round(wait / 1000)} s before retrying`);
    await sleep(wait);
  }
}
async function refreshToken() {
  const res = await request(config.sourceUrl, {}, 'load search page');
  const html = await res.text();
  token = html.match(/name="authenticity_token" value="([^"]+)"/)?.[1];
  if (!token) throw new Error('Search page has no authenticity_token: the GOV.UK form has changed, check the script.');
}
let lastRequestAt = 0;
async function politeGap() {
  const gap = config.minDelayMs + Math.random() * (config.maxDelayMs - config.minDelayMs);
  const wait = lastRequestAt + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function parseResults(html) {
  const list = html.match(/<ol[^>]*class="[^"]*place-list[^"]*"[^>]*>([\s\S]*?)<\/ol>/);
  if (!list) return null;
  return list[1]
    .split(/<div class="place group place-list__item">/)
    .slice(1)
    .map((chunk) => {
      const span = (cls) => {
        const m = chunk.match(new RegExp(`<span class="${cls}">([\\s\\S]*?)</span>`));
        return m ? decode(m[1]) : '';
      };
      // The finder used to show the company name in a heading/strong above the address; pick it up if it returns.
      const nameMatch = chunk.match(/<(?:h[2-4]|strong|span class="(?:fn|org|name)")[^>]*>([\s\S]*?)<\/(?:h[2-4]|strong|span)>/);
      const osm = chunk.match(/mlat=([-\d.]+)&(?:amp;)?mlon=([-\d.]+)/);
      const extra = (chunk.split('class="additional-information"')[1] || '');
      const links = [...extra.matchAll(/href="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
      const email = links.find((h) => h.startsWith('mailto:'))?.slice(7) ?? '';
      const website = links.find((h) => /^https?:/i.test(h)) ?? '';
      const paras = [...extra.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => decode(m[1])).filter(Boolean);
      const phone = (paras.find((p) => /^Telephone:/i.test(p)) || '').replace(/^Telephone:\s*/i, '');
      const service = paras.find((p) => /installation/i.test(p)) || '';
      return {
        company_name: nameMatch ? decode(nameMatch[1]) : '',
        street_address: span('street-address'),
        locality: span('locality'),
        postcode: normPostcode(span('postal-code')),
        latitude: osm ? Number(osm[1]) : null,
        longitude: osm ? Number(osm[2]) : null,
        website,
        email,
        phone,
        service_type: service,
      };
    });
}

async function search(postcode) {
  if (!token) await refreshToken();
  for (let tokenTries = 0; tokenTries < 2; tokenTries++) {
    await politeGap();
    const res = await request(
      config.sourceUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ authenticity_token: token, postcode }),
        redirect: 'follow',
      },
      `search ${postcode}`,
    );
    const html = await res.text();
    const results = parseResults(html);
    if (results) return { ok: true, results };
    // A postcode GOV.UK can't place comes back as a normal page with a form error.
    const error = html.match(/class="[^"]*govuk-error-message[^"]*"[^>]*>([\s\S]*?)<\/p>/);
    if (error) return { ok: false, status: res.status, error: decode(error[1]).replace(/^Error:\s*/, '') };
    if (res.status === 403 || res.status === 422) {
      // Expired form token: fetch a fresh one and retry once.
      await politeGap();
      await refreshToken();
      continue;
    }
    return { ok: false, status: res.status, error: 'no results list on page (has the GOV.UK page changed?)' };
  }
  return { ok: false, status: 0, error: 'token refresh did not help' };
}

// ---------- output ----------
const COLUMNS = [
  'company_name', 'street_address', 'locality', 'postcode', 'postcode_area',
  'region', 'region_source', 'region_retrieved_at',
  'latitude', 'longitude', 'website', 'email', 'phone',
  'service_type', 'serves_commercial', 'serves_home',
  'source', 'source_url', 'retrieved_at', 'date_pulled',
];
const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const dedupeKey = (r) => `${(r.company_name || r.street_address).toLowerCase().replace(/[^a-z0-9]/g, '')}|${r.postcode.replace(/\s/g, '')}`;

function buildOutput(log, regionOf, postcodeSource) {
  const regionNames = regionsFile.regions;
  const byKey = new Map();
  for (const entry of log) {
    if (!entry.ok) continue;
    for (const r of entry.results) {
      const k = dedupeKey(r);
      if (byKey.has(k)) continue;
      const code = regionOf.get(r.postcode);
      const svc = r.service_type.toLowerCase();
      byKey.set(k, {
        ...r,
        postcode_area: postcodeArea(r.postcode),
        region: code ? regionNames[code] ?? code : '',
        region_source: code ? postcodeSource.name : '',
        region_retrieved_at: code ? postcodeSource.date : '',
        serves_commercial: svc.includes('commercial') ? 'yes' : 'no',
        serves_home: svc.includes('residential') ? 'yes' : 'no',
        source: config.sourceName,
        source_url: config.sourceUrl,
        retrieved_at: entry.date,
        date_pulled: entry.date,
      });
    }
  }
  const rows = [...byKey.values()].sort((a, b) => a.postcode.localeCompare(b.postcode) || a.street_address.localeCompare(b.street_address));
  const csv = [COLUMNS.join(','), ...rows.map((r) => COLUMNS.map((c) => csvCell(r[c])).join(','))].join('\n') + '\n';
  fs.writeFileSync(OUT_FILE, csv);
  return rows;
}

function report(rows, log, cov) {
  const searches = log.length;
  const failed = log.filter((e) => !e.ok);
  const dense = log.filter((e) => e.ok && e.saturated);
  const commercial = rows.filter((r) => r.serves_commercial === 'yes').length;
  const byRegion = {};
  for (const r of rows) byRegion[r.region || '(unknown)'] = (byRegion[r.region || '(unknown)'] || 0) + 1;
  console.log('\n===== OZEV installers =====');
  console.log(`Saved ${rows.length} unique installers to ${path.relative(ROOT, OUT_FILE)}`);
  console.log(`Commercial (commercial and residential): ${commercial}`);
  console.log(`Residential only: ${rows.length - commercial}`);
  console.log('By region:');
  for (const [k, v] of Object.entries(byRegion).sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(26)} ${v}`);
  const named = rows.filter((r) => r.company_name).length;
  if (named < rows.length) console.log(`Note: ${rows.length - named} rows have no company name on GOV.UK; they were de-duplicated by street address + postcode.`);
  console.log(`\nSearches: ${searches} (${failed.length} postcodes GOV.UK couldn't search)`);
  if (cov) console.log(`Postcodes not yet covered by any search: ${cov.remaining}`);
  if (dense.length) console.log(`Warning: ${dense.length} searches had all 10 results at the same spot, so more than 10 installers may share those postcodes: ${dense.map((e) => e.postcode).slice(0, 20).join(', ')}`);
}

// ---------- main ----------
const onspd = path.basename(postcodeFile).match(/ONSPD_([A-Z]{3})_(\d{4})/i);
const postcodeSource = {
  // Region comes from the postcode file, so it carries that file's name; the date is when we pulled it.
  name: onspd ? `ONS Postcode Directory (${onspd[1].toUpperCase()} ${onspd[2]})` : `Postcode file ${path.basename(postcodeFile)}`,
  date: today(),
};
console.log(`Loading postcodes from ${postcodeFile} ...`);
const P = await loadPostcodes(postcodeFile);
console.log(`${P.pc.length.toLocaleString()} live postcodes with a location.`);
const cov = new Coverage(P);
const index = new Map(P.pc.map((pc, i) => [pc, i]));

// Resume: replay earlier searches.
const log = fs.existsSync(LOG_FILE)
  ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : [];
for (const e of log) {
  const i = index.get(e.postcode);
  if (i !== undefined) cov.attempted[i] = 1;
  if (e.ok) cov.cover(e.lat, e.lng, e.radiusKm);
}
if (log.length) console.log(`Resuming: ${log.length} searches already done, ${cov.remaining.toLocaleString()} postcodes still to cover.`);

let stop = false;
process.on('SIGINT', () => {
  if (stop) process.exit(130);
  stop = true;
  console.log('\nStopping after the current search (Ctrl+C again to quit now)...');
});

if (!flag('report-only')) {
  const started = Date.now();
  let done = 0;
  for (let i = 0; i < P.pc.length && done < maxSearches && !stop; i++) {
    if (cov.covered[i] || cov.attempted[i]) continue;
    const postcode = P.pc[i];
    const res = await search(postcode);
    done++;
    let entry;
    if (res.ok) {
      const dists = res.results.filter((r) => r.latitude != null).map((r) => km(P.lat[i], P.lng[i], r.latitude, r.longitude));
      const full = res.results.length >= 10; // the finder returns at most 10
      const tenth = dists.length ? Math.max(...dists) : 0;
      // Fewer than 10 results means the finder returned everything it has.
      const radiusKm = full ? tenth - config.coverageMarginKm : null;
      entry = { postcode, lat: P.lat[i], lng: P.lng[i], date: today(), ok: true, radiusKm, saturated: full && radiusKm <= 0, results: res.results };
    } else {
      entry = { postcode, lat: P.lat[i], lng: P.lng[i], date: today(), ok: false, status: res.status, error: res.error };
    }
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
    log.push(entry);
    cov.attempted[i] = 1;
    if (entry.ok) cov.cover(entry.lat, entry.lng, entry.radiusKm);

    if (done % 25 === 0 || done === 1 || !entry.ok) {
      const rate = (Date.now() - started) / done;
      const pct = (100 * (1 - cov.remaining / P.pc.length)).toFixed(1);
      const what = entry.ok ? `radius ${entry.radiusKm !== null ? entry.radiusKm.toFixed(2) + ' km' : 'all'}` : `FAILED: ${entry.error}`;
      console.log(`[${done}] ${postcode} ${what} | ${pct}% of postcodes covered | ${cov.remaining.toLocaleString()} left | ${(rate / 1000).toFixed(1)} s/search`);
    }
  }
  if (cov.remaining === 0) console.log('\nEvery live postcode is covered by at least one search.');
  else {
    let untried = 0;
    for (let i = 0; i < P.pc.length; i++) if (!cov.covered[i] && !cov.attempted[i]) untried++;
    if (untried) console.log(`\nStopped with ${untried.toLocaleString()} postcodes still to search. Run the same command again to resume.`);
    else console.log(`\nFinished. ${cov.remaining.toLocaleString()} postcodes stay uncovered because GOV.UK couldn't search them and no nearby search reached them (listed as failed in data/raw/ozev-searches.jsonl).`);
  }
}

const rows = buildOutput(log, P.regionOf, postcodeSource);
report(rows, log, cov);
