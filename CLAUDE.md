# CLAUDE.md

EV Installer Compare (evinstallercompare.co.uk) is a UK directory of EV charger installers for homes and commercial sites. It's built with Astro + Tailwind CSS (v4, via `@tailwindcss/vite`) and deployed to Netlify from GitHub (`main` auto-deploys). See `AGENTS.md` for Astro docs links.

## David's advice (read first)

[`DAVIDS_ADVICE.md`](DAVIDS_ADVICE.md) is the product bible for this site. David runs installsolar.org, a directory built on the same model. **Read it before planning or building any page, data field, guide, form or config change, and follow it closely.**

- Points marked **[Toby's decision]** override David's advice where they differ.
- If a task conflicts with the advice, **stop and flag the conflict** to Toby instead of quietly working around it.
- The non-negotiable rules below win over everything else. If the advice and a rule seem to clash, flag it.

**Reference sites.** Model page structure, layout and tone on [installsolar.org](https://installsolar.org) (David's site, same model) and [comparefactors.co.uk](https://comparefactors.co.uk). Patterns already adopted: "check X before you sign" homepage with trust bullets, a places hub (A–Z counties and towns), eyebrow labels ("Town · Kent"), a "Data refreshed · Sources" line under location intros, "Placement can't be bought" next to every list, profile checklists where each fact shows its source and date, "Questions about [company]" FAQs, "Is this your business?" claim box, and "How this page is counted" links to `/methodology/`. Only copy a pattern when we have real data to fill it (no invented prices, ratings or install counts).

## Commands

- `npm run dev` starts the dev server at http://localhost:4321
- `npm run build` runs `astro build` and then `scripts/check-build.mjs`. The build fails if a page is over budget, leaks private data, contains test fixture data, has a broken internal link or anchor, or if the sitemaps/robots.txt are missing, list a noindex page or miss an indexable one.
- `npm run test:build` builds `tests/fixtures` into `dist-test/` (never `dist/`), runs the same checks and asserts the directory rules (thresholds, radii, noindex, sitemaps). Run it after changing templates or `src/lib/data.ts`.
- `npm run preview` serves the built `dist/`

## Non-negotiable rules

1. **Templates + data only.** Every page is generated from a template in `src/pages/` (dynamic routes such as `installers/[slug].astro`) and data in `/data`. Never hand-write a page for a specific installer, town or region. Never hard-code a number, count, price, threshold or company fact in a template. Compute it from data or read it from config.
2. **All data lives in `/data`** as CSV or JSON. **All thresholds and settings live in `/data/config.json`**, including the page-size budget, minimum listings for a location page, page sizes, site name and URL. If you need a new magic number, add it to `config.json` first.
3. **Every fact records its source and the date it was pulled.** Every data row has `source`, `source_url` and `retrieved_at` (YYYY-MM-DD). If you add a column whose value comes from a different source than the rest of its row, give it its own `<field>_source` and `<field>_retrieved_at` columns. `src/lib/data.ts` throws at build time when provenance is missing, so don't weaken that check.
4. **Installer contact details are stored but NEVER displayed.** `phone`, `email`, `website` and full `address` stay in `/data` only. Profiles show **company name, town and postcode area only** (for example "SW", not a full postcode). This means no `tel:`/`mailto:` links, no outbound links to installer sites, and no contact details in JSON-LD, meta tags, inline scripts or client bundles. All enquiries go through our quote form (`/quote/`).
   - Pages must get installer data through `getInstallers()` in `src/lib/data.ts`. It returns a `PublicInstaller` built from an explicit whitelist. Never import `/data/installers.csv` directly in a page or component, and never add a private field to `PublicInstaller`.
   - `scripts/check-build.mjs` scans the built HTML for private values as a backstop.
5. **Static and light.** Output is fully static (no SSR adapter, no server functions for page rendering). Each page, counting its HTML and the local CSS, JS and images it references, must stay under `config.build.maxPageKb` (300 KB). Prefer zero client JS. Use `<script is:inline>` only for small progressive enhancements. No web fonts, analytics bundles or UI frameworks unless they fit the budget.
6. **Analytics only with consent.** Google Analytics (`config.analytics.gaMeasurementId`, set it to `""` to switch off) is loaded by `Layout.astro` only after the visitor clicks Accept on the cookie banner. Never load gtag or set `_ga` cookies before consent, and never send installer contact details or form contents to analytics.

## Layout

```
DAVIDS_ADVICE.md     # product bible: read before building (see top of this file)
data/
  config.json        # all settings and thresholds
  towns.csv          # town names, county and centre point (public)
  outcodes.csv       # postcode district centres, for the homepage search (built from ONSPD)
  ons-regions.json   # ONS region code -> name
  installers.csv     # one row per installer (public + private fields + provenance; google_place_id stored for live ratings later)
  corrections.csv    # public log of listing corrections, shown on /corrections/
scripts/
  check-build.mjs    # post-build guard: page weight, privacy, fixtures, links, sitemaps
  test-build.mjs     # fixture build into dist-test/ + directory-rule assertions
  scrape-ozev.mjs    # collects OZEV installers from GOV.UK into data/raw/ (gitignored)
  match-companies-house.mjs # suggests Companies House matches for scraped installers
  build-outcodes.mjs # builds data/outcodes.csv from the ONS Postcode Directory
src/
  lib/data.ts        # the only loader for /data; strips private fields, works out towns/counties
  lib/summary.ts     # stats and FAQ copy for location pages
  layouts/Layout.astro
  components/        # StatCard, InstallerCard, Faq, QuoteForm (the one quote form, used inline and on /quote/)
  pages/             # templates only: index, [section]/(index|[county]/(index|[town])) where section = config.vertical.locationPath, installers/[slug], quote (+ quote/thanks), claim, methodology, data, corrections, how-we-make-money, postcode-lookup.json
  styles/global.css  # Tailwind entry
tests/fixtures/       # made-up test data (TEST FIXTURE), never built into the live site
netlify.toml
```

## Working conventions

- British English in copy (for example "enquiry" and "postcode").
- Don't invent installer data. Every row must come from a real, citable source.
- The quote form uses Netlify Forms (`data-netlify="true"`). Keep it a plain static HTML form. It lives in `src/components/QuoteForm.astro` and sits on every town and profile page, pre-filled with the area (and installer). Every copy must have the same fields. `config.quote.mode` is `"waitlist"` (collect demand, no installer deals yet) or `"live"`; copy on the form, thanks page and /how-we-make-money/ follows it.
- Google ratings: store only `google_place_id` and load ratings live (Google terms). Never store ratings or review text.
- Run `npm run build` before committing. It must pass.

## Vertical (trade) setting

`config.vertical` sets the trade the site covers: location URL path (`locationPath`), trade names (`trade`, `trades`, `aTrade`), the quote form's product field, and the certification (`certification.name`, `approved`, `dataColumn` in `installers.csv`, and `sourceKey` pointing at the config block for its source, e.g. `ozevScrape`). Templates must take trade words, certification names and location URLs from `vertical`, `primarySource` and `placesUrl` in `src/lib/data.ts`, never hard-code "EV", "charger" or "OZEV". `PublicInstaller.certified` is the generic flag. Adding heat pumps later means a new `vertical` block (MCS as the certification) and its data, not template edits.

## Directory rules (computed in `src/lib/data.ts`)

- An installer is listed in every town whose centre is within its radius of its base: `directory.serviceRadiusMiles` for homes-only installers, `directory.commercialServiceRadiusMiles` for installers marked `serves_commercial`. Its base town is the nearest of those.
- A town gets a page if at least one installer is listed there; it is `noindex` (and left out of the sitemaps) and links to its county when it has fewer than `directory.minInstallersForLocationPage`. Counties roll up their towns and use the same threshold.
- Installers with no `company_name` are skipped: GOV.UK doesn't publish names, so a name needs its own source (`company_name_source`, `company_name_retrieved_at`).
- `latitude`, `longitude` and `postcode` in `installers.csv` are private, like contact details. They're used only for build-time distance maths.
- Sitemaps: `/sitemap-index.xml` → `sitemap-pages.xml`, `sitemap-locations.xml`, `sitemap-installers.xml` (built in `src/lib/sitemap.ts`); `/robots.txt` points to the index.

## Test fixtures

- Made-up data lives only in `tests/fixtures/`, and every row's source contains `tests.fixtureSourceMarker` ("TEST FIXTURE"). Never copy fixture rows into `/data`.
- `DATA_DIR` switches the data folder for `npm run test:build` only. The live build refuses it (and `src/lib/data.ts` refuses it on Netlify), throws on any fixture-marked row in `/data`, and `check-build` fails if any fixture name, slug or marker reaches the built site.
