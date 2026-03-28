import type { AlertHistoryRow } from '@/lib/alert-normalize';

/**
 * Vercel Hobby — מקסימום ~10s לפונקציה; שני ה־fetch במקביל אז timeout לכל אחד חייב להישאר מתחת למגבלה הכוללת.
 */
const REQUEST_TIMEOUT_MS = 8_000;

const DEFAULT_OREF_MAP_BASE = 'https://oref-map.org';

const OREF_UPSTREAM_HEADERS: HeadersInit = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Sentinel-Defence/1.0 (+https://oref-map.org feed)',
};

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null;
}

/**
 * מיפוי כותרות מפיקוד העורף (כמו ב־[oref-map](https://github.com/maorcc/oref-map)) לקודי קטגוריה Pikud
 * ש־{@link normalizeAlertHistoryPayload} כבר מבין.
 */
export function orefAlertTitleToPikudCategory(titleRaw: string): number {
  const title = titleRaw.replace(/\s+/g, ' ').trim();

  if (
    title.includes('האירוע הסתיים') ||
    (title.includes('ניתן לצאת') && !title.includes('להישאר בקרבתו')) ||
    title.includes('החשש הוסר') ||
    title.includes('יכולים לצאת') ||
    title.includes('אינם צריכים לשהות') ||
    title.includes('סיום שהייה בסמיכות') ||
    title === 'עדכון'
  ) {
    return 13;
  }

  if (
    title === 'בדקות הקרובות צפויות להתקבל התרעות באזורך' ||
    title.includes('לשפר את המיקום למיגון המיטבי') ||
    title === 'יש לשהות בסמיכות למרחב המוגן' ||
    title.includes('להישאר בקרבתו')
  ) {
    return 7;
  }

  if (title === 'חדירת כלי טיס עוין') {
    return 2;
  }

  if (title === 'ירי רקטות וטילים') return 1;
  if (title === 'חדירת מחבלים') return 6;
  if (title === 'נשק לא קונבנציונלי') return 5;
  if (title === 'היכנסו מייד למרחב המוגן' || title === 'היכנסו למרחב המוגן') return 1;

  return 99;
}

function orefNowJerusalemWallClock(): string {
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
    .format(new Date())
    .replace('T', ' ');
}

function normalizeOrefAlertDate(raw: string): string {
  return raw.trim().replace('T', ' ').slice(0, 19);
}

function orefHistoryEntryToRow(entry: unknown): AlertHistoryRow | null {
  if (!isRecord(entry)) return null;
  const data = entry.data;
  const titleRaw = entry.title;
  const alertDateRaw = entry.alertDate;
  if (typeof titleRaw !== 'string' || typeof alertDateRaw !== 'string') return null;
  const city =
    typeof data === 'string' ? data.trim() : data != null ? String(data).trim() : '';
  if (!city) return null;
  const title = titleRaw.replace(/\s+/g, ' ').trim();
  if (!title) return null;
  const alertDate = normalizeOrefAlertDate(alertDateRaw);
  if (!alertDate) return null;
  const category = orefAlertTitleToPikudCategory(title);
  return { alertDate, title, data: city, category };
}

function orefLivePayloadToRows(parsed: unknown): AlertHistoryRow[] {
  if (!isRecord(parsed)) return [];
  const titleBase = typeof parsed.desc === 'string' ? parsed.desc : parsed.title;
  if (typeof titleBase !== 'string') return [];
  const title = titleBase.replace(/\s+/g, ' ').trim();
  if (!title) return [];
  const locs = parsed.data;
  if (!Array.isArray(locs) || locs.length === 0) return [];
  const category = orefAlertTitleToPikudCategory(title);
  const alertDate = orefNowJerusalemWallClock();
  const out: AlertHistoryRow[] = [];
  for (const loc of locs) {
    if (typeof loc !== 'string') continue;
    const city = loc.trim();
    if (!city) continue;
    out.push({
      alertDate,
      title: typeof parsed.title === 'string' ? parsed.title.replace(/\s+/g, ' ').trim() : title,
      data: city,
      category,
    });
  }
  return out;
}

/**
 * בסיס ל־`/api/history` ו־`/api/alerts`. ברירת מחדל: oref-map.org; ניתן לדרוס ב־`OREF_MAP_PROXY_BASE_URL`.
 * ב־Vercel מתעלמים מ־`localhost` בטעות (העתקת .env) — השרת לא יכול להגיע ללוקאלוהוסט שלך.
 */
export function getOrefMapProxyBaseUrl(): string {
  const u = process.env.OREF_MAP_PROXY_BASE_URL?.trim();
  if (!u || u.length === 0) return DEFAULT_OREF_MAP_BASE;
  const cleaned = u.replace(/\/$/, '');
  if (process.env.VERCEL === '1' && /localhost|127\.0\.0\.1/i.test(cleaned)) {
    return DEFAULT_OREF_MAP_BASE;
  }
  return cleaned;
}

/** GET ל־oref-map (או פרוקסי) — timeout + User-Agent (חלק מה־WAF דורשים). */
export async function fetchOrefUpstreamText(
  url: string,
): Promise<{ ok: boolean; text: string; status: number }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: OREF_UPSTREAM_HEADERS,
    });
    const text = (await response.text()).replace(/^\uFEFF/, '').trim();
    return { ok: response.ok, text, status: response.status };
  } finally {
    clearTimeout(timeoutId);
  }
}

export type OrefUpstreamHttpMeta = { ok: boolean; status: number };

export type OrefMapProxyFetchResult = {
  rows: AlertHistoryRow[];
  history: OrefUpstreamHttpMeta;
  live: OrefUpstreamHttpMeta;
};

function parseHistoryAndLiveResponses(
  hist: Awaited<ReturnType<typeof fetchOrefUpstreamText>>,
  live: Awaited<ReturnType<typeof fetchOrefUpstreamText>>,
): OrefMapProxyFetchResult {
  const rows: AlertHistoryRow[] = [];

  if (hist.ok && hist.text) {
    try {
      const parsed = JSON.parse(hist.text) as unknown;
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          const row = orefHistoryEntryToRow(entry);
          if (row) rows.push(row);
        }
      }
    } catch {
      // ignore invalid history JSON
    }
  }

  if (live.ok && live.text) {
    try {
      const parsed = JSON.parse(live.text) as unknown;
      rows.push(...orefLivePayloadToRows(parsed));
    } catch {
      // ignore invalid live JSON
    }
  }

  return {
    rows,
    history: { ok: hist.ok, status: hist.status },
    live: { ok: live.ok, status: live.status },
  };
}

async function fetchOrefMapProxyOnce(): Promise<OrefMapProxyFetchResult> {
  const base = getOrefMapProxyBaseUrl();
  const [hist, live] = await Promise.all([
    fetchOrefUpstreamText(`${base}/api/history`),
    fetchOrefUpstreamText(`${base}/api/alerts`),
  ]);
  return parseHistoryAndLiveResponses(hist, live);
}

/**
 * שולף `/api/history` + `/api/alerts` מ־oref-map (או מופע עצמאי עם אותה צורת API).
 * ניסיון חוזר קצר אם שני ה־HTTP נכשלים (רשת / WAF חד־פעמי).
 * @see https://github.com/maorcc/oref-map
 */
export async function fetchOrefMapProxyAsAlertRows(): Promise<OrefMapProxyFetchResult> {
  let r = await fetchOrefMapProxyOnce();
  if (!r.history.ok && !r.live.ok) {
    await new Promise((res) => setTimeout(res, 450));
    r = await fetchOrefMapProxyOnce();
  }
  return r;
}
