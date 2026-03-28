'use client';

import Image from 'next/image';
import { CheckCircle2, TriangleAlert } from 'lucide-react';

import type { AlertCategory, AlertEvent, AlertEventSource } from '@/lib/alert-types';
import { formatDashboardTime } from '@/lib/dashboard-time';
import { cityNameToEnglish } from '@/lib/city-name-en';

const CATEGORY_LABEL_EN: Record<AlertCategory, string> = {
  rockets: 'Missiles',
  'hostile aircraft': 'Hostile aircraft intrusion',
  'early warning': 'In a few minutes, alerts are expected in your area',
  'incident ended': 'The event has ended',
  earthquake: 'Earthquake',
  tsunami: 'Tsunami',
  hazmat: 'Hazardous materials',
  terror: 'Terror',
  unknown: 'Unknown alert type',
};

/** סדר תצוגה בפאנל: מקדים → רקטות → כטב״ם → סיום → שאר. */
const SECTION_ORDER: AlertCategory[] = [
  'early warning',
  'rockets',
  'hostile aircraft',
  'incident ended',
  'unknown',
  'earthquake',
  'tsunami',
  'hazmat',
  'terror',
];

function getEventTitle(event: { category: AlertCategory; endedCategory?: AlertCategory }) {
  if (
    event.category === 'incident ended' &&
    (event.endedCategory === 'rockets' || event.endedCategory === 'hostile aircraft')
  ) {
    return `Incident ended - ${event.endedCategory}`;
  }
  return CATEGORY_LABEL_EN[event.category];
}

interface RightPanelProps {
  groupedAlerts: {
    id: string;
    timestamp: string;
    category: AlertCategory;
    endedCategory?: AlertEvent['endedCategory'];
    source: AlertEventSource;
    cities: string[];
  }[];
  isLoading: boolean;
  error: string | null;
  /** לחיצה על תגית עיר (שם בעברית מהפיד) — התמקדות במפה + tooltip */
  onCityChipClick?: (cityHebrew: string) => void;
}

function CitiesLines({
  cities,
  onCityClick,
}: {
  cities: string[];
  onCityClick?: (cityHebrew: string) => void;
}) {
  const en = cities.map(cityNameToEnglish);
  return (
    <div className="mb-1 flex flex-wrap gap-1.5">
      {en.map((cityEn, i) => {
        const he = cities[i];
        if (!he) return null;
        const interactive = Boolean(onCityClick);
        const inner = (
          <span className="text-xs font-medium leading-none text-[#808080]">{cityEn}</span>
        );
        if (!interactive) {
          return (
            <div
              key={`${he}-${i}`}
              className="max-w-full inline-flex min-h-[1.5rem] items-center justify-center rounded-full bg-[#282828] px-2.5 py-0"
            >
              {inner}
            </div>
          );
        }
        return (
          <button
            key={`${he}-${i}`}
            type="button"
            onClick={() => onCityClick?.(he)}
            className="max-w-full inline-flex min-h-[1.5rem] cursor-pointer items-center justify-center rounded-full bg-[#282828] px-2.5 py-0 transition-colors hover:bg-[#383838]"
            aria-label={`התמקד במפה: ${he}`}
          >
            {inner}
          </button>
        );
      })}
    </div>
  );
}

export function RightPanel({
  groupedAlerts,
  isLoading,
  error,
  onCityChipClick,
}: RightPanelProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full px-6 py-4">
        <p className="text-sm text-muted-foreground animate-pulse">Loading alerts…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full px-6 py-4">
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  const groupedByCategory = new Map<AlertCategory, RightPanelProps['groupedAlerts']>();
  for (const event of groupedAlerts) {
    const arr = groupedByCategory.get(event.category);
    if (arr) {
      arr.push(event);
    } else {
      groupedByCategory.set(event.category, [event]);
    }
  }

  const renderEventRow = (
    event: RightPanelProps['groupedAlerts'][number],
    showDivider: boolean
  ) => {
    const shouldCenterIcon = event.cities.length >= 4;

    return (
    <div
      key={event.id}
      className={`w-full min-w-0 ${
        showDivider ? 'border-b border-border' : ''
      }`}
    >
      <div className="px-0 py-2 flex items-start gap-3">
        {event.category === 'rockets' ? (
          <div className={shouldCenterIcon ? 'shrink-0 self-center' : 'shrink-0'}>
            <Image
              src="/rocket-new.png"
              alt="Rocket alert"
              width={32}
              height={32}
              className={`h-[32px] w-auto object-contain ${shouldCenterIcon ? '' : 'mt-1.5'}`}
              style={{ width: 'auto' }}
            />
          </div>
        ) : event.category === 'hostile aircraft' ? (
          <div className="shrink-0 self-center">
            <Image
              src="/hostile-aircraft.png"
              alt="Hostile aircraft alert"
              width={25}
              height={25}
              className="h-[32px] w-auto object-contain"
              style={{ width: 'auto' }}
            />
          </div>
        ) : event.category === 'early warning' || event.category === 'unknown' ? (
          <div className="shrink-0 self-center ml-1">
            <TriangleAlert className="h-7 w-7 text-yellow-400" />
          </div>
        ) : event.category === 'incident ended' ? (
          <div className="shrink-0 self-center ml-1">
            <CheckCircle2 className="h-7 w-7 text-[rgb(11,197,179)]" />
          </div>
        ) : (
          <span
            className={`h-2 w-2 rounded-full shrink-0 bg-yellow-400 ${shouldCenterIcon ? 'self-center' : 'mt-1'}`}
            aria-hidden
          />
        )}
        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <span
            className={`text-sm font-medium text-[#FFFFFF] ${
              event.category === 'incident ended' ? 'ml-0.9' : ''
            }`}
          >
            {getEventTitle(event)}
          </span>
          <div className={event.category === 'incident ended' ? 'ml-0.9' : ''}>
            <CitiesLines cities={event.cities} onCityClick={onCityChipClick} />
          </div>
        </div>
        <span className="ml-auto text-xs text-muted-foreground shrink-0 pt-0.5">
          {formatDashboardTime(event.timestamp)}
        </span>
      </div>
    </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 overflow-y-auto w-full min-w-0">
        {groupedAlerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full">
            <CheckCircle2 className="h-8 w-8 text-white-foreground" />
            <p className="text-md font-medium text-white-foreground text-center mt-2">
            Quiet for Now
            </p>
            <p className="text-sm text-muted-foreground text-center px-6">
            All clear. No active alerts at this time. 
            </p>
          </div>
        ) : (
          <>
            <div className="px-0 py-1.5 border-b border-border">
              <p className="text-sm font-medium text-white text-left">Recent Alerts</p>
            </div>
            {SECTION_ORDER.map((category) => {
              const eventsInCategory = groupedByCategory.get(category) ?? [];
              if (eventsInCategory.length === 0) return null;

              return (
                <div key={`section-${category}`}>
                  <p
                    className={`text-sm text-muted-foreground px-0 py-1.5 ${
                      category === 'incident ended' ? 'mt-1 ml-1' : ''
                    }`}
                  >
                    {CATEGORY_LABEL_EN[category]}
                  </p>
                  {eventsInCategory.map((event, index) =>
                    renderEventRow(event, index < eventsInCategory.length - 1)
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
