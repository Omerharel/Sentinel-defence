'use client';

import type { MouseEvent, PointerEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Settings } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { LastUpdate } from '@/components/dashboard/last-update';
import { MapPanel, type MapFocusCityRequest } from '@/components/dashboard/map-panel';
import { MobileAlertSummary } from '@/components/dashboard/mobile-alert-summary';
import { RightPanel } from '@/components/dashboard/right-panel';
import type { AlertCategory, AlertEvent, AlertEventSource, AlertsResponse } from '@/lib/alert-types';
import { mergePollIntoAlertHistory } from '@/lib/alert-history-merge';
import {
  isAlertEventInActiveWindow,
  isAlertEventInListHistoryRetention,
  isAlertEventInRightPanelListWindow,
  normalizeAlertHistoryPayload,
} from '@/lib/alert-normalize';
import { getAlertListMergeMinuteKey } from '@/lib/dashboard-time';
import { MAP_POLYGON_FADE_MS } from '@/lib/map-polygon-fade-ms';
import { getApiUrl } from '@/lib/api-base';
import { APP_VERSION } from '@/lib/app-version';
import { cn } from '@/lib/utils';

const POLLING_INTERVAL_MS = 4000;
const SILENT_ALERTS_STORAGE_KEY = 'sentinel-silent-alerts';
const ALERT_SOUND_SRC = '/bell.mp3';
const INCIDENT_ENDED_SOUND_SRC = '/Notification sound.mp3';
const ALERT_SOUND_COOLDOWN_MS = 30 * 1000;
/** מקסימום אירועים ייחודיים בהיסטוריית הרשימה במפגש (לפי id). */
const MAX_ALERT_HISTORY = 2000;

/**
 * מזהה יציב לצליל — לא תלוי ב־`id` מהשרת (שכולל אינדקס `i` שמשתנה כשסדר השורות בפיד משתנה).
 */
function stableSoundFingerprint(e: AlertEvent): string {
  const t = Date.parse(e.timestamp);
  const sec = Number.isNaN(t) ? 0 : Math.floor(t / 1000);
  return `${e.city}|${sec}|${e.category}|${e.endedCategory ?? ''}`;
}

function looksLikeHistoryRows(payload: unknown[]): boolean {
  if (payload.length === 0) return true;
  const first = payload[0];
  if (!first || typeof first !== 'object') return false;
  const row = first as Record<string, unknown>;
  return (
    typeof row.alertDate === 'string' &&
    typeof row.data === 'string' &&
    (row.category === undefined || typeof row.category === 'number')
  );
}

export function DashboardShell() {
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  /** התראות שראינו במפגש — הרשימה נשארת גם כשהפיד הנוכחי התרוקן. */
  const [historyEvents, setHistoryEvents] = useState<AlertEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapFocusCityRequest, setMapFocusCityRequest] = useState<MapFocusCityRequest | null>(null);
  /** מרענן סינון חלון הפאנל הימני בלי להמתין ל־poll */
  const [rightPanelTimeTick, setRightPanelTimeTick] = useState(0);
  /** מובייל: פילטר לפי קטגוריה ב־pills — null = כל ההתראות */
  const [mobileAlertFilter, setMobileAlertFilter] = useState<AlertCategory | null>(null);
  const [silentAlerts, setSilentAlerts] = useState(false);
  const silentAlertsRef = useRef(false);

  useEffect(() => {
    silentAlertsRef.current = silentAlerts;
  }, [silentAlerts]);

  useEffect(() => {
    try {
      if (localStorage.getItem(SILENT_ALERTS_STORAGE_KEY) === '1') {
        setSilentAlerts(true);
      }
    } catch {
      // ignore
    }
  }, []);

  const handleSilentAlertsChange = useCallback((checked: boolean) => {
    setSilentAlerts(checked);
    try {
      localStorage.setItem(SILENT_ALERTS_STORAGE_KEY, checked ? '1' : '0');
    } catch {
      // ignore
    }
  }, []);

  const handleCityChipClick = useCallback((cityHebrew: string) => {
    setMapFocusCityRequest((prev) => ({
      city: cityHebrew,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  const seenIdsRef = useRef<Set<string>>(new Set());
  /** טביעות שכבר שמענו — נפרד מ־id כדי לא לנגן צליל כשהפיד רק מחדש מזהים. */
  const soundFingerprintsSeenRef = useRef<Set<string>>(new Set());
  const hasHydratedOnceRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endedAudioRef = useRef<HTMLAudioElement | null>(null);
  const hasUserInteractedRef = useRef(false);
  const isAudioUnlockedRef = useRef(false);
  const isEndedAudioUnlockedRef = useRef(false);
  const lastSoundPlayedAtRef = useRef(0);

  /** סנכרון fade עם פוליגונים במפה — אירוע שיצא מחלון פעיל נשאר ברשימה עם opacity יורדת. */
  const prevActiveEventIdsRef = useRef<Set<string>>(new Set());
  const fadeOutStartedAtRef = useRef<Map<string, number>>(new Map());
  const [fadeListTick, setFadeListTick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setFadeListTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (hasUserInteractedRef.current) return;

    const markInteraction = () => {
      hasUserInteractedRef.current = true;
      isAudioUnlockedRef.current = true;
      isEndedAudioUnlockedRef.current = true;

      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
    };

    window.addEventListener('pointerdown', markInteraction, { passive: true });
    window.addEventListener('keydown', markInteraction);
    window.addEventListener('touchstart', markInteraction, { passive: true });

    return () => {
      window.removeEventListener('pointerdown', markInteraction);
      window.removeEventListener('keydown', markInteraction);
      window.removeEventListener('touchstart', markInteraction);
    };
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setRightPanelTimeTick((n) => n + 1), 10_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let isMounted = true;
    let interval: ReturnType<typeof setInterval> | undefined;

    try {
      if (!audioRef.current) {
        audioRef.current = new Audio(ALERT_SOUND_SRC);
        audioRef.current.preload = 'auto';
      }
      if (!endedAudioRef.current) {
        endedAudioRef.current = new Audio(INCIDENT_ENDED_SOUND_SRC);
        endedAudioRef.current.preload = 'auto';
      }
      if (hasUserInteractedRef.current) {
        isAudioUnlockedRef.current = true;
        isEndedAudioUnlockedRef.current = true;
      }
    } catch {
      // ignore
    }

    const loadAlerts = async () => {
      try {
        const response = await fetch(getApiUrl('/alerts?maxEvents=2000&scanCap=4000'), {
          cache: 'no-store',
        });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error?.message || 'Failed to fetch alerts');
        }

        let normalized: AlertsResponse;
        if (Array.isArray(data)) {
          if (looksLikeHistoryRows(data)) {
            normalized = normalizeAlertHistoryPayload(data, { maxEvents: 2000, scanCap: 4000 });
          } else {
            normalized = {
              ok: true,
              fetchedAt: new Date().toISOString(),
              title: 'Sentinel Defense',
              hasActiveAlerts: data.length > 0,
              events: data as AlertEvent[],
              rawCount: data.length ?? 0,
              source: 'oref',
            };
          }
        } else {
          normalized = data as AlertsResponse;
        }

        if (!isMounted) return;

        let newEndedCount = 0;
        let newRocketCount = 0;
        const isInitialPoll = !hasHydratedOnceRef.current;
        for (const e of normalized.events) {
          if (!seenIdsRef.current.has(e.id)) {
            seenIdsRef.current.add(e.id);
          }
          const fp = stableSoundFingerprint(e);
          if (isInitialPoll) {
            soundFingerprintsSeenRef.current.add(fp);
          } else if (!soundFingerprintsSeenRef.current.has(fp)) {
            soundFingerprintsSeenRef.current.add(fp);
            /** רק "סיום אירוע" שעדיין בחלון הפעיל (TTL) — לא שורות היסטוריה שנכנסות לפול אחרי שרקטה ירדה מהמפה */
            if (e.category === 'incident ended' && isAlertEventInActiveWindow(e, Date.now())) {
              newEndedCount += 1;
            }
            if (e.category === 'rockets') {
              newRocketCount += 1;
            }
          }
        }
        hasHydratedOnceRef.current = true;

        setAlerts(() => {
          const byId = new Map<string, AlertsResponse['events'][number]>();
          for (const e of normalized.events) byId.set(e.id, e);

          const events = Array.from(byId.values()).sort((a, b) => {
            const ta = Date.parse(a.timestamp);
            const tb = Date.parse(b.timestamp);
            if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
            return tb - ta;
          });

          return {
            ...normalized,
            events,
            hasActiveAlerts: normalized.hasActiveAlerts,
            rawCount: normalized.rawCount ?? events.length,
          };
        });

        const apiSorted = Array.from(new Map(normalized.events.map((e) => [e.id, e] as const)).values()).sort(
          (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
        );
        setHistoryEvents((prev) => mergePollIntoAlertHistory(apiSorted, prev, MAX_ALERT_HISTORY));

        const payloadErr =
          !Array.isArray(data) && data && typeof data === 'object' && 'error' in data
            ? (data as AlertsResponse & { error?: { message?: string; hint?: string } }).error
            : undefined;
        if (normalized.events.length === 0 && payloadErr?.message) {
          setError(
            [payloadErr.message, payloadErr.hint].filter((s): s is string => Boolean(s)).join(' — '),
          );
        } else {
          setError(null);
        }

        const shouldPlayEndedSound = newEndedCount > 0;
        const shouldPlayRocketSound = !shouldPlayEndedSound && newRocketCount > 0;
        const targetAudio = shouldPlayEndedSound ? endedAudioRef.current : audioRef.current;
        const isTargetUnlocked = shouldPlayEndedSound
          ? isEndedAudioUnlockedRef.current
          : isAudioUnlockedRef.current;

        if (
          (shouldPlayEndedSound || shouldPlayRocketSound) &&
          targetAudio &&
          hasUserInteractedRef.current &&
          isTargetUnlocked &&
          !silentAlertsRef.current &&
          Date.now() - lastSoundPlayedAtRef.current >= ALERT_SOUND_COOLDOWN_MS
        ) {
          try {
            targetAudio.currentTime = 0;
            void targetAudio
              .play()
              .then(() => {
                lastSoundPlayedAtRef.current = Date.now();
              })
              .catch(() => undefined);
          } catch {
            // ignore
          }
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch alerts');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadAlerts();
    interval = setInterval(loadAlerts, POLLING_INTERVAL_MS);

    /** טאב ברקע: הדפדפן מאט את setInterval (לעיתים דקות) — בפרודקשן זה נראה כ"עיכוב" מול לוקאל עם טאב פעיל. */
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAlerts();
    };
    document.addEventListener('visibilitychange', onVisible);

    const onOnline = () => {
      void loadAlerts();
    };
    window.addEventListener('online', onOnline);

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  const groupedAlerts = useMemo(() => {
    const now = Date.now();

    const activeIds = new Set<string>();
    for (const e of historyEvents) {
      if (isAlertEventInRightPanelListWindow(e, now)) activeIds.add(e.id);
    }

    for (const [id, start] of [...fadeOutStartedAtRef.current.entries()]) {
      if (now - start >= MAP_POLYGON_FADE_MS) {
        fadeOutStartedAtRef.current.delete(id);
      }
    }

    const prev = prevActiveEventIdsRef.current;
    for (const id of prev) {
      if (!activeIds.has(id) && !fadeOutStartedAtRef.current.has(id)) {
        fadeOutStartedAtRef.current.set(id, now);
      }
    }
    for (const id of activeIds) {
      fadeOutStartedAtRef.current.delete(id);
    }
    prevActiveEventIdsRef.current = new Set(activeIds);

    const rowFadeOpacity = (e: AlertEvent): number => {
      if (isAlertEventInRightPanelListWindow(e, now)) return 1;
      const t0 = fadeOutStartedAtRef.current.get(e.id);
      if (t0 == null) return 0;
      const k = (now - t0) / MAP_POLYGON_FADE_MS;
      if (k >= 1) return 0;
      return 1 - k;
    };

    const events = historyEvents.filter(
      (e) =>
        isAlertEventInRightPanelListWindow(e, now) || fadeOutStartedAtRef.current.has(e.id),
    );

    /** לכל יישוב רק האירוע האחרון בזמן — כך "סיום אירוע" מחליף רקטה/מקדים לאותו יישוב (רק אירועים בחלון פעיל). */
    const sortedByTime = [...events].sort(
      (a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp),
    );
    const latestByCity = new Map<string, AlertEvent>();
    for (const e of sortedByTime) {
      latestByCity.set(e.city, e);
    }
    const perCityLatest = Array.from(latestByCity.values());

    const groups = new Map<
      string,
      {
        id: string;
        timestamp: string;
        category: AlertCategory;
        endedCategory?: AlertEvent['endedCategory'];
        source: AlertEventSource;
        cities: string[];
        fadeOpacity: number;
      }
    >();

    for (const e of perCityLatest) {
      const minuteKey = getAlertListMergeMinuteKey(e.timestamp);
      /** `endedCategory` משתנה בין פידים (oref עם כותרת מפורטת מול Tzeva גנרי) — לא לפצל שורות סיום לאותה דקה */
      const groupKey =
        e.category === 'incident ended'
          ? `${minuteKey}|incident ended`
          : `${minuteKey}|${e.category}|${e.endedCategory ?? ''}`;
      const existing = groups.get(groupKey);
      const t = Date.parse(e.timestamp);
      const op = rowFadeOpacity(e);
      if (!existing) {
        groups.set(groupKey, {
          id: groupKey,
          timestamp: e.timestamp,
          category: e.category,
          endedCategory: e.endedCategory,
          source: e.source,
          cities: [e.city],
          fadeOpacity: op,
        });
      } else {
        if (!existing.cities.includes(e.city)) {
          existing.cities.push(e.city);
        }
        if (e.endedCategory != null && existing.endedCategory == null) {
          existing.endedCategory = e.endedCategory;
        }
        existing.fadeOpacity = Math.min(existing.fadeOpacity, op);
        const pt = Date.parse(existing.timestamp);
        if (!Number.isNaN(t) && (Number.isNaN(pt) || t > pt)) {
          existing.timestamp = e.timestamp;
        }
      }
    }

    return Array.from(groups.values()).sort((a, b) => {
      const ta = Date.parse(a.timestamp);
      const tb = Date.parse(b.timestamp);
      if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
      return tb - ta;
    });
  }, [historyEvents, rightPanelTimeTick, fadeListTick]);

  /** סנכרון מפה ↔ רשימה: אירועים ב־fade-out עדיין מקבלים פוליגון בזמן "עכשיו". */
  const fadingMapEventIds = useMemo(() => {
    const now = Date.now();
    const out: string[] = [];
    for (const [id, start] of fadeOutStartedAtRef.current.entries()) {
      if (now - start < MAP_POLYGON_FADE_MS) out.push(id);
    }
    return out;
  }, [historyEvents, fadeListTick, rightPanelTimeTick]);

  const mapPanelEventPool = useMemo(() => {
    const now = Date.now();
    const events = historyEvents.filter((e) => isAlertEventInListHistoryRetention(e, now));
    const sorted = [...events].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const byId = new Map<string, AlertEvent>();
    for (const e of sorted) {
      if (!byId.has(e.id)) byId.set(e.id, e);
    }
    return Array.from(byId.values());
  }, [historyEvents]);

  const summary = useMemo(
    () => ({
      fetchedAt: alerts?.fetchedAt,
    }),
    [alerts],
  );

  const mobileSheetGroupedAlerts = useMemo(() => {
    if (mobileAlertFilter === null) return groupedAlerts;
    return groupedAlerts.filter((g) => g.category === mobileAlertFilter);
  }, [groupedAlerts, mobileAlertFilter]);

  const handleMobileCategoryClick = useCallback((cat: AlertCategory) => {
    setMobileAlertFilter((prev) => (prev === cat ? null : cat));
  }, []);

  useEffect(() => {
    if (groupedAlerts.length === 0) setMobileAlertFilter(null);
  }, [groupedAlerts.length]);

  const rightPanelProps = {
    groupedAlerts,
    isLoading,
    error,
    onCityChipClick: handleCityChipClick,
  } as const;

  return (
    <div className="h-[100dvh] min-h-0 bg-background flex flex-col font-sans">
      <main className="flex-1 flex min-h-0 flex-col gap-0 overflow-hidden lg:gap-2 lg:p-4">
        <div className="hidden w-full flex-wrap items-center justify-between gap-3 lg:flex">
          <LastUpdate fetchedAt={summary.fetchedAt} isLoading={isLoading} />
          <SettingsMenu
            silentAlerts={silentAlerts}
            onSilentAlertsChange={handleSilentAlertsChange}
            triggerClassName="inline-flex h-9 w-9 shrink-0 items-center justify-center text-white transition-colors hover:bg-white/10 focus-visible:outline-none"
          />
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row lg:gap-2">
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-card lg:rounded-sm">
            <div className="pointer-events-none absolute inset-0 z-[1] bg-black/20 lg:hidden" aria-hidden />
            <div className="relative z-0 min-h-0 flex-1">
              <MapPanel
                alerts={mapPanelEventPool}
                fadingEventIds={fadingMapEventIds}
                focusCityRequest={mapFocusCityRequest}
              />
            </div>

            <div
              className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col items-stretch gap-2 px-3 pb-10 lg:hidden"
              style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
            >
              <div className="pointer-events-auto flex w-full max-w-md flex-col items-start gap-2 self-start">
                <MobileAlertSummary
                  groupedAlerts={groupedAlerts}
                  selectedCategory={mobileAlertFilter}
                  onSelectCategory={handleMobileCategoryClick}
                />
              </div>
            </div>

            <div
              className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-end gap-3 px-3 pt-3 lg:hidden"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <div className="pointer-events-auto flex w-full shrink-0 flex-row items-center justify-between gap-2">
                <div className="rounded-full bg-black/45 px-4 py-2 backdrop-blur-md">
                  <LastUpdate fetchedAt={summary.fetchedAt} isLoading={isLoading} />
                </div>
                <SettingsMenu
                  silentAlerts={silentAlerts}
                  onSilentAlertsChange={handleSilentAlertsChange}
                  triggerClassName="inline-flex h-10 w-10 shrink-0 items-center justify-center border-none bg-black/45 text-white backdrop-blur-md transition-colors hover:bg-black/55 focus-visible:outline-none"
                />
              </div>
              <div className="pointer-events-auto min-h-0 max-h-[min(52vh,calc(100dvh-10rem))] w-full overflow-y-auto overflow-x-hidden rounded-2xl border border-border/90 bg-background shadow-[0_-8px_40px_rgba(0,0,0,0.45)]">
                <RightPanel
                  groupedAlerts={mobileSheetGroupedAlerts}
                  isLoading={isLoading}
                  error={error}
                  onCityChipClick={handleCityChipClick}
                  mobileSheet
                />
              </div>
            </div>
          </div>

          <aside className="hidden w-[380px] shrink-0 flex-col overflow-hidden rounded bg-card lg:flex">
            <RightPanel {...rightPanelProps} />
          </aside>
        </div>
      </main>
    </div>
  );
}

type SettingsMenuProps = {
  silentAlerts: boolean;
  onSilentAlertsChange: (checked: boolean) => void;
  triggerClassName: string;
};

function SettingsMenu({ silentAlerts, onSilentAlertsChange, triggerClassName }: SettingsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Settings"
          className={cn(triggerClassName, 'rounded-[8px]')}
        >
          <Settings className="h-5 w-5" aria-hidden strokeWidth={1.75} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} className="w-[min(calc(100vw-2rem),16rem)]">
        <DropdownMenuItem
          className="flex cursor-default items-center justify-between gap-4 py-2.5 focus:bg-transparent data-[highlighted]:bg-transparent data-[highlighted]:text-[#808080]"
          onSelect={(e: Event) => e.preventDefault()}
        >
          <span>Silent Alerts</span>
          <Switch
            checked={silentAlerts}
            onCheckedChange={onSilentAlertsChange}
            onPointerDown={(e: PointerEvent<HTMLButtonElement>) => e.stopPropagation()}
            onClick={(e: MouseEvent<HTMLButtonElement>) => e.stopPropagation()}
          />
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between gap-4 px-2 py-2 text-sm text-[#808080]">
          <span>Version</span>
          <span className="tabular-nums">{APP_VERSION}</span>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
