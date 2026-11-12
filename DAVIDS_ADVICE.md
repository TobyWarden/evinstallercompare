# David's Advice

David runs installsolar.org, a US solar installer directory built on the same model as this site. This file collects his advice from November 2026. **Follow it closely.** If a task conflicts with it, stop and flag the conflict instead of quietly working around it.

Where Toby has made a deliberate decision that differs from David's advice, it's marked **[Toby's decision]**. Those decisions take priority.

---

## 1. One database, everything generated

- There is one core set of data tables. **Every page is generated from templates + data.** No hand-written pages.
- **No hard-coded numbers anywhere.** Installer counts, typical costs, grant amounts, "years trading" and "data pulled on" dates live once in the data/config and are pulled into pages at build time.
- Guides follow the same rule: copy refers to data variables, never typed-in figures.
- Profile template example: company name as the title, installer counts, year established, ratings and so on are all placeholders filled from the database. When the data refreshes, every page regenerates with the latest information.
- Site-wide totals (e.g. "X installers across the UK") must always match the sum of the underlying pages.
- All thresholds and switches live in **one config file**, so page types can be turned on and off.

## 2. Towns, not postcodes

- Pages target **specific towns**, not postcodes. Group postcodes into towns.
- **A town needs a minimum of 5–10 installers** to deserve an indexed page. Too many thin pages get penalised by Google.
- Below the threshold, the page can exist but is `noindex` and points to the county page. **Current setting: 5 installers.**
- Every town page needs **real depth**: local stats, local knowledge where available, not just a list.

## 3. Start small and strong

- David cut about 3,000 planned pages down to about 800. Launch with fewer, stronger pages and expand when Search Console shows demand.
- installsolar.org launched with one state (California) done properly, with the rest marked "coming soon".
- **[Toby's decision]** This site covers the whole UK from launch. The 5+ installer index threshold is the safeguard against thin pages. Be strict about it.

## 4. Town pages are the money pages

Layout, top to bottom:
1. A 1–2 line intro and key stats (number of OZEV installers, typical cost), plus a "See all X installers in [Town]" jump link.
2. Straight into the installer list.
3. Below the list: map, charts, longer explanation, FAQs.

## 5. Installer profiles are the strongest pages

- Short summary, stat cards (years trading, OZEV status, charger brands, rating), service area, and a "Get a quote" button.
- **Plain labels, rounded numbers.** It should read like a knowledgeable friend, not a database dump.
- **Every fact has a source note and a date** (e.g. "OZEV approved, checked 14 Nov 2026"; "Trading since 2014, Companies House").
- **[Toby's decision]** Phone, email, website and full address are stored but **never displayed**. Profiles show company name, town and postcode area only. All enquiries go through our quote form.

## 6. Data sources

Every profile fact has a source note.

- **OZEV authorised installer list:** primary backbone. Show "OZEV approved" plus the date pulled on every profile. Refresh regularly.
- **Companies House:** company age, active status, directors, recent dissolutions ("Trading since 2014").
- **MCS:** solar PV, battery and heat pump certification, for future cross-linking.
- **Google Places:** rating, review count, branches. v2, but leave room for it now. **[Toby's decision]** Store the Place ID only and load ratings live, as Google's terms require.
- **TrustMark / Buy With Confidence / Checkatrade:** badges where listed.
- **Installer websites:** charger brands fitted, towns covered, starting prices, commercial work.

## 7. Enrichment agent

- Use an agent to visit each installer's website and pull standard information: phone, reviews, whether they're trading, areas covered, brands and services.
- Treat enriched fields as "where available". Many sites won't list brands or prices.

## 8. Link sideways

- Profile → every town it covers.
- Town → nearby towns and its county.
- Guide → relevant town and brand pages.

## 9. Quote form everywhere

- A short form on every town and profile page, pre-filled with the area (and the installer, on profiles).
- Fields: postcode, property type, car/charger if known, email or phone.
- installsolar.org starts every form as a **waitlist**: collect demand first, before any installer deals.

## 10. Charger and brand pages

- **Drop "best charger for each car" pages.** Those are product reviews, which What Car, Which? and Autocar already own.
- Do brand-by-area pages ("Ohme installers in Bristol") **only where there's a real top 5**.

## 11. Guides

- Decision-focused only: real install cost, remaining grants (e.g. EV chargepoint grant for renters and flats), off-street parking rules, cable/earthing upgrades, comparing quotes.
- All numbers come from data.

## 12. Trust and positioning (from installsolar.org)

- Position the site as **"check an installer before you sign"**, not just "find an installer". Records, not reviews.
- State that rankings can't be bought.
- Include `/methodology/`, `/data/` and `/corrections/` pages, plus a disclosure of how the site makes money (installers pay for introductions).
- Show sample size and date next to every statistic.

## 13. Technical

- Static, lightweight pages (David's are under 300 KB).
- Split sitemaps: core, profiles, places.
- **A build check that fails on links to pages that don't exist.**
- All thresholds in one config file.

## 14. Admin

- Check OZEV's terms on reusing the list.
- Set up Search Console from day one.

## 15. Monetisation thinking

- David's concern: home EV chargers are fairly low-ticket (around £1k) and are often bought alongside the car, so lead value is limited. Heat pump leads are worth roughly 10x.
- **[Toby's decision]** Start with EV to get built and gain traffic. The main revenue focus is **commercial installs** (car parks, apartment blocks, workplaces). Build so the vertical is a config setting, so heat pumps (via MCS) can be added later.

## 16. David's niche-testing playbook

When judging a new vertical, test it on:
1. **Data backbone:** is there a public, bulk-usable list of providers?
2. **Purchase size:** is the job big enough for valuable leads?
3. **Market opacity:** is it hard for buyers to compare providers?
4. **Lead value:** what will providers pay per lead?
5. **Per-firm depth:** can each provider's profile be filled with real data?
6. **Search competition:** how strong are existing sites?
7. **Does the searcher choose the provider?** Or is it bundled with another purchase?
8. **Does data matter to the buyer?** Will records actually change their decision?
