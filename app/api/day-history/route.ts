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
      return NextResponse.json(
        { error: `Upstream day-history HTTP ${status}` },
        { status: 502 },
      );
    }

    let data: unknown;
    try {
      data = JSON.parse(text) as unknown;
    } catch {
      return NextResponse.json({ error: 'Invalid JSON from upstream' }, { status: 502 });
    }

    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'day-history fetch failed';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
