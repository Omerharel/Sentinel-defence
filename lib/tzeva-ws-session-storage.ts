import type { AlertEvent } from './alert-types';
import { isAlertEventInListHistoryRetention } from './alert-normalize';
import { TZEWA_WS_EVENT_ID_PREFIX } from './tzeva-websocket';

const STORAGE_KEY = 'sentinel-tzeva-ws-events-v1';
const MAX_STORED = 400;

/**
 * שומר אירועי WebSocket (מקדים / סיום) ב־sessionStorage כדי שלא ייעלמו מהסליידר אחרי F5.
 * נשמר רק בטאב הנוכחי; לא עובר בין דפדפנים.
 */
export function readPersistedTzevaWsEvents(nowMs: number = Date.now()): AlertEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const out: AlertEvent[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const e = item as Partial<AlertEvent>;
      if (typeof e.id !== 'string' || !e.id.startsWith(TZEWA_WS_EVENT_ID_PREFIX)) continue;
      if (
        typeof e.city !== 'string' ||
        typeof e.timestamp !== 'string' ||
        typeof e.category !== 'string' ||
        typeof e.source !== 'string'
      ) {
        continue;
      }
      const ev = e as AlertEvent;
      if (!isAlertEventInListHistoryRetention(ev, nowMs)) continue;
      out.push(ev);
    }
    return out;
  } catch {
    return [];
  }
}

export function persistTzevaWsEvents(events: AlertEvent[], nowMs: number = Date.now()): void {
  if (typeof window === 'undefined') return;
  const ws = events.filter(
    (e) => e.id.startsWith(TZEWA_WS_EVENT_ID_PREFIX) && isAlertEventInListHistoryRetention(e, nowMs),
  );
  ws.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const trimmed = ws.slice(0, MAX_STORED);
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // quota / מצב פרטי
  }
}
