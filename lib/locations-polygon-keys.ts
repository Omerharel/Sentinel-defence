/**
 * Keys of `public/data/locations_polygons.json` (Hebrew labels) — same set `MapPanel` uses for geometry.
 */

const LOCATIONS_POLYGONS_PATH = '/data/locations_polygons.json';

export async function loadLocationsPolygonKeys(): Promise<string[]> {
  try {
    const res = await fetch(LOCATIONS_POLYGONS_PATH, { cache: 'force-cache' });
    if (!res.ok) return [];
    const json = (await res.json()) as Record<string, unknown>;
    return Object.keys(json).filter((k) => k && !k.startsWith('_'));
  } catch {
    return [];
  }
}
