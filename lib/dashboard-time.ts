/** Single clock for header “Last update” and alert rows (Israel civil time, 24h). */
const DASHBOARD_TIME: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Jerusalem',
};

const JERUSALEM_MINUTE_BUCKET: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
};

/** Wall-clock minute in Asia/Jerusalem — for merging list rows in the same minute. */
export function getAlertListMergeMinuteKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat('en-CA', JERUSALEM_MINUTE_BUCKET).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  return `${m.year}-${m.month}-${m.day}T${m.hour}:${m.minute}`;
}

export function formatDashboardTime(iso?: string): string {
  if (!iso) return '--:--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString('en-GB', DASHBOARD_TIME);
}

/** תווית מעל סליידר ציר זמן — לדוגמה `Mar 28 19:24` (Asia/Jerusalem). */
export function formatTimelinePlayheadLabel(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Jerusalem',
  }).formatToParts(d);
  const m: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') m[p.type] = p.value;
  }
  const mo = m.month ?? '';
  const day = (m.day ?? '').replace(/^0/, '');
  const h = m.hour ?? '';
  const min = m.minute ?? '';
  return `${mo} ${day} ${h}:${min}`.trim();
}
