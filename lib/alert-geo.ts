import type { AlertEvent } from '@/lib/alert-types';

type LngLat = [number, number];

function hashString(input: string) {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/** Approximate map point when no polygon exists in `locations_polygons.json`. */
export function getFallbackLngLatForCity(city: string): LngLat {
  return fallbackCoordinate(city);
}

function fallbackCoordinate(city: string): LngLat {
  const hash = hashString(city);
  const lng = 34.2 + (hash % 1400) / 1000;
  const lat = 29.8 + ((hash / 10) % 3400) / 1000;
  return [Number(lng.toFixed(4)), Number(lat.toFixed(4))];
}

function stablePolygonIdForCity(city: string): string {
  return `generated-${city}`
    .replace(/\s+/g, '-')
    .replace(/[^\w\u0590-\u05FF-]/g, '')
    .toLowerCase();
}

export function getRegionIdForCity(city: string) {
  return stablePolygonIdForCity(city);
}
