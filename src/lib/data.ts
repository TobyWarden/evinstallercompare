// Single entry point for all site data. Pages import from here, never from /data directly.
//
// Installer coordinates and contact details are read here, used for build-time maths (which
// towns an installer is listed in, distance sorting) and then dropped: nothing private is put
// on the objects this module returns.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import configJson from '../../data/config.json';

export const config = configJson;

// DATA_DIR points the build at test fixtures (tests/fixtures). It is for `npm run test:build` only:
// Netlify builds refuse it, and the live data must never contain a fixture row.
const FIXTURE_MARKER = config.tests.fixtureSourceMarker;
const isTestBuild = Boolean(process.env.DATA_DIR);
if (isTestBuild && (process.env.NETLIFY === 'true' || process.env.CONTEXT)) {
  throw new Error('DATA_DIR is set on a Netlify build. Fixture data is for tests only; unset DATA_DIR.');
}
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'));

/** Fields that are stored in /data but must NEVER reach a rendered page. */
export const PRIVATE_FIELDS = ['phone', 'email', 'website', 'address', 'postcode', 'latitude', 'longitude'] as const;

const KM_PER_MILE = 1.609344;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Every fact carries where it came from and when it was pulled. */
export interface Provenance {
  source: string;
  source_url: string;
  retrieved_at: string; // ISO date, YYYY-MM-DD
}

export interface PlaceRef {
  name: string;
  url: string;
}

export interface FieldSource extends Provenance {
  label: string;
}

/** The only installer shape pages are allowed to see. */
export interface PublicInstaller extends Provenance {
  slug: string;
  url: string;
  company_name: string;
  company_number: string;
  postcode_area: string;
  serves_home: boolean;
  serves_commercial: boolean;
  ozev_approved: boolean;
  incorporated_on: string | null;
  years_trading: number | null;
  /** Listing radius used for this installer (config: commercial installers reach further). */
  radius_miles: number;
  base_town: PlaceRef | null;
  county: PlaceRef | null;
  towns: PlaceRef[];
  /** Provenance for the main row and for any field that came from somewhere else. */
  sources: FieldSource[];
}

export interface Town {
  slug: string;
  name: string;
  url: string;
  county: PlaceRef & { slug: string };
  installers: PublicInstaller[]; // nearest first
  indexable: boolean;
  nearby: (PlaceRef & { count: number })[];
}

export interface County {
  slug: string;
  name: string;
  url: string;
  towns: Town[];
  installers: PublicInstaller[];
  indexable: boolean;
}

export interface Directory {
  installers: PublicInstaller[];
  towns: Town[];
  counties: County[];
  /** Postcode district (e.g. "TN9") -> town page URL, for the homepage search. */
  postcodeLookup: Record<string, string>;
  /** Latest OZEV check date across all listings. */
  lastChecked: string | null;
}

// ---------- helpers ----------
export const countyUrl = (countySlug: string) => `/ev-charger-installers/${countySlug}/`;
export const townUrl = (countySlug: string, townSlug: string) => `/ev-charger-installers/${countySlug}/${townSlug}/`;
export const installerUrl = (slug: string) => `/installers/${slug}/`;
/** How far from its base an installer is listed: home-only installers use the smaller radius. */
export const serviceRadiusMiles = config.directory.serviceRadiusMiles;
export const commercialServiceRadiusMiles = config.directory.commercialServiceRadiusMiles;
if (!(commercialServiceRadiusMiles >= serviceRadiusMiles)) {
  throw new Error('config.directory.commercialServiceRadiusMiles must be at least serviceRadiusMiles');
}
export const radiusFor = (serves_commercial: boolean) => (serves_commercial ? commercialServiceRadiusMiles : serviceRadiusMiles);

function readCsv(file: string): Record<string, string>[] {
  const p = path.join(DATA_DIR, file);
  if (!fs.existsSync(p)) return [];
  const rows: Record<string, string>[] = parse(fs.readFileSync(p, 'utf8'), { columns: true, skip_empty_lines: true, trim: true, bom: true });
  if (!isTestBuild) {
    rows.forEach((row, i) => {
      if (Object.values(row).some((v) => v?.includes(FIXTURE_MARKER))) {
        throw new Error(`${file} row ${i + 2}: contains "${FIXTURE_MARKER}" test data. Fixtures belong in tests/fixtures only.`);
      }
    });
  }
  return rows;
}

function requireProvenance(row: Record<string, string>, file: string, i: number) {
  const where = `${file} row ${i + 2}`;
  for (const key of ['source', 'retrieved_at'] as const) {
    if (!row[key]) throw new Error(`${where}: missing "${key}" (every fact needs a source and date)`);
  }
  if (!DATE.test(row.retrieved_at)) throw new Error(`${where}: retrieved_at must be YYYY-MM-DD, got "${row.retrieved_at}"`);
  // A field with its own <field>_source column must carry that source and a date when it has a value.
  for (const key of Object.keys(row)) {
    const m = key.match(/^(.+)_source$/);
    if (!m || !row[m[1]]) continue;
    const date = row[`${m[1]}_retrieved_at`];
    if (!row[key]) throw new Error(`${where}: "${m[1]}" has a value but no "${key}"`);
    if (!date || !DATE.test(date)) throw new Error(`${where}: "${m[1]}" needs "${m[1]}_retrieved_at" as YYYY-MM-DD`);
  }
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v ?? '');
const toRad = (d: number) => (d * Math.PI) / 180;
function miles(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return (2 * 6371.0088 * Math.asin(Math.sqrt(h))) / KM_PER_MILE;
}
const num = (v: string) => (v === '' || v == null ? NaN : Number(v));
const FIELD_LABELS: Record<string, string> = {
  company_name: 'Company name',
  company_number: 'Company number',
  incorporated_on: 'Date incorporated',
};
const label = (field: string) => FIELD_LABELS[field] ?? field.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

function yearsSince(isoDate: string, now = new Date()) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  let years = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) years--;
  return Math.max(0, years);
}

// ---------- build ----------
let cache: Directory | undefined;

export function getDirectory(): Directory {
  if (cache) return cache;
  const minListings = config.directory.minInstallersForLocationPage;

  // Towns (public data: names and centre points).
  const townRows = readCsv('towns.csv').map((row, i) => {
    requireProvenance(row, 'towns.csv', i);
    const lat = num(row.latitude);
    const lng = num(row.longitude);
    if (!row.slug || !row.name || !row.county || !row.county_slug || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`towns.csv row ${i + 2}: needs slug, name, county, county_slug, latitude and longitude`);
    }
    return { ...row, lat, lng };
  });
  const seenTown = new Set<string>();
  for (const t of townRows) {
    const k = `${t.county_slug}/${t.slug}`;
    if (seenTown.has(k)) throw new Error(`towns.csv: duplicate town ${k}`);
    seenTown.add(k);
  }

  // Installers: private fields stay inside this function.
  const internal = readCsv('installers.csv').flatMap((row, i) => {
    requireProvenance(row, 'installers.csv', i);
    if (!row.company_name) return []; // no confirmed name: not listed (see CLAUDE.md, rule on real data)
    if (!row.slug) throw new Error(`installers.csv row ${i + 2}: missing slug`);
    const lat = num(row.latitude);
    const lng = num(row.longitude);
    const sources: FieldSource[] = [
      { label: 'OZEV listing and services', source: row.source, source_url: row.source_url, retrieved_at: row.retrieved_at },
    ];
    for (const key of Object.keys(row)) {
      const m = key.match(/^(.+)_source$/);
      if (m && row[m[1]]) {
        sources.push({ label: label(m[1]), source: row[key], source_url: row[`${m[1]}_source_url`] ?? '', retrieved_at: row[`${m[1]}_retrieved_at`] });
      }
    }
    // Explicit whitelist: anything not listed here (phone, email, website, address, postcode, coordinates) is dropped.
    const pub: PublicInstaller = {
      slug: row.slug,
      url: installerUrl(row.slug),
      company_name: row.company_name,
      company_number: row.company_number ?? '',
      postcode_area: (row.postcode_area ?? '').toUpperCase(),
      serves_home: yes(row.serves_home),
      serves_commercial: yes(row.serves_commercial),
      ozev_approved: yes(row.ozev_approved),
      incorporated_on: row.incorporated_on || null,
      years_trading: row.incorporated_on ? yearsSince(row.incorporated_on) : null,
      radius_miles: radiusFor(yes(row.serves_commercial)),
      base_town: null,
      county: null,
      towns: [],
      sources,
      source: row.source,
      source_url: row.source_url,
      retrieved_at: row.retrieved_at,
    };
    return [{ pub, lat, lng }];
  });
  const seenSlug = new Set<string>();
  for (const { pub } of internal) {
    if (seenSlug.has(pub.slug)) throw new Error(`installers.csv: duplicate slug "${pub.slug}"`);
    seenSlug.add(pub.slug);
  }

  // Which installers are listed in which towns: within the installer's radius of the town centre
  // (home-only and commercial installers use different radii, both from config).
  const townHits = townRows.map(() => [] as { pub: PublicInstaller; d: number }[]);
  for (const ins of internal) {
    if (!Number.isFinite(ins.lat) || !Number.isFinite(ins.lng)) continue;
    const radius = ins.pub.radius_miles;
    let nearest = -1;
    let nearestD = Infinity;
    townRows.forEach((t, ti) => {
      const d = miles(ins.lat, ins.lng, t.lat, t.lng);
      if (d <= radius) townHits[ti].push({ pub: ins.pub, d });
      if (d < nearestD) [nearest, nearestD] = [ti, d];
    });
    if (nearest !== -1 && nearestD <= radius) {
      const t = townRows[nearest];
      ins.pub.base_town = { name: t.name, url: townUrl(t.county_slug, t.slug) };
      ins.pub.county = { name: t.county, url: countyUrl(t.county_slug) };
    }
  }

  const towns: (Town & { lat: number; lng: number })[] = [];
  townRows.forEach((t, ti) => {
    const hits = townHits[ti].sort((a, b) => a.d - b.d || a.pub.company_name.localeCompare(b.pub.company_name));
    if (!hits.length) return; // no page for a town with no installers
    towns.push({
      slug: t.slug,
      name: t.name,
      url: townUrl(t.county_slug, t.slug),
      county: { name: t.county, slug: t.county_slug, url: countyUrl(t.county_slug) },
      installers: hits.map((h) => h.pub),
      indexable: hits.length >= minListings,
      nearby: [],
      lat: t.lat,
      lng: t.lng,
    });
  });
  towns.sort((a, b) => a.name.localeCompare(b.name));

  for (const t of towns) {
    for (const ins of t.installers) ins.towns.push({ name: t.name, url: t.url });
    t.nearby = towns
      .filter((o) => o !== t)
      .map((o) => ({ o, d: miles(t.lat, t.lng, o.lat, o.lng) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, config.directory.nearbyTownsCount)
      .map(({ o }) => ({ name: o.name, url: o.url, count: o.installers.length }));
  }

  const countyMap = new Map<string, County>();
  for (const t of towns) {
    let c = countyMap.get(t.county.slug);
    if (!c) countyMap.set(t.county.slug, (c = { slug: t.county.slug, name: t.county.name, url: t.county.url, towns: [], installers: [], indexable: false }));
    c.towns.push(t);
  }
  for (const c of countyMap.values()) {
    const unique = new Map<string, PublicInstaller>();
    for (const t of c.towns) for (const ins of t.installers) unique.set(ins.slug, ins);
    c.installers = [...unique.values()].sort((a, b) => a.company_name.localeCompare(b.company_name));
    c.indexable = c.installers.length >= minListings;
  }
  const counties = [...countyMap.values()].sort((a, b) => a.name.localeCompare(b.name));

  // Homepage postcode search: each postcode district goes to its nearest town page.
  const postcodeLookup: Record<string, string> = {};
  if (towns.length) {
    for (const row of readCsv('outcodes.csv')) {
      const lat = num(row.latitude);
      const lng = num(row.longitude);
      if (!row.outcode || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      let best: (typeof towns)[number] | undefined;
      let bestD = Infinity;
      for (const t of towns) {
        const d = miles(lat, lng, t.lat, t.lng);
        if (d < bestD) [best, bestD] = [t, d];
      }
      if (best && bestD <= config.directory.postcodeSearchMaxMiles) postcodeLookup[row.outcode.toUpperCase()] = best.url;
    }
  }

  const installers = internal.map((i) => i.pub).sort((a, b) => a.company_name.localeCompare(b.company_name));
  const lastChecked = installers.map((i) => i.retrieved_at).sort().at(-1) ?? null;
  // Strip the town coordinates too, so pages only ever see the public shape.
  cache = { installers, towns: towns.map(({ lat, lng, ...t }) => t), counties, postcodeLookup, lastChecked };
  return cache;
}

export function getInstallers(): PublicInstaller[] {
  return getDirectory().installers;
}
