# CLAUDE.md

EV Installer Compare (evinstallercompare.co.uk) is a UK directory of EV charger installers for homes and commercial sites. It's built with Astro + Tailwind CSS (v4, via `@tailwindcss/vite`) and deployed to Netlify from GitHub (`main` auto-deploys). See `AGENTS.md` for Astro docs links.

## Commands

- `npm run dev` starts the dev server at http://localhost:4321
- `npm run build` runs `astro build` and then `scripts/check-build.mjs`. The build fails if a page is over budget or leaks private data.
- `npm run preview` serves the built `dist/`

## Non-negotiable rules

1. **Templates + data only.** Every page is generated from a template in `src/pages/` (dynamic routes such as `installers/[slug].astro`) and data in `/data`. Never hand-write a page for a specific installer, town or region. Never hard-code a number, count, price, threshold or company fact in a template. Compute it from data or read it from config.
2. **All data lives in `/data`** as CSV or JSON. **All thresholds and settings live in `/data/config.json`**, including the page-size budget, minimum listings for a location page, page sizes, site name and URL. If you need a new magic number, add it to `config.json` first.
3. **Every fact records its source and the date it was pulled.** Every data row has `source`, `source_url` and `retrieved_at` (YYYY-MM-DD). If you add a column whose value comes from a different source than the rest of its row, give it its own `<field>_source` and `<field>_retrieved_at` columns. `src/lib/data.ts` throws at build time when provenance is missing, so don't weaken that check.
4. **Installer contact details are stored but NEVER displayed.** `phone`, `email`, `website` and full `address` stay in `/data` only. Profiles show **company name, town and postcode area only** (for example "SW", not a full postcode). This means no `tel:`/`mailto:` links, no outbound links to installer sites, and no contact details in JSON-LD, meta tags, inline scripts or client bundles. All enquiries go through our quote form (`/quote/`).
   - Pages must get installer data through `getInstallers()` in `src/lib/data.ts`. It returns a `PublicInstaller` built from an explicit whitelist. Never import `/data/installers.csv` directly in a page or component, and never add a private field to `PublicInstaller`.
   - `scripts/check-build.mjs` scans the built HTML for private values as a backstop.
5. **Static and light.** Output is fully static (no SSR adapter, no server functions for page rendering). Each page, counting its HTML and the local CSS, JS and images it references, must stay under `config.build.maxPageKb` (300 KB). Prefer zero client JS. Use `<script is:inline>` only for small progressive enhancements. No web fonts, analytics bundles or UI frameworks unless they fit the budget.

## Layout

```
data/
  config.json        # all settings and thresholds
  installers.csv     # one row per installer (public + private fields + provenance)
scripts/
  check-build.mjs    # post-build page-weight + privacy guard
src/
  lib/data.ts        # the only loader for /data; strips private fields
  layouts/Layout.astro
  pages/             # templates only: index, installers/[slug], quote
  styles/global.css  # Tailwind entry
netlify.toml
```

## Working conventions

- British English in copy (for example "enquiry" and "postcode").
- Don't invent installer data. Every row must come from a real, citable source.
- The quote form uses Netlify Forms (`data-netlify="true"`). Keep it a plain static HTML form.
- Run `npm run build` before committing. It must pass.
