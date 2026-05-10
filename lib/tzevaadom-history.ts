import type { OrefHistoryRow } from '@/lib/oref-alerts';
import { mapTzevaThreatToPikudShapedFields } from '@/lib/tzeva-threat';

/** Public JSON feed used by tzevaadom.co.il (shape observed from live responses). */
export const TZEWA_ALERTS_HISTORY_URL = 'https://api.tzevaadom.co.il/alerts-history';

export interface TzevaHistoryIncident {
  id: number;
  description: string | null;
  alerts: TzevaHistoryAlert[];
}

export interface TzevaHistoryAlert {
  time: number;
  cities: string[];
  threat: number;
  isDrill: boolean;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/** Format instant as Pikud-style local wall time string (Asia/Jerusalem). */
export function unixSecondsToOrefAlertDateString(sec: number): string {
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
 * Flattens Tzeva Adom alerts-history JSON into Pikud History-shaped rows so
 * {@link normalizeOrefHistoryPayload} can stay unchanged.
 */
export function mapTzevaAlertsHistoryToOrefRows(payload: unknown): OrefHistoryRow[] {
  if (!Array.isArray(payload)) return [];

  const rows: OrefHistoryRow[] = [];

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

      const { category, title } = mapTzevaThreatToPikudShapedFields(threat);
      const alertDate = unixSecondsToOrefAlertDateString(time);

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
