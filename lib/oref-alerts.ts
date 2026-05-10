import { TZDate } from '@date-fns/tz';

import type { AlertCategory, AlertEvent, AlertEventSource, AlertsResponse } from '@/lib/alert-types';
import { getRegionIdForCity } from '@/lib/alert-geo';

/** Category 13 = event ended ("האירוע הסתיים"). */
const OREF_CATEGORY_EVENT_ENDED = 13;

const ENDED_TITLE = 'האירוע הסתיים';

/** TTL per alert category (in milliseconds). */
export const OREF_EVENT_TTL_BY_CATEGORY: Record<AlertCategory, number> = {
  rockets: 10 * 60 * 1000,
  'hostile aircraft': 10 * 60 * 1000,
  'early warning': 120 * 1000,
  'incident ended': 120 * 1000,
  earthquake: 5 * 60 * 1000,
  tsunami: 5 * 60 * 1000,
  hazmat: 4 * 60 * 1000,
  terror: 4 * 60 * 1000,
  unknown: 120 * 1000,
};

const EARLY_WARNING_SUPERSEDED_DELAY_MS = 30 * 1000;

const OREF_CATEGORY_MAP: Record<number, AlertCategory> = {
  1: 'rockets',
  2: 'hostile aircraft',
  7: 'early warning',
  13: 'incident ended',
  3: 'earthquake',
  4: 'tsunami',
  5: 'hazmat',
  6: 'terror',
};

type EndedCategory = NonNullable<AlertEvent['endedCategory']>;

/** Used by Tzeva WebSocket system messages and Pikud "האירוע הסתיים" rows. */
export function inferEndedCategoryFromHebrewTitle(title: string): EndedCategory | undefined {
  const t = title.trim();
  if (!t) return undefined;

  if (/כטב|כלי טיס|רחפן/u.test(t)) return 'hostile aircraft';
  if (/רעידת\s*אדמה/u.test(t)) return 'earthquake';
  if (/צונאמי/u.test(t)) return 'tsunami';
  if (/חומ(ר|רי)\s*מסוכ/u.test(t)) return 'hazmat';
  if (/מחבל|טרור/u.test(t)) return 'terror';
  if (/רקט|טיל/u.test(t)) return 'rockets';

  return undefined;
}

export function mapOrefCategory(type: unknown): AlertCategory {
  const code = Number(type);
  if (!Number.isFinite(code)) return 'unknown';
  return OREF_CATEGORY_MAP[code] ?? 'unknown';
}

/** Pikud `alertDate` is Israel local wall time without timezone — use IANA `Asia/Jerusalem` (IST/IDT). */
export function parseOrefAlertDateToIso(alertDate: string): string {
  const s = alertDate.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return new Date().toISOString();
  const [, y, mo, d, h, mi, sec] = m;
  const local = new TZDate(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec),
    'Asia/Jerusalem',
  );
  if (Number.isNaN(local.getTime())) return new Date().toISOString();
  return new Date(local.getTime()).toISOString();
}

export interface OrefHistoryRow {
  alertDate: string;
  title: string;
  data: string;
  category?: number;
}

export function isOrefEndedRow(row: OrefHistoryRow): boolean {
  if (row.category !== undefined && Number(row.category) === OREF_CATEGORY_EVENT_ENDED) return true;
  const t = (row.title ?? '').trim();
  return t === ENDED_TITLE || t.includes('הסתיים');
}

export function normalizeOrefHistoryPayload(
  payload: unknown,
  options?: { maxEvents?: number; nowMs?: number; eventSource?: AlertEventSource },
): AlertsResponse {
  const fetchedAt = new Date().toISOString();
  const maxEvents = options?.maxEvents ?? 2000;
  const nowMs = options?.nowMs ?? Date.now();
  const eventSource: AlertEventSource = options?.eventSource ?? 'oref';
  const idPrefix = eventSource === 'tzevaadom' ? 'tzeva' : 'oref';

  if (!Array.isArray(payload)) {
    return {
      ok: true,
      source: eventSource,
      fetchedAt,
      title: 'Red Alert',
      hasActiveAlerts: false,
      events: [],
      rawCount: 0,
    };
  }

  const rows = payload as OrefHistoryRow[];
  const rowsWithData = rows.filter((r) => r && typeof r.data === 'string');

  const rawEvents: AlertEvent[] = [];
  const scanCap = Math.min(rowsWithData.length, 2500);
  for (let i = 0; i < scanCap; i++) {
    const row = rowsWithData[i];
    const city = row.data.trim();
    if (!city) continue;

    const isEnded = isOrefEndedRow(row);
    const category = isEnded ? 'incident ended' : mapOrefCategory(row.category);
    const timestamp = parseOrefAlertDateToIso(row.alertDate ?? '');
    const timestampMs = Date.parse(timestamp);
    if (Number.isNaN(timestampMs)) continue;
    const ttlMs = OREF_EVENT_TTL_BY_CATEGORY[category];
    const expiresAt = new Date(timestampMs + ttlMs).toISOString();
    const id = `${idPrefix}-${row.alertDate}-${city}-${row.category ?? 'x'}-${i}`;

    rawEvents.push({
      id,
      city,
      timestamp,
      expiresAt,
      source: eventSource,
      category,
      endedCategory: isEnded ? inferEndedCategoryFromHebrewTitle(row.title ?? '') : undefined,
      polygonId: getRegionIdForCity(city),
    });
  }

  const inWindow = rawEvents.filter((e) => {
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t)) return false;
    const exp = Date.parse(e.expiresAt ?? '');
    if (Number.isNaN(exp)) return false;
    return nowMs >= t && nowMs <= exp;
  });

  const byCity = new Map<string, AlertEvent[]>();
  for (const event of inWindow) {
    const arr = byCity.get(event.city);
    if (arr) {
      arr.push(event);
    } else {
      byCity.set(event.city, [event]);
    }
  }

  const supersededIds = new Set<string>();
  for (const cityEvents of byCity.values()) {
    const ordered = [...cityEvents].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    for (let i = 0; i < ordered.length; i++) {
      const current = ordered[i];
      const currentTime = Date.parse(current.timestamp);
      if (Number.isNaN(currentTime)) continue;

      if (current.category === 'early warning') {
        const escalation = ordered.slice(i + 1).find((next) => {
          const nextTime = Date.parse(next.timestamp);
          if (Number.isNaN(nextTime) || nextTime < currentTime) return false;
          return next.category === 'rockets' || next.category === 'hostile aircraft';
        });

        if (escalation) {
          const escalationTime = Date.parse(escalation.timestamp);
          if (!Number.isNaN(escalationTime) && nowMs - escalationTime >= EARLY_WARNING_SUPERSEDED_DELAY_MS) {
            supersededIds.add(current.id);
          }
        }
      }

    }
  }

  const visibleEvents = inWindow.filter((e) => !supersededIds.has(e.id));

  const sorted = [...visibleEvents].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  let events = sorted;
  if (events.length > maxEvents) {
    events = events.slice(0, maxEvents);
  }

  return {
    ok: true,
    source: eventSource,
    fetchedAt,
    title: 'Red Alert',
    hasActiveAlerts: events.some((e) => e.category !== 'incident ended'),
    events,
    rawCount: rowsWithData.length,
  };
}
