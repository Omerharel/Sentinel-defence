import type { AlertEvent } from '@/lib/alert-types';
import { getRegionIdForCity } from '@/lib/alert-geo';

const TLV = 'תל אביב - מרכז העיר';
const HAIFA = 'חיפה - מפרץ';
const EILAT = 'אילת';
const BEER_SHEVA_EAST = 'באר שבע - מזרח';

/**
 * התראות דמו — מפתחות מ־`locations_polygons.json`.
 * חלונות זמן רצופים בלי חפיפה כדי שהטיימליין יציג פס אחד: צהוב צר → אדום/כתום רחב → טורקיז צר.
 */
export function buildDemoAlertEvents(nowMs: number): AlertEvent[] {
  const id = (suffix: string) => `demo-${nowMs}-${suffix}`;

  const earlyStart = nowMs - 360_000;
  const earlyEnd = nowMs - 330_000;
  const rocketsStart = earlyEnd;
  const rocketsEnd = nowMs - 210_000;
  const hostileStart = rocketsEnd;
  const hostileEnd = nowMs - 120_000;
  const endedStart = hostileEnd;
  const endedEnd = nowMs - 95_000;

  return [
    {
      id: id('eilat-early'),
      city: EILAT,
      timestamp: new Date(earlyStart).toISOString(),
      expiresAt: new Date(earlyEnd).toISOString(),
      source: 'oref',
      category: 'early warning',
      polygonId: getRegionIdForCity(EILAT),
    },
    {
      id: id('tlv-rockets'),
      city: TLV,
      timestamp: new Date(rocketsStart).toISOString(),
      expiresAt: new Date(rocketsEnd).toISOString(),
      source: 'oref',
      category: 'rockets',
      polygonId: getRegionIdForCity(TLV),
    },
    {
      id: id('haifa-hostile'),
      city: HAIFA,
      timestamp: new Date(hostileStart).toISOString(),
      expiresAt: new Date(hostileEnd).toISOString(),
      source: 'oref',
      category: 'hostile aircraft',
      polygonId: getRegionIdForCity(HAIFA),
    },
    {
      id: id('beer-ended'),
      city: BEER_SHEVA_EAST,
      timestamp: new Date(endedStart).toISOString(),
      expiresAt: new Date(endedEnd).toISOString(),
      source: 'oref',
      category: 'incident ended',
      endedCategory: 'rockets',
      polygonId: getRegionIdForCity(BEER_SHEVA_EAST),
    },
    /** כטב״ם פעיל בת״א — לתצוגת דמו במפה (פוליגון + צבעים) בזמן אמת */
    (() => {
      const t0 = nowMs - 60_000;
      return {
        id: id('tlv-hostile-active'),
        city: TLV,
        timestamp: new Date(t0).toISOString(),
        expiresAt: new Date(t0 + 10 * 60 * 1000).toISOString(),
        source: 'oref',
        category: 'hostile aircraft',
        polygonId: getRegionIdForCity(TLV),
      } satisfies AlertEvent;
    })(),
  ];
}
