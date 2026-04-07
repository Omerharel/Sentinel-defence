import { NextResponse } from 'next/server';
import { normalizeAlertHistoryPayload } from '@/lib/alert-normalize';
import { fetchOrefMapProxyAsAlertRows } from '@/lib/fetch-oref-map-proxy-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** Vercel Pro ומעלה; ב־Hobby נשארת מגבלת 10s — ה־fetch ל־oref מוגבל ל־8s במקביל. */
export const maxDuration = 25;
const ALERTS_CACHE_TTL_MS = 4_000;

type AlertsCacheEntry = {
  body: Awaited<ReturnType<typeof buildAlertsBody>>;
  expiresAt: number;
};

const alertsCache = new Map<string, AlertsCacheEntry>();
const inflightByKey = new Map<string, Promise<Awaited<ReturnType<typeof buildAlertsBody>>>>();

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

async function buildAlertsBody(maxEvents: number, scanCap: number) {
  const { rows, history, live, usedOrefPublicHistorySupplement } = await fetchOrefMapProxyAsAlertRows();
  const body = normalizeAlertHistoryPayload(rows, {
    maxEvents,
    scanCap,
  });
  const upstreamDead = !history.ok && !live.ok;
  return { body, rows, history, live, usedOrefPublicHistorySupplement, upstreamDead };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxEvents = clampInt(Number(url.searchParams.get('maxEvents')), 100, 8000, 2000);
  const scanCap = clampInt(Number(url.searchParams.get('scanCap')), 500, 20000, 2500);
  const cacheKey = `${maxEvents}:${scanCap}`;
  const now = Date.now();
  const cached = alertsCache.get(cacheKey);

  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.body.body, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'X-Alerts-Cache': 'HIT',
        ...(cached.body.upstreamDead || !cached.body.history.ok || !cached.body.live.ok
          ? { 'X-Oref-Upstream': `hist=${cached.body.history.status},live=${cached.body.live.status}` }
          : {}),
        ...(cached.body.usedOrefPublicHistorySupplement ? { 'X-Oref-Public-History-Supplement': '1' } : {}),
      },
    });
  }

  try {
    const existingInflight = inflightByKey.get(cacheKey);
    const loadPromise =
      existingInflight ??
      buildAlertsBody(maxEvents, scanCap).finally(() => {
        inflightByKey.delete(cacheKey);
      });
    if (!existingInflight) inflightByKey.set(cacheKey, loadPromise);

    if (cached && existingInflight) {
      return NextResponse.json(cached.body.body, {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'X-Alerts-Cache': 'STALE',
          ...(cached.body.upstreamDead || !cached.body.history.ok || !cached.body.live.ok
            ? { 'X-Oref-Upstream': `hist=${cached.body.history.status},live=${cached.body.live.status}` }
            : {}),
          ...(cached.body.usedOrefPublicHistorySupplement ? { 'X-Oref-Public-History-Supplement': '1' } : {}),
        },
      });
    }

    const result = await loadPromise;
    alertsCache.set(cacheKey, {
      body: result,
      expiresAt: Date.now() + ALERTS_CACHE_TTL_MS,
    });

    const { body, rows, history, live, usedOrefPublicHistorySupplement, upstreamDead } = result;
    if (rows.length === 0 && upstreamDead) {
      return NextResponse.json(
        {
          ...body,
          error: {
            message: `לא ניתן למשוך נתונים מ־oref-map (history HTTP ${history.status}, live HTTP ${live.status}).`,
            hint: 'oref-map חוסם לעיתים IP של Vercel. האפליקציה ממזגת גם סוף ה־CSV מ־dleshem/israel-alerts-data (כמו hatraot), מנסה גיבוי Tzeva, ומשלימה history מ־oref-map.org. אם עדיין ריק — פרוס alerts-proxy והגדר OREF_MAP_PROXY_BASE_URL.',
          },
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0, must-revalidate',
            'X-Alerts-Cache': cached ? 'MISS-REFRESH' : 'MISS',
            'X-Oref-Upstream': `hist=${history.status},live=${live.status}`,
          },
        },
      );
    }

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        'X-Alerts-Cache': cached ? 'MISS-REFRESH' : 'MISS',
        ...(upstreamDead || !history.ok || !live.ok
          ? { 'X-Oref-Upstream': `hist=${history.status},live=${live.status}` }
          : {}),
        ...(usedOrefPublicHistorySupplement ? { 'X-Oref-Public-History-Supplement': '1' } : {}),
      },
    });
  } catch (error) {
    if (cached) {
      return NextResponse.json(cached.body.body, {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          'X-Alerts-Cache': 'STALE-ON-ERROR',
          ...(cached.body.upstreamDead || !cached.body.history.ok || !cached.body.live.ok
            ? { 'X-Oref-Upstream': `hist=${cached.body.history.status},live=${cached.body.live.status}` }
            : {}),
          ...(cached.body.usedOrefPublicHistorySupplement ? { 'X-Oref-Public-History-Supplement': '1' } : {}),
        },
      });
    }

    const message = error instanceof Error ? error.message : 'Failed to load alerts';

    return NextResponse.json(
      {
        ok: true,
        source: 'oref' as const,
        fetchedAt: new Date().toISOString(),
        title: 'Red Alert',
        hasActiveAlerts: false,
        events: [],
        rawCount: 0,
        error: {
          message,
          hint: 'Oref-map proxy failed; check OREF_MAP_PROXY_BASE_URL and network.',
        },
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
        },
      },
    );
  }
}
