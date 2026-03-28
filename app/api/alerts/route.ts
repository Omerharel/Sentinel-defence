import { NextResponse } from 'next/server';
import { normalizeAlertHistoryPayload } from '@/lib/alert-normalize';
import { fetchOrefMapProxyAsAlertRows } from '@/lib/fetch-oref-map-proxy-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const maxEvents = clampInt(Number(url.searchParams.get('maxEvents')), 100, 8000, 2000);
  const scanCap = clampInt(Number(url.searchParams.get('scanCap')), 500, 20000, 2500);

  try {
    const rows = await fetchOrefMapProxyAsAlertRows();
    const body = normalizeAlertHistoryPayload(rows, {
      maxEvents,
      scanCap,
    });

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'no-store, max-age=0, must-revalidate',
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
