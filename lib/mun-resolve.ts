/**
 * Map Pikud Haoref / Oref area labels (often sub-zones like "חיפה - מפרץ") to
 * canonical Hebrew keys in `public/data/locations_polygons.json`.
 *
 * טעינת הקובץ: רק מ־`/data/locations_polygons.json` (פלט של `scripts/import-tzeva-polygons.mjs` — גיאומטריה מ־Tzeva static JSON).
 */

import { englishCityNameToHebrew, normalizeMunicipalityLabel } from '@/lib/city-name-en';

const LOCATIONS_POLYGONS_PATH = '/data/locations_polygons.json';

let polygonsJsonPromise: Promise<Record<string, unknown> | null> | null = null;

export function loadLocationsPolygonsJson(): Promise<Record<string, unknown> | null> {
  if (!polygonsJsonPromise) {
    const cache =
      process.env.NODE_ENV === 'development' ? 'no-store' : 'force-cache';
    polygonsJsonPromise = fetch(LOCATIONS_POLYGONS_PATH, { cache })
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, unknown>>) : null))
      .catch(() => null);
  }
  return polygonsJsonPromise;
}

export async function loadLocationsPolygonKeys(): Promise<string[]> {
  const json = await loadLocationsPolygonsJson();
  if (!json) return [];
  return Object.keys(json).filter((k) => k && !k.startsWith('_'));
}

/** Manual overrides where spelling or granularity differs. */
export const PHO_TO_MUN_HEB: Record<string, string> = {
  /** Keys must exist in `locations_polygons.json` — PHO sub-zones vs settlement names. */
  'תל אביב יפו': 'תל אביב - דרום העיר ויפו',
  'תל אביב -יפו': 'תל אביב - דרום העיר ויפו',
  'תל אביב - מרכז העיר': 'תל אביב - מרכז העיר',
  'תל אביב - מרכז': 'תל אביב - מרכז העיר',
  'תל אביב - דרום העיר ויפו': 'תל אביב - דרום העיר ויפו',
  'תל אביב - מזרח': 'תל אביב - מזרח',
  'תל אביב - עבר הירקון': 'תל אביב - עבר הירקון',
  'תל אביב': 'תל אביב - מרכז העיר',
  'קריית אונו': 'קרית אונו',
  'קריית אתא': 'קרית אתא',
  'קריית ביאליק': 'קרית ביאליק',
  'קריית גת': 'קרית גת',
  'קריית טבעון': 'קרית טבעון',
  'קריית ים': 'קרית ים',
  'קריית יערים': 'קרית יערים',
  'קריית מוצקין': 'קרית מוצקין',
  'קריית מלאכי': 'קרית מלאכי',
  'קריית עקרון': 'קרית עקרון',
  'קריית שמונה': 'קרית שמונה',
  'יהוד מונסון': 'יהוד -מונסון',
  'יהוד': 'יהוד -מונסון',
  'בנימינה גבעת עדה': 'בנימינה - גבעת עדה',
  'מודיעין מכבים רעות': 'מודיעין-מכבים-רעות',
  'פרדס חנה כרכור': 'פרדס חנה - כרכור',
  'קדימה צורן': 'קדימה - צורן',
};

function spellingVariants(name: string): string[] {
  const v = new Set<string>();
  v.add(name);
  v.add(name.replace(/קריית/g, 'קרית'));
  v.add(name.replace(/קרית/g, 'קריית'));
  return [...v];
}

/**
 * Resolve a Pikud label to the best matching `hebrew_name` key present in the GeoJSON.
 */
export function resolvePhoLabelToMunKey(city: string, munKeys: string[]): string {
  let c = normalizeMunicipalityLabel(city);
  if (!c) return c;

  const fromEn = englishCityNameToHebrew(c);
  if (fromEn) c = fromEn;

  const set = new Set(munKeys);
  if (set.has(c)) return c;

  const manual = PHO_TO_MUN_HEB[c];
  if (manual && set.has(manual)) return manual;

  for (const variant of spellingVariants(c)) {
    if (set.has(variant)) return variant;
    const m = PHO_TO_MUN_HEB[variant];
    if (m && set.has(m)) return m;
  }

  const sorted = [...munKeys].sort((a, b) => b.length - a.length);
  for (const key of sorted) {
    if (key.length < 2) continue;
    if (c.startsWith(`${key} -`) || c.startsWith(`${key}-`)) return key;
    if (c.startsWith(`${key} `) && c.length > key.length + 1) return key;
  }

  const firstSegment = c.split(' - ')[0]?.trim();
  if (firstSegment && firstSegment !== c) {
    if (set.has(firstSegment)) return firstSegment;
    for (const variant of spellingVariants(firstSegment)) {
      if (set.has(variant)) return variant;
    }
    const fm = PHO_TO_MUN_HEB[firstSegment];
    if (fm && set.has(fm)) return fm;
  }

  /** When GeoJSON has only Pikud sub-zones (e.g. "חיפה - מפרץ") but the feed sends the parent ("חיפה"). */
  const subZoneCandidates = munKeys.filter((k) => k.startsWith(`${c} - `));
  if (subZoneCandidates.length > 0) {
    return [...subZoneCandidates].sort((a, b) => a.localeCompare(b, 'he'))[0];
  }

  /** Keys in JSON may use different dash characters than the feed — compare normalized forms. */
  for (const k of munKeys) {
    if (normalizeMunicipalityLabel(k) === c) return k;
  }

  return c;
}
