import type { AlertCategory } from '@/lib/alert-types';

export const MAP_FILL_HEX_BY_CATEGORY: Record<AlertCategory, string> = {
  rockets: '#ef4444',
  'hostile aircraft': '#ef4444',
  'early warning': '#facc15',
  'incident ended': '#22c55e',
  earthquake: '#f97316',
  tsunami: '#0ea5e9',
  hazmat: '#a855f7',
  terror: '#dc2626',
  unknown: '#6b7280',
};

export const MAP_OUTLINE_HEX_BY_CATEGORY: Record<AlertCategory, string> = {
  rockets: '#fca5a5',
  'hostile aircraft': '#fca5a5',
  'early warning': '#fef08a',
  'incident ended': '#86efac',
  earthquake: '#fdba74',
  tsunami: '#38bdf8',
  hazmat: '#d8b4fe',
  terror: '#fca5a5',
  unknown: '#9ca3af',
};

/** ביטוי Mapbox `match` ל־`fill-color` לפי `category` */
export function mapboxFillColorMatchExpression(): unknown[] {
  const flat: unknown[] = [];
  for (const [k, v] of Object.entries(MAP_FILL_HEX_BY_CATEGORY) as [AlertCategory, string][]) {
    flat.push(k, v);
  }
  return ['match', ['get', 'category'], ...flat, MAP_FILL_HEX_BY_CATEGORY.unknown];
}

export function mapboxOutlineColorMatchExpression(): unknown[] {
  const flat: unknown[] = [];
  for (const [k, v] of Object.entries(MAP_OUTLINE_HEX_BY_CATEGORY) as [AlertCategory, string][]) {
    flat.push(k, v);
  }
  return ['match', ['get', 'category'], ...flat, MAP_OUTLINE_HEX_BY_CATEGORY.unknown];
}
