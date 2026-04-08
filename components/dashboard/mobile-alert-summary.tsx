'use client';

import { CheckCircle2, TriangleAlert } from 'lucide-react';
import Image from 'next/image';

import type { AlertCategory, AlertEvent, AlertEventSource } from '@/lib/alert-types';

/** סדר תצוגה במובייל (למעלה למטה): מטוס עוין → רקטות → מקדים → סיום אירוע */
const SUMMARY_ORDER: AlertCategory[] = [
  'hostile aircraft',
  'rockets',
  'early warning',
  'incident ended',
];

type Grouped = {
  id: string;
  timestamp: string;
  category: AlertCategory;
  endedCategory?: AlertEvent['endedCategory'];
  source: AlertEventSource;
  cities: string[];
  fadeOpacity?: number;
};

function chipLabel(category: AlertCategory, count: number): string {
  const n = Math.max(0, count);
  switch (category) {
    case 'incident ended':
      return `${n} Ended`;
    case 'rockets':
      return `${n} Rocket Alert${n === 1 ? '' : 's'}`;
    case 'hostile aircraft':
      return `${n} Aircraft Alert${n === 1 ? '' : 's'}`;
    case 'early warning':
      return `${n} Early Warning${n === 1 ? '' : 's'}`;
    default:
      return `${n} alerts`;
  }
}

function ChipIcon({ category }: { category: AlertCategory }) {
  if (category === 'incident ended') {
    return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[rgb(11,197,179)]" aria-hidden />;
  }
  if (category === 'rockets') {
    return (
      <Image
        src="/rocket-new.png"
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-auto object-contain opacity-95"
      />
    );
  }
  if (category === 'hostile aircraft') {
    return (
      <Image
        src="/hostile-aircraft.png"
        alt=""
        width={14}
        height={14}
        className="h-3.5 w-auto object-contain opacity-95"
      />
    );
  }
  if (category === 'early warning') {
    return <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-yellow-400" aria-hidden />;
  }
  return null;
}

export function MobileAlertSummary({
  groupedAlerts,
  selectedCategory,
  onSelectCategory,
}: {
  groupedAlerts: Grouped[];
  selectedCategory: AlertCategory | null;
  onSelectCategory: (category: AlertCategory) => void;
}) {
  if (groupedAlerts.length === 0) {
    return null;
  }

  const counts = new Map<AlertCategory, number>();
  for (const g of groupedAlerts) {
    counts.set(g.category, (counts.get(g.category) ?? 0) + 1);
  }

  const chips = SUMMARY_ORDER.filter((c) => (counts.get(c) ?? 0) > 0).map((category) => ({
    category,
    count: counts.get(category) ?? 0,
  }));

  if (chips.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col items-start gap-2 py-0.5">
      {chips.map(({ category, count }) => {
        let chipOpacity = 1;
        for (const g of groupedAlerts) {
          if (g.category === category) {
            chipOpacity = Math.min(chipOpacity, g.fadeOpacity ?? 1);
          }
        }
        const isEnded = category === 'incident ended';
        const isSelected = selectedCategory === category;
        const baseIdle = isEnded ? 'bg-black/55 text-white' : 'bg-black/45 text-white';
        const selectedClasses = isEnded
          ? 'bg-white/15 text-white ring-1 ring-white/20 shadow-sm'
          : 'bg-white/15 text-white ring-1 ring-white/20 shadow-sm';
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelectCategory(category)}
            aria-pressed={isSelected}
            style={{ opacity: chipOpacity }}
            className={`inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 backdrop-blur-md transition-[opacity,color] duration-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/40 ${
              isSelected ? selectedClasses : baseIdle
            }`}
          >
            <ChipIcon category={category} />
            <span className="text-xs font-medium">{chipLabel(category, count)}</span>
          </button>
        );
      })}
    </div>
  );
}
