import { TZDate } from '@date-fns/tz';

/** `YYYY-MM-DD` בזמן קירוב ירושלים (כמו oref-map). */
export function jerusalemDateYmd(nowMs: number = Date.now()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Jerusalem' }).format(new Date(nowMs));
}

/** תחילת וסוף יום קלנדרי בירושלים (ms UTC). */
export function jerusalemDayBoundsMs(dateYmd: string): { startMs: number; endMs: number } {
  const [ys, ms, ds] = dateYmd.split('-');
  const y = Number(ys);
  const m = Number(ms);
  const d = Number(ds);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
    const now = Date.now();
    return { startMs: now - 60 * 60 * 1000, endMs: now };
  }
  const start = new TZDate(y, m - 1, d, 0, 0, 0, 'Asia/Jerusalem');
  const nextStart = new TZDate(y, m - 1, d + 1, 0, 0, 0, 'Asia/Jerusalem');
  return { startMs: start.getTime(), endMs: nextStart.getTime() - 1 };
}
