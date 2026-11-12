#!/usr/bin/env node
// Suggests a Companies House company for each scraped OZEV installer (data/raw/ozev.csv),
// using the Companies House "Free Company Data Product" bulk CSV
// (https://download.companieshouse.gov.uk/en_output.html).
//
// Clues, each scored from data/config.json -> companiesHouseMatch.scores:
//   - website / email domain equals the company name   (kfwatsonelectrical.co.uk ~ K F WATSON ELECTRICAL LTD)
//   - company name starts with the domain name           (weaker)
//   - registered office has the same postcode / postcode area
//   - same postcode AND the street address matches (house/unit numbers agree, words overlap)
//   - SIC code is electrical / energy work
// The best candidate is graded high / medium / none. Nothing here is shown on the site:
// output goes to data/raw/companies-house-matches.csv for review.
//
// Usage
//   node scripts/match-companies-house.mjs --companies path/to/BasicCompanyDataAsOneFile-YYYY-MM-DD.csv [--installers data/raw/ozev.csv]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import { parse as parseSync } from 'csv-parse/sync';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/config.json'), 'utf8')).companiesHouseMatch;
const args = process.argv.slice(2);
const arg = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i === -1 ? d : args[i + 1];
};
const companiesFile = arg('companies');
const installersFile = arg('installers', path.join(ROOT, 'data/raw/ozev.csv'));
const OUT_FILE = path.join(ROOT, 'data/raw/companies-house-matches.csv');
if (!companiesFile) {
  console.error('Missing --companies <BasicCompanyDataAsOneFile-....csv>');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const chRelease = path.basename(companiesFile).match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? 'unknown release';

// ---------- normalising ----------
const LEGAL = /\b(limited|ltd|plc|llp|lp|cic|company|co|uk|the|and)\b/g;
const nameSlug = (s) => s.toLowerCase().replace(/&/g, ' and ').replace(/\([^)]*\)/g, ' ').replace(LEGAL, ' ').replace(/[^a-z0-9]/g, '');
const pcKey = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const pcArea = (p) => (pcKey(p).match(/^[A-Z]{1,2}/) || [''])[0];
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((t) => t.length > 1 || /\d/.test(t));
const numbers = (s) => (String(s || '').match(/\d+[a-z]?/gi) || []).map((x) => x.toLowerCase());
const SECOND_LEVEL = new Set(['co', 'org', 'ltd', 'plc', 'me', 'net', 'gov', 'ac']);
const freeMail = new Set(cfg.freeEmailDomains);

function domainSlug(hostOrUrl) {
  let host = String(hostOrUrl || '').trim().toLowerCase();
  if (!host) return '';
  host = host.replace(/^[a-z]+:\/\//, '').split(/[/?#:]/)[0].replace(/^www\d?\./, '');
  if (freeMail.has(host)) return '';
  const labels = host.split('.').filter(Boolean);
  if (labels.length < 2) return '';
  labels.pop(); // tld
  if (labels.length > 1 && SECOND_LEVEL.has(labels.at(-1))) labels.pop(); // co.uk etc.
  return nameSlug(labels.at(-1).replace(/-/g, ''));
}

// ---------- installers ----------
const installers = parseSync(fs.readFileSync(installersFile, 'utf8'), { columns: true, bom: true, skip_empty_lines: true }).map((r) => {
  const emailDomain = (r.email || '').split('@')[1]?.trim();
  const slugs = [...new Set([domainSlug(r.website), domainSlug(emailDomain)].filter((s) => s.length >= 3))];
  return { ...r, pc: pcKey(r.postcode), area: pcArea(r.postcode), slugs, candidates: new Map() };
});
console.log(`${installers.length} installers from ${path.relative(ROOT, installersFile)}`);

const bySlug = new Map(); // domain slug -> installers
const byPostcode = new Map(); // postcode -> installers
for (const ins of installers) {
  for (const s of ins.slugs) (bySlug.get(s) ?? bySlug.set(s, []).get(s)).push(ins);
  if (ins.pc) (byPostcode.get(ins.pc) ?? byPostcode.set(ins.pc, []).get(ins.pc)).push(ins);
}
const minPrefix = cfg.minDomainPrefixLength;
const relevantSic = new Set(cfg.relevantSicCodes);

function addressMatches(ins, co) {
  const a = tokens(ins.street_address);
  const b = new Set(tokens(`${co.line1} ${co.line2}`));
  if (!a.length || !b.size) return false;
  const nums = numbers(ins.street_address);
  if (nums.length && !nums.every((n) => b.has(n))) return false; // "Office 22" must not match "Office 23"
  return a.filter((t) => b.has(t)).length / a.length >= cfg.addressTokenOverlap;
}

function consider(ins, co, reason) {
  let c = ins.candidates.get(co.number);
  if (!c) ins.candidates.set(co.number, (c = { co, reasons: new Set() }));
  c.reasons.add(reason);
}

// ---------- stream Companies House ----------
console.log(`Reading ${path.basename(companiesFile)} (this takes a few minutes)...`);
let rows = 0;
let active = 0;
const parser = fs.createReadStream(companiesFile).pipe(
  parse({ columns: (h) => h.map((x) => x.trim()), bom: true, relax_quotes: true, relax_column_count: true, skip_empty_lines: true }),
);
for await (const r of parser) {
  if (++rows % 1_000_000 === 0) console.log(`  ${rows.toLocaleString()} companies read`);
  if (!String(r.CompanyStatus || '').startsWith(cfg.activeStatusPrefix)) continue;
  active++;
  const pc = pcKey(r['RegAddress.PostCode']);
  const slug = nameSlug(r.CompanyName || '');
  const samePc = byPostcode.get(pc);
  const exact = bySlug.get(slug);
  let prefixHits = null;
  if (!exact && slug.length > minPrefix) {
    for (let n = minPrefix; n < slug.length; n++) {
      const hit = bySlug.get(slug.slice(0, n));
      if (hit) (prefixHits ??= []).push(...hit);
    }
  }
  if (!samePc && !exact && !prefixHits) continue;
  const co = {
    number: r.CompanyNumber,
    name: r.CompanyName,
    status: r.CompanyStatus,
    line1: r['RegAddress.AddressLine1'] || '',
    line2: r['RegAddress.AddressLine2'] || '',
    town: r['RegAddress.PostTown'] || '',
    postcode: r['RegAddress.PostCode'] || '',
    pc,
    area: pcArea(pc),
    sic: [1, 2, 3, 4].map((i) => r[`SICCode.SicText_${i}`]).filter(Boolean),
  };
  co.relevant = co.sic.some((s) => relevantSic.has(s.slice(0, 5)));
  if (exact) for (const ins of exact) consider(ins, co, 'domainExact');
  if (prefixHits) for (const ins of prefixHits) consider(ins, co, 'domainPrefix');
  if (samePc) for (const ins of samePc) if (addressMatches(ins, co)) consider(ins, co, 'addressMatch');
}
console.log(`${rows.toLocaleString()} companies read, ${active.toLocaleString()} active.`);

// ---------- score ----------
const S = cfg.scores;
function score(ins, c) {
  const reasons = new Set(c.reasons);
  if (reasons.has('domainExact')) reasons.delete('domainPrefix');
  if (c.co.pc && c.co.pc === ins.pc) reasons.add('samePostcode');
  else if (c.co.area && c.co.area === ins.area) reasons.add('samePostcodeArea');
  if (c.co.relevant) reasons.add('relevantSic');
  return { ...c, reasons: [...reasons], score: [...reasons].reduce((s, r) => s + (S[r] ?? 0), 0) };
}
const grade = (s) => (s >= cfg.highConfidenceScore ? 'high' : s >= cfg.mediumConfidenceScore ? 'medium' : 'none');

const COLUMNS = [
  'installer_street_address', 'installer_postcode', 'installer_website', 'installer_email',
  'match_confidence', 'match_score', 'match_reasons',
  'company_name', 'company_number', 'company_status', 'company_address', 'company_postcode', 'company_sic_codes',
  'runner_up_name', 'runner_up_number', 'runner_up_score',
  'source', 'source_url', 'retrieved_at',
];
const out = [];
const counts = { high: 0, medium: 0, none: 0 };
for (const ins of installers) {
  let ranked = [...ins.candidates.values()].map((c) => score(ins, c)).sort((a, b) => b.score - a.score);
  // Prefix matches are noisy: keep only the strongest few.
  ranked = ranked.slice(0, Math.max(1, cfg.maxPrefixCandidates));
  const best = ranked[0];
  const second = ranked[1];
  let conf = best ? grade(best.score) : 'none';
  if (best && second && second.score === best.score && conf === 'high') conf = 'medium'; // tie: needs a human
  counts[conf]++;
  out.push({
    installer_street_address: ins.street_address,
    installer_postcode: ins.postcode,
    installer_website: ins.website,
    installer_email: ins.email,
    match_confidence: conf,
    match_score: best?.score ?? 0,
    match_reasons: best?.reasons.join(' + ') ?? '',
    company_name: conf === 'none' ? '' : best.co.name,
    company_number: conf === 'none' ? '' : best.co.number,
    company_status: conf === 'none' ? '' : best.co.status,
    company_address: conf === 'none' ? '' : [best.co.line1, best.co.line2, best.co.town].filter(Boolean).join(', '),
    company_postcode: conf === 'none' ? '' : best.co.postcode,
    company_sic_codes: conf === 'none' ? '' : best.co.sic.join('; '),
    runner_up_name: second?.co.name ?? '',
    runner_up_number: second?.co.number ?? '',
    runner_up_score: second?.score ?? '',
    source: `${cfg.sourceName} (${chRelease})`,
    source_url: cfg.sourceUrl,
    retrieved_at: today,
  });
}
const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
fs.writeFileSync(OUT_FILE, [COLUMNS.join(','), ...out.map((r) => COLUMNS.map((c) => cell(r[c])).join(','))].join('\n') + '\n');

const pct = (n) => `${((100 * n) / installers.length).toFixed(0)}%`;
console.log(`\nSaved ${path.relative(ROOT, OUT_FILE)}`);
console.log(`High confidence:   ${counts.high} (${pct(counts.high)})`);
console.log(`Medium confidence: ${counts.medium} (${pct(counts.medium)})`);
console.log(`No match:          ${counts.none} (${pct(counts.none)})`);
const noClue = installers.filter((i) => !i.slugs.length).length;
console.log(`(${noClue} installers have no usable website/email domain, e.g. only a Gmail/Hotmail address.)`);
