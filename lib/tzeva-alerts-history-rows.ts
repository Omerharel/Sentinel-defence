import type { AlertHistoryRow } from '@/lib/alert-normalize';

const TZEVA_ALERTS_HISTORY_URL = 'https://api.tzevaadom.co.il/alerts-history';

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

function mapTzevaThreatToPikud(threat: number): { category: number; title: string } {
  switch (threat) {
    case 0:
      return { category: 1, title: 'ירי רקטות וטילים' };
    case 5:
      return { category: 2, title: 'כלי טיס עוין' };
    case 7:
      return { category: 7, title: 'התרעה מקדימה' };
    case 13:
      return { category: 13, title: 'האירוע הסתיים' };
    default:
      return { category: 99, title: `התרעה (קוד איום ${threat})` };
  }
}

function unixSecondsToAlertDateString(sec: number): string {
  const normalizedSec = sec > 1e12 ? Math.floor(sec / 1000) : sec;
  const d = new Date(normalizedSec * 1000);
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .format(d)
    .replace('T', ' ');
}

/**
 * ממיר את גוף ה־JSON מ־`alerts-history` של צבע אדום לשורות כמו מ־oref-map.
 * @see alerts-proxy/tzeva-map.mjs
 */
export function mapTzevaAlertsHistoryPayloadToRows(payload: unknown): AlertHistoryRow[] {
  if (!Array.isArray(payload)) return [];

  const rows: AlertHistoryRow[] = [];

  for (const incident of payload) {
    if (!isRecord(incident)) continue;
    const alerts = incident.alerts;
    if (!Array.isArray(alerts)) continue;

    for (const alert of alerts) {
      if (!isRecord(alert)) continue;
      const time = alert.time;
      const threat = alert.threat;
      const isDrill = alert.isDrill;
      const cities = alert.cities;

      if (typeof time !== 'number' || !Number.isFinite(time)) continue;
      if (typeof threat !== 'number' || !Number.isFinite(threat)) continue;
      if (isDrill === true) continue;
      if (!Array.isArray(cities)) continue;

      const { category, title } = mapTzevaThreatToPikud(threat);
      const alertDate = unixSecondsToAlertDateString(time);

      if (cities.length === 0 && (threat === 7 || threat === 13)) {
        rows.push({
          alertDate,
          title,
          data: 'כל הארץ',
          category,
        });
        continue;
      }

      for (const city of cities) {
        if (typeof city !== 'string') continue;
        const trimmed = city.trim();
        if (!trimmed) continue;
        rows.push({
          alertDate,
          title,
          data: trimmed,
          category,
        });
      }
    }
  }

  return rows;
}

/**
 * משיכת היסטוריה מ־Tzeva כש־oref-map חוסם IP של Vercel (403).
 * ניתן לכבות: `SENTINEL_DISABLE_TZEVA_OREF_FALLBACK=1`.
 */
export async function fetchTzevaAlertsHistoryAsRows(timeoutMs: number): Promise<AlertHistoryRow[]> {
  if (process.env.SENTINEL_DISABLE_TZEVA_OREF_FALLBACK === '1') return [];

  const url = process.env.TZEVA_ALERTS_HISTORY_URL?.trim() || TZEVA_ALERTS_HISTORY_URL;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': BROWSER_UA,
      },
    });
    if (!res.ok) return [];
    const text = (await res.text()).replace(/^\uFEFF/, '').trim();
    if (!text || text === 'null') return [];
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      return [];
    }
    return mapTzevaAlertsHistoryPayloadToRows(payload);
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
