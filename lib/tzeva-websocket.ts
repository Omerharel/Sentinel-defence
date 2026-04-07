/**
 * Tzeva Adom WebSocket `SYSTEM_MESSAGE` — התרעה מקדימה (`instructionType === 0`), סיום אירוע (`=== 1`),
 * כש־`NEXT_PUBLIC_TZEWA_WS_PROXY_URL` מוגדר. כבוי: `NEXT_PUBLIC_SENTINEL_DISABLE_TZEWA_WS=1`.
 */

import type { AlertEvent } from './alert-types';
import { getRegionIdForCity } from './alert-geo';
import {
  EARLY_WARNING_AND_ENDED_TTL_MS,
  INCIDENT_ENDED_ACTIVE_TTL_MS,
  inferEndedCategoryFromHebrewTitle,
} from './alert-normalize';

/** `1` — לא לפתוח WebSocket לצבע אדום (גם אם מוגדר URL). */
export function isTzevaWebSocketDisabled(): boolean {
  return process.env.NEXT_PUBLIC_SENTINEL_DISABLE_TZEWA_WS === '1';
}

/**
 * WebSocket URL for the browser (typically your `alerts-proxy` path), e.g. `wss://host/tzeva-socket`.
 * If unset or disabled, {@link connectTzevaWebSocket} does not open a connection.
 */
export function getTzevaWebSocketClientUrl(): string {
  if (isTzevaWebSocketDisabled()) return '';
  return process.env.NEXT_PUBLIC_TZEWA_WS_PROXY_URL?.trim() ?? '';
}

/** כמו ב־`tzofar-site/static/js/app.js` — `SYSTEM_MESSAGE.instructionType`. */
export const TZEWA_INSTRUCTION_EARLY_WARNING = 0;
/** סיום אירוע */
export const TZEWA_INSTRUCTION_END_EVENT = 1;

/** Prefix for WS-built `AlertEvent.id` values (e.g. sessionStorage persistence). */
export const TZEWA_WS_EVENT_ID_PREFIX = 'tzeva-ws-';

export interface TzevaSystemMessagePayload {
  id?: number | string;
  instructionType?: number | null;
  citiesIds?: number[];
  /** Unix seconds */
  time?: number;
  titleHe?: string;
  bodyHe?: string;
  titleEn?: string;
  bodyEn?: string;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Server may send ms; normalize to unix seconds. */
function coerceTzevaUnixSeconds(time: unknown): number {
  const now = Math.floor(Date.now() / 1000);
  if (typeof time !== 'number' || !Number.isFinite(time)) return now;
  if (time > 1e12) return Math.floor(time / 1000);
  return Math.floor(time);
}

function readNumericField(rec: Record<string, unknown>, camel: string, snake: string): number | undefined {
  for (const key of [camel, snake]) {
    const v = rec[key];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '') {
      const n = Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  return undefined;
}

function readCityIdList(rec: Record<string, unknown>): number[] {
  for (const key of ['citiesIds', 'cities_ids', 'cityIds', 'city_ids']) {
    const v = rec[key];
    if (!Array.isArray(v)) continue;
    const out: number[] = [];
    for (const x of v) {
      if (typeof x === 'number' && Number.isFinite(x)) out.push(x);
      else if (typeof x === 'string' && x.trim() !== '') {
        const n = Number(x);
        if (Number.isFinite(n)) out.push(n);
      }
    }
    if (out.length) return out;
  }
  return [];
}

/**
 * Normalizes raw `SYSTEM_MESSAGE.data` from Tzofar WS (camelCase / snake_case, ms time, JSON string).
 */
export function normalizeTzevaSystemMessagePayload(raw: unknown): TzevaSystemMessagePayload | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      return normalizeTzevaSystemMessagePayload(JSON.parse(raw) as unknown);
    } catch {
      return null;
    }
  }
  if (!isRecord(raw)) return null;

  const instructionType = readNumericField(raw, 'instructionType', 'instruction_type');
  if (instructionType == null || !Number.isFinite(instructionType)) return null;

  const timeRaw = readNumericField(raw, 'time', 'timestamp');
  const citiesIds = readCityIdList(raw);
  const id = raw.id ?? raw.messageId ?? raw.message_id;
  const titleHe =
    typeof raw.titleHe === 'string'
      ? raw.titleHe
      : typeof raw.title_he === 'string'
        ? raw.title_he
        : undefined;
  const bodyHe =
    typeof raw.bodyHe === 'string'
      ? raw.bodyHe
      : typeof raw.body_he === 'string'
        ? raw.body_he
        : undefined;
  const titleEn =
    typeof raw.titleEn === 'string'
      ? raw.titleEn
      : typeof raw.title_en === 'string'
        ? raw.title_en
        : undefined;
  const bodyEn =
    typeof raw.bodyEn === 'string'
      ? raw.bodyEn
      : typeof raw.body_en === 'string'
        ? raw.body_en
        : undefined;

  return {
    id: id as string | number | undefined,
    instructionType,
    citiesIds: citiesIds.length ? citiesIds : undefined,
    time: timeRaw,
    titleHe,
    bodyHe,
    titleEn,
    bodyEn,
  };
}

export type TzevaWsInbound =
  | { type: 'ALERT'; data: unknown }
  | { type: 'SYSTEM_MESSAGE'; data: TzevaSystemMessagePayload }
  | { type: 'LISTS_VERSIONS'; data: unknown };

/**
 * התרעה מקדימה — `instructionType === 0`.
 */
export function buildEarlyWarningEventsFromTzevaSystemMessage(
  data: TzevaSystemMessagePayload,
  idToHebrew: Map<string, string>,
): AlertEvent[] {
  if (data.instructionType !== TZEWA_INSTRUCTION_EARLY_WARNING) return [];

  const msgId = data.id != null ? String(data.id) : 'unknown';
  const cityIds = Array.isArray(data.citiesIds) ? data.citiesIds : [];
  const timeSec = coerceTzevaUnixSeconds(data.time);
  const timestamp = new Date(timeSec * 1000).toISOString();
  const expiresAt = new Date(timeSec * 1000 + EARLY_WARNING_AND_ENDED_TTL_MS).toISOString();

  const out: AlertEvent[] = [];
  if (cityIds.length === 0) {
    const id = `tzeva-ws-early-${msgId}-national-${timeSec}`;
    const city = 'כל הארץ';
    out.push({
      id,
      city,
      timestamp,
      expiresAt,
      source: 'tzevaadom',
      category: 'early warning',
      polygonId: getRegionIdForCity(city),
    });
    return out;
  }

  for (const rawId of cityIds) {
    const sid = String(rawId);
    const city = idToHebrew.get(sid)?.trim() || `יישוב (${sid})`;
    const id = `tzeva-ws-early-${msgId}-${sid}-${timeSec}`;
    out.push({
      id,
      city,
      timestamp,
      expiresAt,
      source: 'tzevaadom',
      category: 'early warning',
      polygonId: getRegionIdForCity(city),
    });
  }
  return out;
}

/**
 * Build `incident ended` events from a `SYSTEM_MESSAGE` with `instructionType === 1`
 * (event end — green toast on the official site).
 */
export function buildEndedEventsFromTzevaSystemMessage(
  data: TzevaSystemMessagePayload,
  idToHebrew: Map<string, string>,
): AlertEvent[] {
  if (data.instructionType !== TZEWA_INSTRUCTION_END_EVENT) return [];

  const msgId = data.id != null ? String(data.id) : 'unknown';
  const cityIds = Array.isArray(data.citiesIds) ? data.citiesIds : [];
  const timeSec = coerceTzevaUnixSeconds(data.time);
  const timestamp = new Date(timeSec * 1000).toISOString();
  const textBlob = `${data.titleHe ?? ''} ${data.bodyHe ?? ''}`;
  const endedCategory = inferEndedCategoryFromHebrewTitle(textBlob);

  const expiresAt = new Date(timeSec * 1000 + INCIDENT_ENDED_ACTIVE_TTL_MS).toISOString();

  const out: AlertEvent[] = [];
  if (cityIds.length === 0) {
    const id = `tzeva-ws-end-${msgId}-national-${timeSec}`;
    const city = 'כל הארץ';
    out.push({
      id,
      city,
      timestamp,
      expiresAt,
      source: 'tzevaadom',
      category: 'incident ended',
      endedCategory,
      polygonId: getRegionIdForCity(city),
    });
    return out;
  }

  for (const rawId of cityIds) {
    const sid = String(rawId);
    const city = idToHebrew.get(sid)?.trim() || `יישוב (${sid})`;
    const id = `tzeva-ws-end-${msgId}-${sid}-${timeSec}`;
    out.push({
      id,
      city,
      timestamp,
      expiresAt,
      source: 'tzevaadom',
      category: 'incident ended',
      endedCategory,
      polygonId: getRegionIdForCity(city),
    });
  }
  return out;
}

export interface TzevaWebSocketOptions {
  onSystemMessage: (data: TzevaSystemMessagePayload) => void;
  onOpen?: () => void;
  onClose?: () => void;
  reconnectMs?: number;
  /** Overrides {@link getTzevaWebSocketClientUrl} (tests). */
  wsUrl?: string;
}

/**
 * Browser WebSocket to Tzeva; reconnects like the official client (~5s).
 */
let warnedMissingTzevaWsUrl = false;

export function connectTzevaWebSocket(options: TzevaWebSocketOptions): () => void {
  const { onSystemMessage, onOpen, onClose, reconnectMs = 5000, wsUrl } = options;
  const connectUrl = (wsUrl ?? getTzevaWebSocketClientUrl()).trim();
  if (!connectUrl) {
    if (
      typeof window !== 'undefined' &&
      !warnedMissingTzevaWsUrl &&
      !isTzevaWebSocketDisabled()
    ) {
      warnedMissingTzevaWsUrl = true;
      console.warn(
        '[Sentinel] Tzeva WebSocket URL missing: set TZEWA_WS_PROXY_URL or NEXT_PUBLIC_TZEWA_WS_PROXY_URL on the server (Vercel). Use TZEWA_WS_PROXY_URL to avoid build-time inlining issues; the app also reads /api/tzeva/ws-proxy-url at runtime.',
      );
    }
    return () => undefined;
  }
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const cleanupTimer = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  const connect = () => {
    if (closed) return;
    cleanupTimer();
    try {
      ws = new WebSocket(connectUrl);
    } catch {
      scheduleReconnect();
      return;
    }

    ws.onopen = () => {
      onOpen?.();
    };

    ws.onmessage = (ev) => {
      void (async () => {
        let text: string | null = null;
        const d = ev.data as string | Blob | ArrayBuffer;
        if (typeof d === 'string') {
          text = d;
        } else if (typeof Blob !== 'undefined' && d instanceof Blob) {
          try {
            text = await d.text();
          } catch {
            return;
          }
        } else if (d instanceof ArrayBuffer) {
          text = new TextDecoder('utf-8').decode(d);
        }
        if (text == null) return;
        try {
          let parsed = JSON.parse(text) as unknown;
          if (Array.isArray(parsed) && parsed.length === 1 && isRecord(parsed[0])) {
            parsed = parsed[0];
          }
          if (!isRecord(parsed)) return;
          const msgType = parsed.type;
          if (
            msgType !== 'SYSTEM_MESSAGE' &&
            msgType !== 'system_message' &&
            msgType !== 'SystemMessage'
          ) {
            return;
          }
          const normalized = normalizeTzevaSystemMessagePayload(parsed.data);
          if (normalized) {
            onSystemMessage(normalized);
          }
        } catch {
          // ignore malformed frames
        }
      })();
    };

    ws.onerror = () => {
      try {
        ws?.close();
      } catch {
        // ignore
      }
    };

    ws.onclose = () => {
      onClose?.();
      ws = null;
      if (!closed) scheduleReconnect();
    };
  };

  const scheduleReconnect = () => {
    cleanupTimer();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, reconnectMs);
  };

  connect();

  return () => {
    closed = true;
    cleanupTimer();
    try {
      ws?.close();
    } catch {
      // ignore
    }
    ws = null;
  };
}
