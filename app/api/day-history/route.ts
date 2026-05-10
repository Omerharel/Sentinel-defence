import { NextResponse } from 'next/server';
import { fetchTzevaAlertsHistoryAsRows } from '@/lib/tzeva-alerts-history-rows';
import { jerusalemDateYmd } from '@/lib/jerusalem-calendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 25;

/**
 * Timeline day-history based on Tzeva Adom alerts-history feed.
 * Returns oref-like row objects expected by timeline normalizer.
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

  try {
    const rows = await fetchTzevaAlertsHistoryAsRows(7000);
    const dayRows = rows.filter((r) => typeof r.alertDate === 'string' && r.alertDate.startsWith(date));
    const timelineRows = dayRows.map((r, i) => ({
      rid: `tzeva-${date}-${i}`,
      data: r.data,
      category_desc: r.title,
      alertDate: r.alertDate,
    }));

    const dateHeaders: Record<string, string> = {
      'Cache-Control': 'no-store',
      'X-Day-History-Date': date,
      'X-Day-History-Source': 'tzevaadom',
    };

    return NextResponse.json(timelineRows, {
      headers: dateHeaders,
    });
  } catch {
    return NextResponse.json([], {
      headers: {
        'Cache-Control': 'no-store',
        'X-Day-History-Date': date,
        'X-Day-History-Source': 'tzevaadom',
        'X-Day-History-Fallback': 'tzeva-network',
      },
    });
  }
}
