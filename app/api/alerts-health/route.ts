import { NextResponse } from 'next/server';
import { normalizeAlertHistoryPayload } from '@/lib/alert-normalize';
import { fetchOrefMapProxyAsAlertRows } from '@/lib/fetch-oref-map-proxy-rows';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 25;

const DEFAULT_MAX_EVENTS = 8000;
const DEFAULT_SCAN_CAP = 12000;

/**
 * סיכום ללא PII — להשוואת לוקאל מול production (סטטוס upstream, ספירות קטגוריות).
 * אם מוגדר `ALERTS_HEALTH_SECRET` ב־env — נדרש `?secret=...`.
 */
export async function GET(request: Request) {
  const required = process.env.ALERTS_HEALTH_SECRET?.trim();
  if (required) {
    const url = new URL(request.url);
    if (url.searchParams.get('secret') !== required) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const {
      rows,
      history,
      live,
      usedOrefPublicHistorySupplement,
      usedTzevaFallback,
    } = await fetchOrefMapProxyAsAlertRows();

    const body = normalizeAlertHistoryPayload(rows, {
      maxEvents: DEFAULT_MAX_EVENTS,
      scanCap: DEFAULT_SCAN_CAP,
    });

    const eventCategoryCounts: Record<string, number> = {};
    for (const e of body.events) {
      eventCategoryCounts[e.category] = (eventCategoryCounts[e.category] ?? 0) + 1;
    }

    const rowCategoryCodes: Record<string, number> = {};
    for (const r of rows) {
      const k = String(r.category ?? 'na');
      rowCategoryCodes[k] = (rowCategoryCodes[k] ?? 0) + 1;
    }

    const upstreamDead = !history.ok && !live.ok;

    return NextResponse.json(
      {
        ok: true,
        fetchedAt: body.fetchedAt,
        upstream: {
          history: { ok: history.ok, status: history.status },
          live: { ok: live.ok, status: live.status },
          upstreamDead,
        },
        flags: {
          usedOrefPublicHistorySupplement: Boolean(usedOrefPublicHistorySupplement),
          usedTzevaFallback: Boolean(usedTzevaFallback),
        },
        pipeline: {
          rowsIncoming: rows.length,
          rawCount: body.rawCount,
          eventsReturned: body.events.length,
          maxEvents: DEFAULT_MAX_EVENTS,
          scanCap: DEFAULT_SCAN_CAP,
        },
        rowCategoryCodes,
        eventCategoryCounts,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0, must-revalidate',
          ...(upstreamDead || !history.ok || !live.ok
            ? { 'X-Oref-Upstream': `hist=${history.status},live=${live.status}` }
            : {}),
          ...(usedOrefPublicHistorySupplement ? { 'X-Oref-Public-History-Supplement': '1' } : {}),
        },
      },
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown';
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
