import type { AlertCategory, AlertEvent } from '@/lib/alert-types';
import { ALERT_CATEGORY_TTL_MS } from '@/lib/alert-normalize';

/** רוחב חלון הסליידר על ציר הזמן (אחורה מ־"עכשיו"). */
export const MAP_TIMELINE_SLIDER_RANGE_MS = 60 * 60 * 1000;

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

type PreparedInterval = { start: number; end: number; e: AlertEvent };

/** מקדים → אסקלציה → סיום → שאר (לפי rank) — על קבוצה שכבר ידועה כפעילה בנקודת זמן */
function dominantKindFromActive(active: AlertEvent[]): TimelineSegmentKind {
  if (active.length === 0) return 'quiet';
  if (active.some((e) => e.category === 'early warning')) return 'early warning';

  const esc = active.filter((e) => isEscalation(e.category));
  const escPick = minRankCategory(esc);
  if (escPick !== undefined) return escPick;

  if (active.some((e) => e.category === 'incident ended')) return 'incident ended';

  return minRankCategory(active) ?? 'quiet';
}

function prepareIntervals(events: AlertEvent[], rangeStartMs: number, rangeEndMs: number): PreparedInterval[] {
  const out: PreparedInterval[] = [];
  for (const e of events) {
    const t = Date.parse(e.timestamp);
    const end = eventEndMs(e);
    if (Number.isNaN(t) || !Number.isFinite(end) || Number.isNaN(end)) continue;
    if (end < rangeStartMs || t > rangeEndMs) continue;
    out.push({ start: t, end, e });
  }
  return out;
}

export function buildTimelineSegments(
  events: AlertEvent[],
  rangeStartMs: number,
  rangeEndMs: number,
): TimelineSegment[] {
  if (rangeEndMs <= rangeStartMs) return [];

  const intervals = prepareIntervals(events, rangeStartMs, rangeEndMs);

  const boundaries = new Set<number>([rangeStartMs, rangeEndMs]);
  for (const x of intervals) {
    if (x.start >= rangeStartMs && x.start <= rangeEndMs) boundaries.add(x.start);
    if (x.end >= rangeStartMs && x.end <= rangeEndMs) boundaries.add(x.end);
  }

  const sorted = [...boundaries].sort((a, b) => a - b);
  const sortedStarts = [...intervals].sort((a, b) => a.start - b.start);
  const sortedEnds = [...intervals].sort((a, b) => a.end - b.end);

  const active = new Map<string, AlertEvent>();
  let si = 0;
  let ei = 0;
  const out: TimelineSegment[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const startMs = sorted[i]!;
    const endMs = sorted[i + 1]!;
    if (endMs <= startMs) continue;
    const mid = (startMs + endMs) / 2;

    while (si < sortedStarts.length && sortedStarts[si]!.start <= mid) {
      const x = sortedStarts[si++]!;
      active.set(x.e.id, x.e);
    }
    while (ei < sortedEnds.length && sortedEnds[ei]!.end < mid) {
      const x = sortedEnds[ei++]!;
      active.delete(x.e.id);
    }

    const kind = dominantKindFromActive(Array.from(active.values()));
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
