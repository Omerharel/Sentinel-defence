import type { AlertEvent } from '@/lib/alert-types';
import {
  ALERT_CATEGORY_TTL_MS,
  inferEndedCategoryFromHebrewTitle,
  isHistoryRowEarlyWarning,
  isHistoryRowIncidentEnded,
  mapHistoryCategoryCode,
  parseHistoryAlertDateToIso,
  type AlertHistoryRow,
} from '@/lib/alert-normalize';
import { getRegionIdForCity } from '@/lib/alert-geo';
import { orefAlertTitleToPikudCategory } from '@/lib/fetch-oref-map-proxy-rows';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** שורה מ־`/api/day-history` של oref-map (Cloudflare R2 / proxy). */
export interface OrefDayHistoryEntry {
  rid?: string | number;
  data?: unknown;
  category_desc?: string;
  alertDate?: string;
}

function normalizeAlertDateRaw(raw: string): string {
  return raw.trim().replace('T', ' ').slice(0, 19);
}

/**
 * ממיר מערך day-history לאירועי {@link AlertEvent} (מקור oref), עם dedupe כמו באתר המקורי.
 * @see https://github.com/maorcc/oref-map/blob/main/web/index.html fetchExtendedHistory
 */
export function normalizeOrefDayHistoryToEvents(entries: unknown, nowMs: number = Date.now()): AlertEvent[] {
  if (!Array.isArray(entries)) return [];

  const seenRid = new Set<string>();
  const seenComposite = new Set<string>();
  const out: AlertEvent[] = [];
  let fallbackI = 0;

  for (const raw of entries) {
    if (!isRecord(raw)) continue;
    const e = raw as OrefDayHistoryEntry;
    const titleRaw = e.category_desc;
    if (typeof titleRaw !== 'string') continue;
    const title = titleRaw.replace(/\s+/g, ' ').trim();
    if (!title) continue;

    const city =
      typeof e.data === 'string' ? e.data.trim() : e.data != null ? String(e.data).trim() : '';
    if (!city) continue;

    const alertDateRaw = e.alertDate;
    if (typeof alertDateRaw !== 'string' || !alertDateRaw.trim()) continue;
    const alertDate = normalizeAlertDateRaw(alertDateRaw);
    if (!alertDate) continue;

    const rid = e.rid != null && String(e.rid).trim() !== '' ? String(e.rid).trim() : '';
    const compositeKey = `${city}|${alertDate.replace('T', ' ')}|${title}`;
    if (rid && seenRid.has(rid)) continue;
    if (seenComposite.has(compositeKey)) continue;
    if (rid) seenRid.add(rid);
    seenComposite.add(compositeKey);

    const categoryCode = orefAlertTitleToPikudCategory(title);
    const row: AlertHistoryRow = { alertDate, title, data: city, category: categoryCode };
    const isEnded = isHistoryRowIncidentEnded(row);
    const category = isEnded
      ? 'incident ended'
      : isHistoryRowEarlyWarning(row)
        ? 'early warning'
        : mapHistoryCategoryCode(categoryCode);

    const timestamp = parseHistoryAlertDateToIso(alertDate);
    const timestampMs = Date.parse(timestamp);
    if (Number.isNaN(timestampMs)) continue;

    const ttlMs = ALERT_CATEGORY_TTL_MS[category];
    const expiresAt = new Date(timestampMs + ttlMs).toISOString();
    const id = rid ? `oref-day-${rid}` : `oref-day-fb-${alertDate}-${city}-${categoryCode}-${fallbackI++}`;

    out.push({
      id,
      city,
      timestamp,
      expiresAt,
      source: 'oref',
      category,
      endedCategory: isEnded ? inferEndedCategoryFromHebrewTitle(title) : undefined,
      polygonId: getRegionIdForCity(city),
    });
  }

  out.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return out;
}

function orefDedupKey(e: AlertEvent): string {
  const t = Date.parse(e.timestamp);
  const sec = Number.isNaN(t) ? 0 : Math.floor(t / 1000);
  return `${e.city}|${sec}|${e.category}`;
}

function mergePoolKey(e: AlertEvent): string {
  if (e.source === 'tzevaadom') return `tzeva:${e.id}`;
  return `oref:${orefDedupKey(e)}`;
}

/**
 * איחוד day-history עם מצב המפגש: צבע אדום מקובע לפי עיר+שנייה+קטגוריה כדי לא לשכפל אותה התראה
 * משני מקורות (מזהי `oref-…` מול `oref-day-…`).
 */
export function mergeDayHistoryWithSessionPool(day: AlertEvent[], session: AlertEvent[]): AlertEvent[] {
  const byKey = new Map<string, AlertEvent>();
  for (const e of day) byKey.set(mergePoolKey(e), e);
  for (const e of session) {
    if (e.source === 'tzevaadom') {
      byKey.set(mergePoolKey(e), e);
      continue;
    }
    const k = mergePoolKey(e);
    if (!byKey.has(k)) byKey.set(k, e);
  }
  return Array.from(byKey.values());
}

/** מסנן אירועים שרלוונטיים לטווח ציר (לפי timestamp או חלון פעיל חופף). */
export function alertEventsTouchingRange(
  events: AlertEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
): AlertEvent[] {
  return events.filter((e) => {
    const t = Date.parse(e.timestamp);
    if (Number.isNaN(t)) return false;
    const exp = Date.parse(e.expiresAt ?? '');
    const end = Number.isNaN(exp) ? t + (ALERT_CATEGORY_TTL_MS[e.category] ?? 0) : exp;
    return t <= rangeEndMs && end >= rangeStartMs;
  });
}
