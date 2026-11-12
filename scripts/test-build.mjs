#!/usr/bin/env node
// Builds the site from tests/fixtures into config.tests.outDir (never dist/), runs the post-build
// checks in fixture mode, then asserts the directory rules hold. Also proves the live check
// rejects fixture output.  Usage: npm run test:build
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = process.cwd();
const config = JSON.parse(fs.readFileSync(path.join(root, 'data/config.json'), 'utf8'));
const { fixturesDir, outDir } = config.tests;
const out = path.join(root, outDir);
const env = { ...process.env, DATA_DIR: path.join(root, fixturesDir) };
const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { cwd: root, env, encoding: 'utf8', ...opts });

const build = run(process.execPath, ['node_modules/astro/bin/astro.mjs', 'build', '--outDir', outDir]);
if (build.status !== 0) {
  console.error(build.stdout, build.stderr);
  process.exit(1);
}
const check = run(process.execPath, ['scripts/check-build.mjs', '--fixtures']);
process.stdout.write(check.stdout);
if (check.status !== 0) {
  console.error(check.stderr);
  process.exit(1);
}

const failures = [];
const expect = (ok, msg) => (ok ? console.log(`  ✓ ${msg}`) : failures.push(msg));
const page = (p) => {
  const f = path.join(out, p, 'index.html');
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
};
const cards = (html) => [...html.matchAll(/data-installer="([^"]+)"/g)].map((m) => m[1]);
const noindex = (html) => /<meta name="robots" content="[^"]*noindex/.test(html);
const min = config.directory.minInstallersForLocationPage;
const loc = config.vertical.locationPath;

console.log('Directory rules:');
expect(!page('installers/fixture-noname'), 'installer with no company name gets no page');

const townDir = path.join(out, config.vertical.locationPath);
let towns = 0;
for (const county of fs.readdirSync(townDir).filter((d) => d !== "index.html")) {
  const countyHtml = page(`${loc}/${county}`);
  for (const town of fs.readdirSync(path.join(townDir, county)).filter((d) => d !== 'index.html')) {
    const html = page(`${loc}/${county}/${town}`);
    const n = new Set(cards(html)).size;
    towns++;
    expect(noindex(html) === n < min, `${town}: ${n} installers → ${n < min ? 'noindex' : 'indexed'} (threshold ${min})`);
    if (n < min) expect(html.includes(`href="/${loc}/${county}/"`), `${town}: links to its county`);
  }
  const n = new Set(cards(countyHtml)).size;
  expect(noindex(countyHtml) === n < min, `${county}: county ${n} installers → ${n < min ? 'noindex' : 'indexed'}`);
}
expect(towns > 0, `${towns} town pages built`);
const hub = page(loc);
expect(hub && !noindex(hub) && hub.includes(`href="/${loc}/kent/"`) && hub.includes(`href="/${loc}/kent/ashford/"`), "places hub lists every county and town");

// Radius: fixture-golf (commercial, Crawley) is ~19 miles from Tunbridge Wells; fixture-bravo (homes only,
// near Tonbridge) is ~20 miles from Crawley. Only the commercial installer should cross that distance.
const tw = page(`${loc}/kent/tunbridge-wells`);
const crawley = page(`${loc}/west-sussex/crawley`);
expect(cards(tw).includes('fixture-golf'), `commercial installer listed ${config.directory.commercialServiceRadiusMiles} miles out (Crawley → Tunbridge Wells)`);
expect(!cards(crawley).includes('fixture-bravo'), `homes-only installer not listed beyond ${config.directory.serviceRadiusMiles} miles (Tonbridge → Crawley)`);

const profile = page('installers/fixture-alpha');
expect(profile.includes('Claim or correct this listing') && profile.includes('href="/claim/?installer=fixture-alpha"'), 'profile has a claim/correct link');
expect(profile.includes('Get a quote from Fixture Alpha Electrical Ltd'), 'profile has a named quote button');
expect(profile.includes('Is this your business?') && profile.includes('Questions about Fixture Alpha Electrical Ltd'), 'profile has FAQs and an is-this-your-business box');
expect(profile.includes(config.vertical.certification.approved), 'profile shows the vertical certification label from config');
for (const t of ['tonbridge', 'tunbridge-wells', 'sevenoaks']) expect(profile.includes(`href="/${loc}/kent/${t}/"`), `profile links to ${t}`);

// Quote form on every town and profile page, pre-filled with the area (and the installer on profiles).
const formName = config.quote.formName;
const hasForm = (html) => html.includes(`name="${formName}"`) && html.includes('data-netlify="true"');
expect(hasForm(tw) && tw.includes('name="area" value="Tunbridge Wells, Kent"'), 'town page has a quote form pre-filled with the area');
expect(hasForm(profile) && profile.includes('name="installer" id="installer-field" value="fixture-alpha"'), 'profile has a quote form pre-filled with the installer');
const fields = (html) => [...html.matchAll(/<(?:input|select|textarea)[^>]*\sname="([^"]+)"/g)].map((m) => m[1]).sort().join(',');
expect(fields(tw) === fields(profile) && fields(tw) === fields(page('quote')), 'every quote form has the same fields');
for (const p of ['methodology', 'data', 'corrections', 'how-we-make-money']) {
  expect(page(p) && page('').includes(`href="/${p}/"`), `/${p}/ exists and is linked from the footer`);
}
expect(page('corrections').includes('href="/installers/fixture-alpha/"'), 'corrections page lists a logged correction');

const sitemap = fs.readFileSync(path.join(out, 'sitemap-locations.xml'), 'utf8');
expect(!sitemap.includes('/kent/ashford/'), 'noindex town left out of the sitemap');

// The live check must refuse this output because it contains fixtures.
const live = run(process.execPath, ['scripts/check-build.mjs', '--dist', outDir], { env: { ...process.env, DATA_DIR: '' } });
expect(live.status !== 0 && /test fixture data/.test(live.stderr), 'live build check rejects fixture output');

if (failures.length) {
  console.error(`\ntest-build failed:\n  ✗ ${failures.join('\n  ✗ ')}`);
  process.exit(1);
}
console.log('\ntest-build: all checks passed.');
