'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LastUpdate } from '@/components/dashboard/last-update';
import { MapPanel, type MapFocusCityRequest } from '@/components/dashboard/map-panel';
import { RightPanel } from '@/components/dashboard/right-panel';
import type { AlertCategory, AlertEvent, AlertEventSource, AlertsResponse } from '@/lib/alert-types';
import { mergePollIntoAlertHistory } from '@/lib/alert-history-merge';
import {
  isAlertEventInListHistoryRetention,
  isAlertEventInRightPanelListWindow,
} from '@/lib/alert-normalize';
import { getAlertListMergeMinuteKey } from '@/lib/dashboard-time';

const POLLING_INTERVAL_MS = 4000;
const ALERT_SOUND_SRC = '/bell.mp3';
const INCIDENT_ENDED_SOUND_SRC = '/Notification sound.mp3';
const ALERT_SOUND_COOLDOWN_MS = 30 * 1000;
/** מקסימום אירועים ייחודיים בהיסטוריית הרשימה במפגש (לפי id). */
const MAX_ALERT_HISTORY = 2000;

export function DashboardShell() {
  const [alerts, setAlerts] = useState<AlertsResponse | null>(null);
  /** התראות שראינו במפגש — הרשימה נשארת גם כשהפיד הנוכחי התרוקן. */
  const [historyEvents, setHistoryEvents] = useState<AlertEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mapFocusCityRequest, setMapFocusCityRequest] = useState<MapFocusCityRequest | null>(null);
  /** מרענן סינון חלון הפאנל הימני בלי להמתין ל־poll */
  const [rightPanelTimeTick, setRightPanelTimeTick] = useState(0);

  const handleCityChipClick = useCallback((cityHebrew: string) => {
    setMapFocusCityRequest((prev) => ({
      city: cityHebrew,
      nonce: (prev?.nonce ?? 0) + 1,
    }));
  }, []);

  const seenIdsRef = useRef<Set<string>>(new Set());
  const hasHydratedOnceRef = useRef(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const endedAudioRef = useRef<HTMLAudioElement | null>(null);
  const hasUserInteractedRef = useRef(false);
  const isAudioUnlockedRef = useRef(false);
  const isEndedAudioUnlockedRef = useRef(false);
  const lastSoundPlayedAtRef = useRef(0);

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
        const response = await fetch('/api/alerts?maxEvents=6000&scanCap=12000', { cache: 'no-store' });
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error?.message || 'Failed to fetch alerts');
        }

        let normalized: AlertsResponse;
        if (Array.isArray(data)) {
          normalized = {
            ok: true,
            fetchedAt: new Date().toISOString(),
            title: 'Sentinel Defense',
            hasActiveAlerts: data.length > 0,
            events: data as AlertEvent[],
            rawCount: data.length ?? 0,
            source: 'oref',
          };
        } else {
          normalized = data as AlertsResponse;
        }

        if (!isMounted) return;

        let newEndedCount = 0;
        let newRocketCount = 0;
        for (const e of normalized.events) {
          if (!seenIdsRef.current.has(e.id)) {
            seenIdsRef.current.add(e.id);
            if (hasHydratedOnceRef.current) {
              if (e.category === 'incident ended') {
                newEndedCount += 1;
              }
              if (e.category === 'rockets') {
                newRocketCount += 1;
              }
            }
          }
        }

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

        setError(null);
        hasHydratedOnceRef.current = true;

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

    loadAlerts();
    interval = setInterval(loadAlerts, POLLING_INTERVAL_MS);

    return () => {
      isMounted = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  const groupedAlerts = useMemo(() => {
    const now = Date.now();
    const events = historyEvents.filter((e) => isAlertEventInRightPanelListWindow(e, now));
    const groups = new Map<
      string,
      {
        id: string;
        timestamp: string;
        category: AlertCategory;
        endedCategory?: AlertEvent['endedCategory'];
        source: AlertEventSource;
        cities: string[];
      }
    >();

    for (const e of events) {
      const minuteKey = getAlertListMergeMinuteKey(e.timestamp);
      const groupKey = `${minuteKey}|${e.category}|${e.endedCategory ?? ''}`;
      const existing = groups.get(groupKey);
      const t = Date.parse(e.timestamp);
      if (!existing) {
        groups.set(groupKey, {
          id: groupKey,
          timestamp: e.timestamp,
          category: e.category,
          endedCategory: e.endedCategory,
          source: e.source,
          cities: [e.city],
        });
      } else {
        if (!existing.cities.includes(e.city)) {
          existing.cities.push(e.city);
        }
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
  }, [historyEvents, rightPanelTimeTick]);

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

  return (
    <div className="h-screen bg-background flex flex-col font-sans">
      <main className="flex-1 p-4 md:p-6 flex flex-col gap-3 overflow-hidden">
        <div className="flex w-full flex-wrap items-center gap-3">
          <LastUpdate fetchedAt={summary.fetchedAt} isLoading={isLoading} />
        </div>

        <div className="flex-1 flex flex-col lg:flex-row gap-4 overflow-hidden">
          <div className="flex-1 rounded-sm overflow-hidden min-h-[500px] lg:min-h-0 bg-card">
            <MapPanel alerts={mapPanelEventPool} focusCityRequest={mapFocusCityRequest} />
          </div>

          <aside className="w-full sm:w-[380px] rounded bg-card p-0 overflow-hidden flex flex-col">
            <RightPanel
              groupedAlerts={groupedAlerts}
              isLoading={isLoading}
              error={error}
              onCityChipClick={handleCityChipClick}
            />
          </aside>
        </div>
      </main>
    </div>
  );
}
