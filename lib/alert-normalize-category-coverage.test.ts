import { describe, expect, it } from 'vitest';
import {
  normalizeAlertHistoryPayload,
  parseHistoryAlertDateToEpochMs,
  type AlertHistoryRow,
} from '@/lib/alert-normalize';
import type { AlertCategory } from '@/lib/alert-types';

const alertDate = '2026-06-15 10:00:00';
const nowMs = (parseHistoryAlertDateToEpochMs(alertDate) ?? 0) + 120_000;

function baseRow(partial: Partial<AlertHistoryRow> & Pick<AlertHistoryRow, 'data' | 'title'>): AlertHistoryRow {
  return {
    alertDate,
    data: partial.data,
    title: partial.title,
    category: partial.category,
  };
}

describe('normalizeAlertHistoryPayload — כיסוי קטגוריות', () => {
  it('מייצר אירוע לכל סוג AlertCategory מהשורות', () => {
    const rows: AlertHistoryRow[] = [
      baseRow({ data: 'תל אביב', title: 'ירי רקטות וטילים', category: 1 }),
      baseRow({ data: 'חיפה', title: 'חדירת כלי טיס עוין', category: 2 }),
      baseRow({ data: 'אילת', title: 'התרעה מקדימה', category: 7 }),
      baseRow({ data: 'באר שבע', title: 'האירוע הסתיים', category: 13 }),
      baseRow({ data: 'טבריה', title: 'רעידת אדמה', category: 3 }),
      baseRow({ data: 'אילת', title: 'צונאמי', category: 4 }),
      baseRow({ data: 'חולון', title: 'נשק לא קונבנציונלי', category: 5 }),
      baseRow({ data: 'ירושלים', title: 'חדירת מחבלים', category: 6 }),
      baseRow({ data: 'נתניה', title: 'כותרת לא ממופה', category: 99 }),
    ];

    const out = normalizeAlertHistoryPayload(rows, {
      maxEvents: 100,
      scanCap: 500,
      nowMs,
    });

    const cats = new Set(out.events.map((e) => e.category));
    const expected: AlertCategory[] = [
      'rockets',
      'hostile aircraft',
      'early warning',
      'incident ended',
      'earthquake',
      'tsunami',
      'hazmat',
      'terror',
      'unknown',
    ];
    for (const c of expected) {
      expect(cats.has(c), `חסרה קטגוריה: ${c}`).toBe(true);
    }
  });
});
