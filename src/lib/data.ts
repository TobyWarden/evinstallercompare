// Single entry point for all site data. Pages import from here, never from /data directly.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import configJson from '../../data/config.json';

export const config = configJson;

const DATA_DIR = path.resolve(process.cwd(), 'data');

/** Fields that are stored in /data but must NEVER reach a rendered page. */
export const PRIVATE_FIELDS = ['phone', 'email', 'website', 'address'] as const;

/** Every fact carries where it came from and when it was pulled. */
export interface Provenance {
  source: string;
  source_url: string;
  retrieved_at: string; // ISO date, YYYY-MM-DD
}

/** The only installer shape pages are allowed to see. */
export interface PublicInstaller extends Provenance {
  slug: string;
  company_name: string;
  town: string;
  postcode_area: string;
  serves_home: boolean;
  serves_commercial: boolean;
}

function readCsv(file: string): Record<string, string>[] {
  const text = fs.readFileSync(path.join(DATA_DIR, file), 'utf8');
  return parse(text, { columns: true, skip_empty_lines: true, trim: true, bom: true });
}

function requireProvenance(row: Record<string, string>, file: string, i: number) {
  for (const key of ['source', 'retrieved_at'] as const) {
    if (!row[key]) throw new Error(`${file} row ${i + 2}: missing "${key}" (every fact needs a source and date)`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.retrieved_at)) {
    throw new Error(`${file} row ${i + 2}: retrieved_at must be YYYY-MM-DD, got "${row.retrieved_at}"`);
  }
}

const yes = (v: string) => /^(y|yes|true|1)$/i.test(v);

let cache: PublicInstaller[] | undefined;

/** Loads installers and strips every private field. Build fails on rows without provenance. */
export function getInstallers(): PublicInstaller[] {
  if (cache) return cache;
  cache = readCsv('installers.csv').map((row, i) => {
    requireProvenance(row, 'installers.csv', i);
    // Explicit whitelist: anything not listed here (phone, email, website, address, ...) is dropped.
    return {
      slug: row.slug,
      company_name: row.company_name,
      town: row.town,
      postcode_area: row.postcode_area.toUpperCase(),
      serves_home: yes(row.serves_home),
      serves_commercial: yes(row.serves_commercial),
      source: row.source,
      source_url: row.source_url,
      retrieved_at: row.retrieved_at,
    };
  });
  return cache;
}
