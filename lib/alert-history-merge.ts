import type { AlertEvent } from '@/lib/alert-types';
import { isAlertEventInListHistoryRetention } from '@/lib/alert-normalize';

/** מיזוג poll אחרון עם היסטוריית המפגש (לפי id); עדכון מה־API דורס גרסה ישנה של אותו id. */
export function mergePollIntoAlertHistory(
  apiEvents: AlertEvent[],
  prevHistory: AlertEvent[],
  maxItems: number,
  nowMs: number = Date.now(),
): AlertEvent[] {
  const byId = new Map<string, AlertEvent>();
  for (const e of prevHistory) {
    if (isAlertEventInListHistoryRetention(e, nowMs)) byId.set(e.id, e);
  }
  for (const e of apiEvents) {
    byId.set(e.id, e);
  }
  return Array.from(byId.values())
    .filter((e) => isAlertEventInListHistoryRetention(e, nowMs))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, maxItems);
}
