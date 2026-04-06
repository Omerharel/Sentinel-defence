import { NextResponse } from 'next/server';
import { fetchOrefUpstreamText, getOrefMapProxyBaseUrl } from '@/lib/fetch-oref-map-proxy-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Proxy ל־`/api/day-history` של oref-map — היסטוריית יום מלא לציר זמן (כמו באתר).
 * @see https://github.com/maorcc/oref-map/blob/main/functions/api/day-history.js
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get('date');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'Query ?date=YYYY-MM-DD is required' }, { status: 400 });
  }

  const base = getOrefMapProxyBaseUrl();
  const upstream = `${base}/api/day-history?date=${encodeURIComponent(date)}`;

  try {
    const { ok, text, status } = await fetchOrefUpstreamText(upstream);

    if (status === 404) {
      return NextResponse.json([], {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (!ok) {
      console.warn('[day-history] upstream HTTP', status, upstream.slice(0, 80));
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'no-store',
          'X-Day-History-Fallback': `upstream-${status}`,
        },
      });
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      console.warn('[day-history] invalid JSON from upstream', upstream.slice(0, 80));
      return NextResponse.json([], {
        headers: {
          'Cache-Control': 'no-store',
          'X-Day-History-Fallback': 'invalid-json',
        },
      });
    }

    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    console.warn('[day-history] fetch error', e);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store',
        'X-Day-History-Fallback': 'network',
      },
    });
  }
}
