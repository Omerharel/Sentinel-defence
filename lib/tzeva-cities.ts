/**
 * Tzeva Adom numeric `citiesIds` (WebSocket) → Hebrew label from live `cities.json`
 * (same source as tzevaadom.co.il). Names align with `city-name-en.map.ts` / `locations_polygons.json` where PHO uses the same spelling.
 */

const LISTS_VERSIONS_URL = 'https://api.tzevaadom.co.il/lists-versions';
const CITIES_JSON_BASE = 'https://www.tzevaadom.co.il/static/cities.json';

export async function loadTzevaCityIdToHebrew(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const verRes = await fetch(LISTS_VERSIONS_URL, { cache: 'no-store' });
    let version = 10;
    if (verRes.ok) {
      const ver = (await verRes.json()) as { cities?: number };
      if (typeof ver?.cities === 'number') version = ver.cities;
    }
    const res = await fetch(`${CITIES_JSON_BASE}?v=${version}`, { cache: 'no-store' });
    if (!res.ok) return map;
    const json = (await res.json()) as { cities?: Record<string, { id?: number; he?: string }> };
    const cities = json?.cities;
    if (!cities || typeof cities !== 'object') return map;
    for (const [cityValue, cityData] of Object.entries(cities)) {
      const id = cityData?.id;
      if (id == null) continue;
      const he = (cityData?.he ?? cityValue).trim();
      if (he) map.set(String(id), he);
    }
  } catch {
    // offline / CORS — empty map; WS handler uses placeholder labels
  }
  return map;
}
