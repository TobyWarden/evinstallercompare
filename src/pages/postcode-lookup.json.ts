// Postcode district -> town page, fetched by the homepage search only when someone searches.
// Contains public town URLs only.
import { getDirectory } from '../lib/data';

export function GET() {
  const lookup = getDirectory().postcodeLookup;
  const urls = [...new Set(Object.values(lookup))];
  const index = new Map(urls.map((u, i) => [u, i]));
  const outcodes = Object.fromEntries(Object.entries(lookup).map(([o, u]) => [o, index.get(u)]));
  return new Response(JSON.stringify({ towns: urls, outcodes }), { headers: { 'Content-Type': 'application/json' } });
}
