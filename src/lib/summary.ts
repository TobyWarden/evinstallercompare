// Stats and copy for location and profile pages, computed from the installers listed there.
// All trade-specific words come from config.vertical, so a new vertical needs no template edits.
import type { PublicInstaller } from './data';
import { config, vertical, primarySource, serviceRadiusMiles, commercialServiceRadiusMiles } from './data';

const cert = vertical.certification;

/** Plain-English listing rule, e.g. "within 10 miles (25 miles for installers who do commercial work)". */
export const radiusRule =
  commercialServiceRadiusMiles > serviceRadiusMiles
    ? `within ${serviceRadiusMiles} miles (${commercialServiceRadiusMiles} miles for installers who do commercial work)`
    : `within ${serviceRadiusMiles} miles`;

export interface LocationStats {
  total: number;
  certified: number;
  commercial: number;
  homeOnly: number;
  medianYears: number | null;
  withYears: number;
}

export function summarise(installers: PublicInstaller[]): LocationStats {
  const years = installers.map((i) => i.years_trading).filter((y): y is number => y !== null).sort((a, b) => a - b);
  const mid = Math.floor(years.length / 2);
  return {
    total: installers.length,
    certified: installers.filter((i) => i.certified).length,
    commercial: installers.filter((i) => i.serves_commercial).length,
    homeOnly: installers.filter((i) => i.serves_home && !i.serves_commercial).length,
    medianYears: years.length ? (years.length % 2 ? years[mid] : Math.round((years[mid - 1] + years[mid]) / 2)) : null,
    withYears: years.length,
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const titleCase = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
export function formatMonth(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}
/** Year of the data (not the build clock), for page titles such as "(2026)". */
export const dataYear = (lastChecked: string | null) => (lastChecked ? lastChecked.slice(0, 4) : '');

/** "Data refreshed November 2026 · Sources: …" line shown under location page intros. */
export function sourcesLine(lastChecked: string | null) {
  const names = [primarySource.sourceName, 'Companies House'];
  return `${lastChecked ? `Data refreshed ${formatMonth(lastChecked)} · ` : ''}Sources: ${names.join(', ')}`;
}

export function locationFaqs(place: string, s: LocationStats, lastChecked: string | null, scope: 'town' | 'county') {
  const where = scope === 'town' ? `based ${radiusRule} of ${place}` : `across ${place}`;
  return [
    {
      q: `How many ${vertical.trades} are there in ${place}?`,
      a: `We list ${plural(s.total, `${cert.approvedAdj} installer`)} ${where}.`,
    },
    {
      q: `Can I get a ${vertical.product} installed at a business or workplace in ${place}?`,
      a: s.commercial
        ? `Yes. ${s.commercial} of the ${plural(s.total, 'installer')} listed here take on commercial installations as well as homes.`
        : `None of the installers listed here say they take on commercial work. Try a nearby town, or send us an enquiry and we'll look further afield.`,
    },
    {
      q: `What does ${cert.approved} mean?`,
      a: `${cert.about}${lastChecked ? ` We last checked our listings against it on ${formatDate(lastChecked)}.` : ''}`,
    },
    {
      q: 'How do I get a quote?',
      a: `Use the form on this page. Tell us your postcode and what you need. We don't share installers' contact details on ${config.site.name}.`,
    },
  ];
}

export function installerFaqs(i: PublicInstaller) {
  return [
    {
      q: `Is ${i.company_name} ${cert.approved}?`,
      a: i.certified
        ? `Yes. ${i.company_name} was on the ${primarySource.sourceName} list when we checked on ${formatDate(i.retrieved_at)}.`
        : `${i.company_name} was not on the ${primarySource.sourceName} list when we checked on ${formatDate(i.retrieved_at)}.`,
    },
    {
      q: `Is ${i.company_name} a registered company?`,
      a: i.incorporated_on
        ? `Yes. Companies House shows it was incorporated on ${formatDate(i.incorporated_on)}${i.company_number ? ` (company number ${i.company_number})` : ''}.`
        : `We haven't matched it to a Companies House record yet. It may trade as a sole trader or partnership.`,
    },
    {
      q: `Which areas does ${i.company_name} cover?`,
      a: i.towns.length
        ? `We list it in ${plural(i.towns.length, 'town')} within ${i.radius_miles} miles of its base${i.base_town ? ` in ${i.base_town.name}` : ''}.`
        : `We don't list it in any town yet.`,
    },
  ];
}
