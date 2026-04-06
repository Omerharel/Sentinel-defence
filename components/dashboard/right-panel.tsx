'use client';

import Image from 'next/image';
import { CheckCircle2, TriangleAlert } from 'lucide-react';

import type { AlertCategory, AlertEvent, AlertEventSource } from '@/lib/alert-types';
import { RadarIdleIcon } from '@/components/dashboard/radar-idle-icon';
import { formatDashboardTime } from '@/lib/dashboard-time';
import { cityNameToEnglish } from '@/lib/city-name-en';

const CATEGORY_LABEL_EN: Record<AlertCategory, string> = {
  rockets: 'Missiles',
  'hostile aircraft': 'Hostile aircraft intrusion',
  'early warning': 'Early warning',
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
  /** מובייל: גובה לפי תוכן + גלילה ב-wrapper החיצוני */
  mobileSheet?: boolean;
}

const MAX_CITY_CHIPS = 2;

function CitiesLines({
  cities,
  onCityClick,
  compactRow,
}: {
  cities: string[];
  onCityClick?: (cityHebrew: string) => void;
  /** מובייל: שורה אחת, 2 שמות + תגית +N */
  compactRow?: boolean;
}) {
  const en = cities.map(cityNameToEnglish);
  const interactive = Boolean(onCityClick);

  if (!compactRow) {
    return (
      <div className="mb-1 flex flex-wrap gap-1.5">
        {en.map((cityEn, i) => {
          const he = cities[i];
          if (!he) return null;
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

  const count = cities.length;
  const showCount = Math.min(count, MAX_CITY_CHIPS);
  const extra = count > MAX_CITY_CHIPS ? count - MAX_CITY_CHIPS : 0;

  const chipClass =
    'max-w-[min(100%,11rem)] shrink min-w-0 inline-flex min-h-[1.5rem] items-center justify-center rounded-full bg-[#282828] px-2.5 py-0';
  const nameClass = 'truncate text-xs font-medium leading-none text-[#808080]';

  return (
    <div className="mb-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden">
      {Array.from({ length: showCount }, (_, i) => {
        const he = cities[i];
        const cityEn = en[i];
        if (!he || cityEn === undefined) return null;
        const inner = <span className={nameClass}>{cityEn}</span>;
        if (!interactive) {
          return (
            <div key={`${he}-${i}`} className={chipClass}>
              {inner}
            </div>
          );
        }
        return (
          <button
            key={`${he}-${i}`}
            type="button"
            onClick={() => onCityClick?.(he)}
            className={`${chipClass} cursor-pointer transition-colors hover:bg-[#383838]`}
            aria-label={`התמקד במפה: ${he}`}
          >
            {inner}
          </button>
        );
      })}
      {extra > 0 ? (
        <div
          className="inline-flex min-h-[1.5rem] shrink-0 items-center justify-center rounded-full bg-[#282828] px-2.5 py-0"
          aria-label={`ועוד ${extra} יישובים`}
        >
          <span className="text-xs font-medium leading-none text-[#808080]">+{extra}</span>
        </div>
      ) : null}
    </div>
  );
}

export function RightPanel({
  groupedAlerts,
  isLoading,
  error,
  onCityChipClick,
  mobileSheet = false,
}: RightPanelProps) {
  if (isLoading) {
    return (
      <div
        className={`flex items-center justify-center bg-background px-4 py-4 lg:px-6 ${
          mobileSheet ? 'min-h-[6rem] py-8' : 'h-full'
        }`}
      >
        <p className="text-sm text-muted-foreground animate-pulse">Loading alerts…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={`flex items-center justify-center bg-background px-4 py-4 lg:px-6 ${
          mobileSheet ? 'min-h-[6rem] py-8' : 'h-full'
        }`}
      >
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
      <div className="flex items-start gap-3 py-2">
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
        <div
          className={`flex min-w-0 flex-1 flex-col gap-1.5 ${
            event.category === 'incident ended' ? 'ml-0.9' : ''
          }`}
        >
          <span className="text-sm font-medium text-[#FFFFFF]">
            {formatDashboardTime(event.timestamp)}
          </span>
          <CitiesLines
            cities={event.cities}
            onCityClick={onCityChipClick}
            compactRow={mobileSheet}
          />
        </div>
      </div>
    </div>
    );
  };

  const scrollBody = mobileSheet ? 'overflow-visible' : 'min-h-0 flex-1 overflow-y-auto';
  const rootSheet = mobileSheet ? 'flex flex-col bg-background' : 'flex flex-col h-full min-h-0 overflow-hidden bg-background';

  return (
    <div className={rootSheet}>
      <div className={`${scrollBody} bg-background w-full min-w-0 px-4 lg:px-0`}>
        {groupedAlerts.length === 0 ? (
          <div
            className={`flex flex-col items-center justify-center bg-background ${
              mobileSheet ? 'py-10' : 'h-full'
            }`}
          >
            <span className="inline-flex shrink-0" role="img" aria-label="No active alerts">
              <RadarIdleIcon size={56} />
            </span>
            <p className="text-md font-medium text-white-foreground text-center mt-2">
            Quiet for Now
            </p>
            <p className="text-sm text-muted-foreground text-center">
            All clear. No active alerts at this time. 
            </p>
          </div>
        ) : (
          <>
            <div className="border-b border-border bg-background px-0 py-1.5">
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
