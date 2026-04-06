import { NextResponse } from 'next/server';
import { fetchOrefUpstreamText, getOrefMapProxyBaseUrl } from '@/lib/fetch-oref-map-proxy-rows';
import { jerusalemDateYmd } from '@/lib/jerusalem-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Proxy ל־`/api/day-history` של oref-map — היסטוריית יום מלא לציר זמן (כמו באתר).
 * ללא `?date=` — משתמשים ביום הנוכחי בזמן ירושלים (כמו בלקוח).
 * @see https://github.com/maorcc/oref-map/blob/main/functions/api/day-history.js
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get('date');
  let date: string;
  if (!raw?.trim()) {
    date = jerusalemDateYmd();
  } else if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return NextResponse.json({ error: 'Query ?date= must be YYYY-MM-DD' }, { status: 400 });
  } else {
    date = raw;
  }

  const base = getOrefMapProxyBaseUrl();
  const upstream = `${base}/api/day-history?date=${encodeURIComponent(date)}`;

  try {
    const { ok, text, status } = await fetchOrefUpstreamText(upstream);

    const dateHeaders = {
      'Cache-Control': 'no-store',
      'X-Day-History-Date': date,
    } as const;

    if (status === 404) {
      return NextResponse.json([], {
        headers: dateHeaders,
      });
    }

    if (!ok) {
      console.warn('[day-history] upstream HTTP', status, upstream.slice(0, 80));
      return NextResponse.json([], {
        headers: {
          ...dateHeaders,
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
          ...dateHeaders,
          'X-Day-History-Fallback': 'invalid-json',
        },
      });
    }

    return NextResponse.json(Array.isArray(data) ? data : [], {
      headers: dateHeaders,
    });
  } catch (e) {
    console.warn('[day-history] fetch error', e);
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store',
        'X-Day-History-Date': date,
        'X-Day-History-Fallback': 'network',
      },
    });
  }
}
