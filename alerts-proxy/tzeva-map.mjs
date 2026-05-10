/**
 * Keep in sync with `lib/tzeva-threat.ts` (mapTzevaThreatToPikudShapedFields).
 * Converts https://api.tzevaadom.co.il/alerts-history into flat history rows (keep in sync with `lib/tzevaadom-history.ts`).
 */

function isRecord(x) {
  return typeof x === 'object' && x !== null;
}

/** Tzeva `threat` codes — see `lib/tzeva-threat.ts`. */
function mapTzevaThreatToPikudShapedFields(threat) {
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

function unixSecondsToHistoryAlertDateString(sec) {
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

export function mapTzevaAlertsHistoryToRows(payload) {
  if (!Array.isArray(payload)) return [];

  const rows = [];

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
      const alertDate = unixSecondsToHistoryAlertDateString(time);

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
