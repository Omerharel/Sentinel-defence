import { TZDate } from '@date-fns/tz';

import type { AlertCategory, AlertEvent, AlertEventSource, AlertsResponse } from '@/lib/alert-types';
import { getRegionIdForCity } from '@/lib/alert-geo';


const PIKUD_CATEGORY_EARLY_WARNING = 7;
/** ב־CSV של [dleshem/israel-alerts-data](https://github.com/dleshem/israel-alerts-data) מקדים מקודד כ־14 עם כותרת "בדקות הקרובות…". */
const DLESHEM_CSV_EARLY_WARNING_CATEGORY = 14;
const PIKUD_CATEGORY_EVENT_ENDED = 13;

const EARLY_WARNING_TITLE = 'התרעה מקדימה';
const ENDED_TITLE = 'האירוע הסתיים';


const SESSION_ALERT_HISTORY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;


/**
 * חלון פעיל קצר למקדים ולסיום אירוע — `expiresAt`, רשימה, מפה וציר (כרגע 2.5 דק׳ לשניהם).
 * @see {@link INCIDENT_ENDED_ACTIVE_TTL_MS} — alias לסיום אירוע בלבד (אותו ערך).
 */
export const EARLY_WARNING_AND_ENDED_TTL_MS = 2.5 * MIN_MS;

export const INCIDENT_ENDED_ACTIVE_TTL_MS = EARLY_WARNING_AND_ENDED_TTL_MS;

/** TTL לפי קטגוריה ל־`expiresAt` / חלון פעיל (מצב רגיל). */
export const ALERT_CATEGORY_TTL_MS: Record<AlertCategory, number> = {
  rockets: 2 * MIN_MS,
  'hostile aircraft': 2 * MIN_MS,
  'early warning': EARLY_WARNING_AND_ENDED_TTL_MS,
  'incident ended': INCIDENT_ENDED_ACTIVE_TTL_MS,
  earthquake: 5 * MIN_MS,
  tsunami: 5 * MIN_MS,
  hazmat: 4 * MIN_MS,
  terror: 4 * MIN_MS,
  unknown: 2 * MIN_MS,
};

/** קודי קטגוריה בשורות היסטוריה (פיקוד / Pikud-shaped). */
const HISTORY_CATEGORY_CODE_MAP: Record<number, AlertCategory> = {
  1: 'rockets',
  2: 'hostile aircraft',
  [PIKUD_CATEGORY_EARLY_WARNING]: 'early warning',
  [DLESHEM_CSV_EARLY_WARNING_CATEGORY]: 'early warning',
  [PIKUD_CATEGORY_EVENT_ENDED]: 'incident ended',
  3: 'earthquake',
  4: 'tsunami',
  5: 'hazmat',
  6: 'terror',
};

type EndedCategory = NonNullable<AlertEvent['endedCategory']>;

/** כותרות “האירוע הסתיים” ודומות — ל־`endedCategory`. */
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

/** `now` ∈ [timestamp, expiresAt]. אם `expiresAt` חסר/לא תקין — משתמשים ב־TTL לפי קטגוריה (כמו ציר הזמן). */
export function isAlertEventInActiveWindow(e: AlertEvent, nowMs: number): boolean {
  const t = Date.parse(e.timestamp);
  if (Number.isNaN(t)) return false;
  let endMs = Date.parse(e.expiresAt ?? '');
  if (Number.isNaN(endMs)) {
    const ttl = ALERT_CATEGORY_TTL_MS[e.category];
    endMs = t + (Number.isFinite(ttl) ? ttl : 0);
  }
  return nowMs >= t && nowMs <= endMs;
}

/**
 * היסטוריית מפגש: עד 24 שעות אחרי `timestamp` או בחלון פעיל (לפי קטגוריה).
 * משמש מפה + סליידר + מיזוג poll.
 */
export const ALERT_LIST_HISTORY_RETENTION_MS = SESSION_ALERT_HISTORY_MS;

/**
 * פאנל ימני + יישור מפה ליד "עכשיו": אותו חלון פעיל כמו `expiresAt` / TTL (~2.5 דק׳ למקדים ולסיום אירוע).
 */
export function isAlertEventInRightPanelListWindow(e: AlertEvent, nowMs: number): boolean {
  return isAlertEventInActiveWindow(e, nowMs);
}

/** Active TTL window, or timestamp within last {@link ALERT_LIST_HISTORY_RETENTION_MS}. */
export function isAlertEventInListHistoryRetention(e: AlertEvent, nowMs: number): boolean {
  const t = Date.parse(e.timestamp);
  if (Number.isNaN(t) || t > nowMs) return false;
  if (isAlertEventInActiveWindow(e, nowMs)) return true;
  return nowMs - t <= ALERT_LIST_HISTORY_RETENTION_MS;
}

export function mapHistoryCategoryCode(type: unknown): AlertCategory {
  const code = Number(type);
  if (!Number.isFinite(code)) return 'unknown';
  return HISTORY_CATEGORY_CODE_MAP[code] ?? 'unknown';
}

/** `YYYY-MM-DD HH:mm:ss` או `YYYY-MM-DDTHH:mm:ss` (חותך עד שניות) → ms UTC, או `null`. */
export function parseHistoryAlertDateToEpochMs(alertDate: string): number | null {
  const s = alertDate.trim().replace('T', ' ').slice(0, 19);
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) return null;
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
  const t = local.getTime();
  return Number.isNaN(t) ? null : t;
}

/** `alertDate` is Israel local wall time without offset — interpret as `Asia/Jerusalem`. */
export function parseHistoryAlertDateToIso(alertDate: string): string {
  const ms = parseHistoryAlertDateToEpochMs(alertDate);
  if (ms === null) return new Date().toISOString();
  return new Date(ms).toISOString();
}

/** שורה שטוחה לפני נירמול (למשל מ־oref-map). */
export interface AlertHistoryRow {
  alertDate: string;
  title: string;
  data: string;
  category?: number;
}

export function isHistoryRowIncidentEnded(row: AlertHistoryRow): boolean {
  if (row.category !== undefined && Number(row.category) === PIKUD_CATEGORY_EVENT_ENDED) return true;
  const t = (row.title ?? '').trim();
  return t === ENDED_TITLE || t.includes('הסתיים');
}

/** התרעה מקדימה: קוד 7 / 14 (CSV dleshem) או כותרות סטנדרטיות. */
export function isHistoryRowEarlyWarning(row: AlertHistoryRow): boolean {
  if (row.category !== undefined) {
    const c = Number(row.category);
    if (c === PIKUD_CATEGORY_EARLY_WARNING || c === DLESHEM_CSV_EARLY_WARNING_CATEGORY) return true;
  }
  const t = (row.title ?? '').trim();
  if (t === EARLY_WARNING_TITLE || t.includes('התרעה מקדימה')) return true;
  if (t === 'בדקות הקרובות צפויות להתקבל התרעות באזורך') return true;
  return false;
}

export function normalizeAlertHistoryPayload(
  payload: unknown,
  options?: {
    maxEvents?: number;
    /** כמה שורות מקסימום לסרוק מתוך המערך (לפני retention) — לסליידר/היסטוריה עמוקה */
    scanCap?: number;
    nowMs?: number;
  },
): AlertsResponse {
  const fetchedAt = new Date().toISOString();
  const maxEvents = options?.maxEvents ?? 2000;
  const scanCap = Math.min(Math.max(options?.scanCap ?? 2500, 100), 20000);
  const nowMs = options?.nowMs ?? Date.now();
  const eventSource: AlertEventSource = 'oref';
  const idPrefix = 'oref';

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

  const rows = payload as AlertHistoryRow[];
  const rowsWithData = rows.filter((r) => r && typeof r.data === 'string');

  /**
   * פידי היסטוריה לעיתים מחזירים מערך מישן→חדש. סריקה של `scanCap` הראשונות בלי מיון
   * זורקת אירועים אחרונים (מקדים/סיום וכו').
   */
  const rowsNewestFirst = [...rowsWithData].sort((a, b) => {
    const ta = parseHistoryAlertDateToEpochMs(a.alertDate ?? '') ?? Number.NEGATIVE_INFINITY;
    const tb = parseHistoryAlertDateToEpochMs(b.alertDate ?? '') ?? Number.NEGATIVE_INFINITY;
    return tb - ta;
  });

  const rawEvents: AlertEvent[] = [];
  const rowLimit = Math.min(rowsNewestFirst.length, scanCap);
  for (let i = 0; i < rowLimit; i++) {
    const row = rowsNewestFirst[i];
    const city = row.data.trim();
    if (!city) continue;

    const isEnded = isHistoryRowIncidentEnded(row);
    const category = isEnded
      ? 'incident ended'
      : isHistoryRowEarlyWarning(row)
        ? 'early warning'
        : mapHistoryCategoryCode(row.category);
    const timestamp = parseHistoryAlertDateToIso(row.alertDate ?? '');
    const timestampMs = Date.parse(timestamp);
    if (Number.isNaN(timestampMs)) continue;
    const ttlMs = ALERT_CATEGORY_TTL_MS[category];
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

  const inRetention = rawEvents.filter((e) => isAlertEventInListHistoryRetention(e, nowMs));

  const sorted = [...inRetention].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));

  let events = sorted;
  if (events.length > maxEvents) {
    events = events.slice(0, maxEvents);
  }

  return {
    ok: true,
    source: eventSource,
    fetchedAt,
    title: 'Red Alert',
    hasActiveAlerts: events.some(
      (e) => e.category !== 'incident ended' && isAlertEventInActiveWindow(e, nowMs),
    ),
    events,
    rawCount: rowsWithData.length,
  };
}
