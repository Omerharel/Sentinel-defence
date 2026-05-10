import type { AlertEvent } from '@/lib/alert-types';

/** Synthetic WebSocket events from `lib/tzeva-websocket.ts` use this id prefix. */
export const TZEWA_WS_EVENT_ID_PREFIX = 'tzeva-ws-';

/** Merge latest API poll with WebSocket-only rows (poll replaces HTTP-sourced events only). */
export function mergePollEventsWithWsHistory(
  apiEvents: AlertEvent[],
  prevHistory: AlertEvent[],
  maxItems: number,
): AlertEvent[] {
  const wsEvents = prevHistory.filter((e) => e.id.startsWith(TZEWA_WS_EVENT_ID_PREFIX));
  const byId = new Map<string, AlertEvent>();
  for (const e of apiEvents) byId.set(e.id, e);
  for (const e of wsEvents) {
    if (!byId.has(e.id)) byId.set(e.id, e);
  }
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, maxItems);
}

export function appendWsEventsToHistory(
  prev: AlertEvent[],
  incoming: AlertEvent[],
  maxItems: number,
): AlertEvent[] {
  const byId = new Map(prev.map((e) => [e.id, e]));
  for (const e of incoming) byId.set(e.id, e);
  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, maxItems);
}
