import { NextResponse } from 'next/server';
import { normalizeAlertHistoryPayload } from '@/lib/alert-normalize';
import { fetchOrefMapProxyAsAlertRows } from '@/lib/fetch-oref-map-proxy-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
/** Vercel Pro ומעלה; ב־Hobby נשארת מגבלת 10s — ה־fetch ל־oref מוגבל ל־8s במקביל. */
export const maxDuration = 25;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxEvents = clampInt(Number(url.searchParams.get('maxEvents')), 100, 8000, 2000);
  const scanCap = clampInt(Number(url.searchParams.get('scanCap')), 500, 20000, 2500);

  try {
    const { rows, history, live, usedTzevaFallback, usedOrefPublicHistorySupplement } =
      await fetchOrefMapProxyAsAlertRows();
    const body = normalizeAlertHistoryPayload(rows, {
      maxEvents,
      scanCap,
    });

    // #region agent log
    {
      const rowCat: Record<string, number> = {};
      for (const row of rows) {
        const k = String(row.category ?? 'missing');
        rowCat[k] = (rowCat[k] ?? 0) + 1;
      }
      const eventCat: Record<string, number> = {};
      for (const e of body.events) {
        eventCat[e.category] = (eventCat[e.category] ?? 0) + 1;
      }
      void fetch('http://127.0.0.1:7812/ingest/694a707e-c89a-4075-b2a9-e8688dd5a0e9', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': 'a2558b' },
        body: JSON.stringify({
          sessionId: 'a2558b',
          runId: 'post-fix',
          hypothesisId: 'H1-H2-H4',
          location: 'app/api/alerts/route.ts:GET',
          message: 'server row vs event categories',
          data: {
            rowCat,
            eventCat,
            rowsLen: rows.length,
            eventsLen: body.events.length,
            histOk: history.ok,
            histStatus: history.status,
            liveOk: live.ok,
            liveStatus: live.status,
            usedTzevaFallback: Boolean(usedTzevaFallback),
            usedOrefPublicHistorySupplement: Boolean(usedOrefPublicHistorySupplement),
          },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
    }
    // #endregion

    const upstreamDead = !history.ok && !live.ok;
    if (rows.length === 0 && upstreamDead) {
      return NextResponse.json(
        {
          ...body,
          error: {
            message: `לא ניתן למשוך נתונים מ־oref-map (history HTTP ${history.status}, live HTTP ${live.status}).`,
            hint: 'oref-map חוסם לעיתים IP של Vercel. האפליקציה מנסה גיבוי מ־Tzeva; אם גם הוא נכשל — פרוס את alerts-proxy עם מסלולי /api/history ו־/api/alerts ל־oref והגדר OREF_MAP_PROXY_BASE_URL לכתובת הפרוקסי.',
          },
        },
        {
          headers: {
            'Cache-Control': 'no-store, max-age=0, must-revalidate',
            'X-Oref-Upstream': `hist=${history.status},live=${live.status}`,
          },
        },
      );
    }

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
        ...(upstreamDead || !history.ok || !live.ok
          ? { 'X-Oref-Upstream': `hist=${history.status},live=${live.status}` }
          : {}),
        ...(usedOrefPublicHistorySupplement ? { 'X-Oref-Public-History-Supplement': '1' } : {}),
      },
    });
  } catch (error) {
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
