import type { AlertHistoryRow } from '@/lib/alert-normalize';
import { parseHistoryAlertDateToEpochMs } from '@/lib/alert-normalize';

/**
 * אותו מקור נתונים שמוזכר ב־[hatraot.vercel.app](https://hatraot.vercel.app/) (כיתוב: dleshem/israel-alerts-data).
 * @see https://github.com/dleshem/israel-alerts-data
 */
const DLESHEM_CSV_SOURCES = [
  'https://raw.githubusercontent.com/dleshem/israel-alerts-data/main/israel-alerts.csv',
  /** לעיתים מחזיר 206 כש־raw.githubusercontent.com מחזיר 200 עם גוף מלא (בלי Range). */
  'https://cdn.jsdelivr.net/gh/dleshem/israel-alerts-data@main/israel-alerts.csv',
] as const;

const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** סוף הקובץ (~55MB) — מספיק לאירועים אחרונים בלי למשוך את כל ה־CSV. */
const RANGE_TAIL_BYTES = 2_800_000;

/** רק שורות מהחלון הזה (מילוי סליידר / פאנל). */
const MAX_ROW_AGE_MS = 36 * 60 * 60 * 1000;

const CACHE_TTL_MS = 75_000;

let cache: { fetchedAt: number; rows: AlertHistoryRow[] } | null = null;

function parseCSVLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  let field = '';
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i]!;
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        field += '"';
        i += 2;
        continue;
      }
      if (c === '"') {
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (c === ',') {
      out.push(field);
      field = '';
      i++;
      continue;
    }
    field += c;
    i++;
  }
  out.push(field);
  return out;
}

function dleshemDateTimeToAlertDate(dateField: string, timeField: string): string | null {
  const dm = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(dateField.trim());
  const tm = /^(\d{2}):(\d{2}):(\d{2})$/.exec(timeField.trim());
  if (!dm || !tm) return null;
  const [, d, mo, y] = dm;
  const [, h, mi, s] = tm;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

function chunkToRows(chunk: string, nowMs: number): AlertHistoryRow[] {
  const nl = chunk.indexOf('\n');
  const body = nl === -1 ? chunk : chunk.slice(nl + 1);
  const rows: AlertHistoryRow[] = [];
  const lines = body.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = parseCSVLine(line);
    if (cols.length < 6 || cols[0] === 'data') continue;
    const city = cols[0]!.trim();
    if (!city) continue;
    const alertDate = dleshemDateTimeToAlertDate(cols[1]!, cols[2]!);
    if (!alertDate) continue;
    const tMs = parseHistoryAlertDateToEpochMs(alertDate);
    if (tMs === null || nowMs - tMs > MAX_ROW_AGE_MS || tMs > nowMs + 60_000) continue;
    const cat = Number(cols[4]);
    if (!Number.isFinite(cat)) continue;
    const title = cols[5]!.replace(/\s+/g, ' ').trim();
    if (!title) continue;
    rows.push({ alertDate, title, data: city, category: cat });
  }
  return rows;
}

/**
 * שורות מ־`israel-alerts.csv` (סוף קובץ ב־Range) למיזוג עם oref — כולל קטגוריה 14 (מקדים בפורמט ה־CSV).
 * מוגבל ב־{@link CACHE_TTL_MS} כדי לא למשוך מחדש בכל poll של הלקוח.
 */
export async function fetchDleshemCsvSupplementRows(timeoutMs: number): Promise<AlertHistoryRow[]> {
  if (process.env.SENTINEL_DISABLE_DLESHEM_CSV === '1') return [];

  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) return cache.rows;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let text: string | null = null;

    for (const url of DLESHEM_CSV_SOURCES) {
      const res = await fetch(url, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          Range: `bytes=-${RANGE_TAIL_BYTES}`,
          'User-Agent': BROWSER_UA,
          Accept: 'text/plain,*/*',
        },
      });

      if (res.status === 206) {
        text = (await res.text()).replace(/^\uFEFF/, '');
        break;
      }

      if (res.status !== 200) continue;

      const len = Number(res.headers.get('content-length'));
      if (!Number.isFinite(len)) {
        await res.body?.cancel().catch(() => {});
        continue;
      }
      if (len <= RANGE_TAIL_BYTES + 64) {
        text = (await res.text()).replace(/^\uFEFF/, '');
        break;
      }

      await res.body?.cancel().catch(() => {});
    }

    if (text === null) return [];

    const rows = chunkToRows(text, now);
    cache = { fetchedAt: now, rows };
    return rows;
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}
