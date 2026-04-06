import { NextResponse } from 'next/server';
import { fetchOrefUpstreamText, getOrefMapProxyBaseUrl } from '@/lib/fetch-oref-map-proxy-rows';
import { jerusalemDateYmd } from '@/lib/jerusalem-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 25;

const OREF_PUBLIC_BASE = 'https://oref-map.org';

function parseDayHistoryArray(text: string): unknown[] | null {
  try {
    const data = JSON.parse(text) as unknown;
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}

/**
 * Proxy ל־`/api/day-history` של oref-map — היסטוריית יום מלא לציר זמן (כמו באתר).
 * ללא `?date=` — משתמשים ביום הנוכחי בזמן ירושלים (כמו בלקוח).
 * אם הבסיס מ־`OREF_MAP_PROXY_BASE_URL` נכשל (403/timeout וכו') — ניסיון שני מ־oref-map.org הציבורי.
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

  const base = getOrefMapProxyBaseUrl().replace(/\/$/, '');
  const pathAndQuery = `/api/day-history?date=${encodeURIComponent(date)}`;
  const primaryUrl = `${base}${pathAndQuery}`;
  const publicUrl = `${OREF_PUBLIC_BASE}${pathAndQuery}`;

  try {
    const first = await fetchOrefUpstreamText(primaryUrl);
    let rows: unknown[] | null = null;
    let usedPublicFallback = false;

    if (first.ok) {
      rows = parseDayHistoryArray(first.text);
    }

    if (rows === null && publicUrl !== primaryUrl) {
      const second = await fetchOrefUpstreamText(publicUrl);
      if (second.ok) {
        const parsed = parseDayHistoryArray(second.text);
        if (parsed !== null) {
          rows = parsed;
          usedPublicFallback = true;
        }
      }
    }

    if (rows === null) {
      rows = [];
    }

    const dateHeaders: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Day-History-Date': date,
    };
    if (!first.ok) {
      dateHeaders['X-Day-History-Upstream-Primary'] = String(first.status);
    }
    if (usedPublicFallback) {
      dateHeaders['X-Day-History-Public-Fallback'] = '1';
    } else if (rows.length === 0 && !first.ok) {
      dateHeaders['X-Day-History-Fallback'] = `upstream-${first.status}`;
    }

    return NextResponse.json(rows, {
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
