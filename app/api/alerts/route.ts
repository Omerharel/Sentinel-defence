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
    const { rows, history, live } = await fetchOrefMapProxyAsAlertRows();
    const body = normalizeAlertHistoryPayload(rows, {
      maxEvents,
      scanCap,
    });

    const upstreamDead = !history.ok && !live.ok;
    if (rows.length === 0 && upstreamDead) {
      return NextResponse.json(
        {
          ...body,
          error: {
            message: `לא ניתן למשוך נתונים מ־oref-map (history HTTP ${history.status}, live HTTP ${live.status}).`,
            hint: 'ב־Vercel ודא ש־OREF_MAP_PROXY_BASE_URL אינו localhost; אם חוסמים את ה־IP של Vercel, שקול פרוקסי משלך או שדרוג Pro עם maxDuration ארוך יותר.',
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
