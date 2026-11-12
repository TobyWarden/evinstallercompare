// Stats and FAQ copy for location pages, computed from the installers listed there.
import type { PublicInstaller } from './data';
import { config, serviceRadiusMiles, commercialServiceRadiusMiles } from './data';

/** Plain-English listing rule, e.g. "within 10 miles (25 miles for installers who do commercial work)". */
export const radiusRule =
  commercialServiceRadiusMiles > serviceRadiusMiles
    ? `within ${serviceRadiusMiles} miles (${commercialServiceRadiusMiles} miles for installers who do commercial work)`
    : `within ${serviceRadiusMiles} miles`;

export interface LocationStats {
  total: number;
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
    commercial: installers.filter((i) => i.serves_commercial).length,
    homeOnly: installers.filter((i) => i.serves_home && !i.serves_commercial).length,
    medianYears: years.length ? (years.length % 2 ? years[mid] : Math.round((years[mid - 1] + years[mid]) / 2)) : null,
    withYears: years.length,
  };
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function locationFaqs(place: string, s: LocationStats, lastChecked: string | null, scope: 'town' | 'county') {
  const where = scope === 'town' ? `based ${radiusRule} of ${place}` : `across ${place}`;
  return [
    {
      q: `How many EV charger installers are there in ${place}?`,
      a: `We list ${plural(s.total, 'OZEV-approved installer')} ${where}.`,
    },
    {
      q: `Can I get a charger installed at a business or workplace in ${place}?`,
      a: s.commercial
        ? `Yes. ${s.commercial} of the ${plural(s.total, 'installer')} listed here take on commercial installations as well as homes.`
        : `None of the installers listed here say they take on commercial work. Try a nearby town, or send us an enquiry and we'll look further afield.`,
    },
    {
      q: 'What does OZEV approved mean?',
      a: `The Office for Zero Emission Vehicles (OZEV) keeps a list of installers approved to fit chargepoints, published on GOV.UK.${lastChecked ? ` We last checked our listings against it on ${formatDate(lastChecked)}.` : ''}`,
    },
    {
      q: 'How do I get a quote?',
      a: `Use our quote form. Tell us your postcode and what you need, and we'll pass your enquiry to suitable installers. We don't share installers' contact details on ${config.site.name}.`,
    },
  ];
}

export function formatDate(iso: string) {
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
