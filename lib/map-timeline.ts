import type { AlertCategory, AlertEvent } from '@/lib/alert-types';
import { ALERT_CATEGORY_TTL_MS } from '@/lib/alert-normalize';

/** רוחב חלון הסליידר על ציר הזמן (אחורה מ־"עכשיו"). */
export const MAP_TIMELINE_SLIDER_RANGE_MS = 3 * 60 * 60 * 1000;

/** סדר עדיפות כשאין שכבת “מקדים / אסקלציה / סיום” מנצחת */
const CATEGORY_PRIORITY: AlertCategory[] = [
  'rockets',
  'hostile aircraft',
  'terror',
  'hazmat',
  'earthquake',
  'tsunami',
  'unknown',
  'early warning',
  'incident ended',
];

function categoryRank(c: AlertCategory): number {
  const i = CATEGORY_PRIORITY.indexOf(c);
  return i === -1 ? CATEGORY_PRIORITY.indexOf('unknown') : i;
}

function minRankCategory(events: AlertEvent[]): AlertCategory | undefined {
  if (events.length === 0) return undefined;
  let best = events[0]!.category;
  let rBest = categoryRank(best);
  for (let i = 1; i < events.length; i++) {
    const c = events[i]!.category;
    const r = categoryRank(c);
    if (r < rBest) {
      rBest = r;
      best = c;
    }
  }
  return best;
}

export type TimelineSegmentKind = AlertCategory | 'quiet';

export interface TimelineSegment {
  startMs: number;
  endMs: number;
  kind: TimelineSegmentKind;
}

function isEscalation(c: AlertCategory): boolean {
  return c === 'rockets' || c === 'hostile aircraft';
}

function eventEndMs(e: AlertEvent): number {
  const exp = Date.parse(e.expiresAt ?? '');
  if (!Number.isNaN(exp)) return exp;
  const t = Date.parse(e.timestamp);
  if (Number.isNaN(t)) return NaN;
  const ttl = ALERT_CATEGORY_TTL_MS[e.category];
  return t + (Number.isFinite(ttl) ? ttl : 0);
}

function isActiveAt(e: AlertEvent, tMs: number): boolean {
  const t = Date.parse(e.timestamp);
  if (Number.isNaN(t)) return false;
  const end = eventEndMs(e);
  if (!Number.isFinite(end) || Number.isNaN(end)) return false;
  return tMs >= t && tMs <= end;
}

/** מקדים → אסקלציה → סיום → שאר (לפי rank) */
function dominantKind(events: AlertEvent[], tMs: number): TimelineSegmentKind {
  const active = events.filter((e) => isActiveAt(e, tMs));
  if (active.length === 0) return 'quiet';
  if (active.some((e) => e.category === 'early warning')) return 'early warning';

  const esc = active.filter((e) => isEscalation(e.category));
  const escPick = minRankCategory(esc);
  if (escPick !== undefined) return escPick;

  if (active.some((e) => e.category === 'incident ended')) return 'incident ended';

  return minRankCategory(active) ?? 'quiet';
}

export function buildTimelineSegments(
  events: AlertEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
): TimelineSegment[] {
  if (rangeEndMs <= rangeStartMs) return [];

  const boundaries = new Set<number>([rangeStartMs, rangeEndMs]);
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    const end = eventEndMs(e);
    if (!Number.isNaN(t) && t >= rangeStartMs && t <= rangeEndMs) boundaries.add(t);
    if (Number.isFinite(end) && !Number.isNaN(end) && end >= rangeStartMs && end <= rangeEndMs) {
      boundaries.add(end);
    }
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const out: TimelineSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const startMs = sorted[i]!;
    const endMs = sorted[i + 1]!;
    if (endMs <= startMs) continue;
    const mid = (startMs + endMs) / 2;
    const kind = dominantKind(events, mid);
    const last = out[out.length - 1];
    if (last?.kind === kind) last.endMs = endMs;
    else out.push({ startMs, endMs, kind });
  }

  return out;
}

export interface TimelineEarlyWarningBand {
  id: string;
  leftPct: number;
  widthPct: number;
}

const HIGHLIGHT_MIN_WIDTH_FRAC = 0.022;

/** [start,end] בטווח → חלק יחסי [0,1] עם רוחב מינימלי לרינדור */
function bandFracInRange(
  startMs: number,
  endMs: number,
  rangeStartMs: number,
  rangeEndMs: number,
  minWidthFrac: number,
): { left: number; width: number } | null {
  const span = rangeEndMs - rangeStartMs;
  if (span <= 0) return null;
  const a = Math.max(startMs, rangeStartMs);
  const b = Math.min(endMs, rangeEndMs);
  if (b <= a) return null;
  let left = (a - rangeStartMs) / span;
  let width = (b - a) / span;
  if (width < minWidthFrac) {
    const mid = left + width / 2;
    width = minWidthFrac;
    left = Math.max(0, Math.min(1 - width, mid - width / 2));
  }
  return { left, width };
}

export function buildTimelineEarlyWarningHighlights(
  events: AlertEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
): TimelineEarlyWarningBand[] {
  const bands: TimelineEarlyWarningBand[] = [];
  for (const e of events) {
    if (e.category !== 'early warning') continue;
    const t = Date.parse(e.timestamp);
    const end = eventEndMs(e);
    if (Number.isNaN(t) || !Number.isFinite(end) || Number.isNaN(end)) continue;
    const frac = bandFracInRange(t, end, rangeStartMs, rangeEndMs, HIGHLIGHT_MIN_WIDTH_FRAC);
    if (!frac) continue;
    bands.push({
      id: e.id,
      leftPct: frac.left * 100,
      widthPct: frac.width * 100,
    });
  }
  return bands;
}
