/**
 * Display-only: translate Hebrew city/settlement names (Pikud/Oref style) to common English names.
 * Internal alert data stays Hebrew for map/geo matching.
 *
 * Keys with spaces must be quoted strings (invalid as bare identifiers).
 */
import { HEBREW_TO_ENGLISH } from '@/lib/city-name-en.map';

const HEBREW_TO_ENGLISH_MAP = HEBREW_TO_ENGLISH as Record<string, string>;

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Unify en/em dashes and spacing so feed strings match `locations_polygons.json` keys. */
export function normalizeMunicipalityLabel(s: string): string {
  return collapseSpaces(
    s
      .replace(/[\u2013\u2014\u2212]/g, '-')
      .replace(/\s*-\s*/g, ' - '),
  );
}

function normalizeHebrewKey(s: string): string {
  return collapseSpaces(s).replace(/\s*-\s*/g, '-');
}

const HEBREW_SCRIPT_RE = /\p{Script=Hebrew}/u;

function hebrewCompoundToEnglish(norm: string, depth = 0): string {
  if (depth > 8) return norm;
  const keys = Object.keys(HEBREW_TO_ENGLISH_MAP).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (norm === key) return HEBREW_TO_ENGLISH_MAP[key] ?? norm;
  }
  const sep = ' - ';
  for (const key of keys) {
    if (!norm.startsWith(key + sep)) continue;
    const suffix = norm.slice(key.length + sep.length).trim();
    const parentEn = HEBREW_TO_ENGLISH_MAP[key];
    if (!parentEn) continue;
    if (!suffix) return parentEn;
    const suffixEn = HEBREW_SCRIPT_RE.test(suffix)
      ? hebrewCompoundToEnglish(suffix, depth + 1)
      : suffix;
    return `${parentEn} - ${suffixEn}`;
  }
  return norm;
}

function alternateKiryatSpelling(s: string): string {
  if (s.includes('קריית')) return s.replaceAll('קריית', 'קרית');
  if (s.includes('קרית')) return s.replaceAll('קרית', 'קריית');
  return s;
}

export function cityNameToEnglish(hebrewName: string): string {
  const raw = normalizeMunicipalityLabel(hebrewName);
  if (!raw) return raw;

  if (raw === 'כל הארץ') return 'Nationwide';

  const settlementPlaceholder = /^יישוב\s*\((\d+)\)\s*$/u.exec(raw);
  if (settlementPlaceholder) {
    return `Locality (${settlementPlaceholder[1]})`;
  }

  const candidates = new Set<string>();
  candidates.add(raw);
  // Some data sources use double apostrophes (''), while our canonical keys use a single quote mark (").
  candidates.add(raw.replaceAll("''", '"'));
  candidates.add(collapseSpaces(raw));
  candidates.add(normalizeHebrewKey(raw));
  candidates.add(collapseSpaces(raw).replaceAll('-', ' '));
  candidates.add(normalizeHebrewKey(raw).replaceAll('-', ' '));

  // Common "City - area/municipal variant" style: also try the base city part.
  const split = raw.split(' - ');
  if (split.length > 1) {
    const base = split[0] ?? '';
    candidates.add(base);
    candidates.add(collapseSpaces(base));
    candidates.add(normalizeHebrewKey(base));
  }

  // Handle קרית/קריית variants without duplicating the table.
  for (const c of Array.from(candidates)) {
    candidates.add(alternateKiryatSpelling(c));
  }

  for (const c of candidates) {
    const mapped = HEBREW_TO_ENGLISH_MAP[c];
    if (mapped) return mapped;
  }

  if (HEBREW_SCRIPT_RE.test(raw)) {
    const compound = hebrewCompoundToEnglish(raw);
    if (compound !== raw) return compound;
  }

  return raw;
}

export function cityNamesToEnglishList(names: string[]): string {
  return names.map(cityNameToEnglish).join(', ');
}

let englishToHebrewCache: Record<string, string> | null = null;

function englishToHebrewMap(): Record<string, string> {
  if (!englishToHebrewCache) {
    const m: Record<string, string> = {};
    for (const [he, en] of Object.entries(HEBREW_TO_ENGLISH_MAP)) {
      const enKey = collapseSpaces(String(en));
      if (!enKey || m[enKey]) continue;
      m[enKey] = collapseSpaces(he);
    }
    englishToHebrewCache = m;
  }
  return englishToHebrewCache;
}

/** Map English labels (e.g. from UI) back to Hebrew keys used in `locations_polygons.json`. */
export function englishCityNameToHebrew(englishName: string): string | undefined {
  const k = collapseSpaces(englishName.replace(/[\u2013\u2014\u2212]/g, '-').replace(/\s*-\s*/g, ' - '));
  if (!k) return undefined;
  const m = englishToHebrewMap();
  return m[k] ?? m[collapseSpaces(k.replace(/-/g, ' '))];
}
