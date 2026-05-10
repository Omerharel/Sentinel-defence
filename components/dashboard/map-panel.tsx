'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AlertEvent } from '@/lib/alert-types';
import { cityNameToEnglish } from '@/lib/city-name-en';
import {
  isAlertEventInActiveWindow,
  isAlertEventInRightPanelListWindow,
} from '@/lib/alert-normalize';
import {
  mapboxFillColorMatchExpression,
  mapboxOutlineColorMatchExpression,
} from '@/lib/map-alert-styles';
import { buildTimelineSegments, MAP_TIMELINE_SLIDER_RANGE_MS } from '@/lib/map-timeline';
import { jerusalemDateYmd } from '@/lib/jerusalem-calendar';
import {
  alertEventsTouchingRange,
  mergeDayHistoryWithSessionPool,
  normalizeOrefDayHistoryToEvents,
} from '@/lib/oref-day-history';
import { getFallbackLngLatForCity } from '@/lib/alert-geo';
import { loadLocationsPolygonsJson, resolvePhoLabelToMunKey } from '@/lib/mun-resolve';
import { MapTimelineStrip } from '@/components/dashboard/map-timeline-strip';
import { MAP_POLYGON_FADE_MS } from '@/lib/map-polygon-fade-ms';
import { getApiUrl } from '@/lib/api-base';

function subscribeLgMedia(callback: () => void) {
  const mq = window.matchMedia('(min-width: 1024px)');
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function getLgSnapshot() {
  return window.matchMedia('(min-width: 1024px)').matches;
}

/** SSR: אין matchMedia — מניחים מובייל כדי לא לסטות מ־הידרציה בלקוח (אותו התנהגות בכל סביבה). */
function getLgServerSnapshot() {
  return false;
}

function useMediaQueryLg() {
  return useSyncExternalStore(subscribeLgMedia, getLgSnapshot, getLgServerSnapshot);
}

const ALERT_POLYGONS_SOURCE_ID = 'alert-polygons';
const ALERT_FILL_LAYER_ID = 'alert-polygons-fill';
const ALERT_OUTLINE_LAYER_ID = 'alert-polygons-outline';
const MAPBOX_PUBLIC_TOKEN_PREFIX = 'pk.';
const MAP_DISABLED = false;
const DAY_HISTORY_DISABLED = true;

/** כשהפלייהד קרוב ל־"עכשיו" — אותו חלון פעיל כמו הפאנל הימני (TTL / expiresAt). */
const LIVE_PLAYHEAD_EPSILON_MS = 4000;

function isAlertShownOnMapAtPlayhead(
  e: AlertEvent,
  playheadMs: number,
  liveNowMs: number,
  /** מזהים שעדיין ב־fade-out בפאנל — חייבים להופיע גם במפה (אחרת רואים התראה בלי פוליגון). */
  fadingEventIds: readonly string[] | undefined,
): boolean {
  if (isAlertEventInActiveWindow(e, playheadMs)) return true;
  if (Math.abs(playheadMs - liveNowMs) <= LIVE_PLAYHEAD_EPSILON_MS) {
    if (isAlertEventInRightPanelListWindow(e, liveNowMs)) return true;
    if (fadingEventIds?.includes(e.id)) return true;
  }
  return false;
}

interface MapPanelProps {
  /** מאגר אירועים להיסטוריה ולציר זמן (שמירת מפגש); המפה מסננת לפי נקודת הזמן בפלייהד */
  alerts: AlertEvent[];
  /** מזהי אירועים ב־fade-out כמו בפאנל הימני — סנכרון תצוגת פוליגונים */
  fadingEventIds?: readonly string[];
  /** בקשת התמקדות מלחיצה על תגית עיר בפאנל — `nonce` משתנה בכל לחיצה */
  focusCityRequest?: MapFocusCityRequest | null;
}

function isEscalationCategory(c: AlertEvent['category']): boolean {
  return c === 'rockets' || c === 'hostile aircraft';
}

function stableZoneId(
  alert: AlertEvent,
  munKeys: string[],
  regionLookup: Record<string, unknown>,
): string {
  const munKey = resolvePhoLabelToMunKey(alert.city, munKeys);
  const feature = regionLookup[munKey];
  return feature ? munKey.trim() : (alert.polygonId ?? munKey ?? alert.city).trim();
}

/**
 * פוליגון אחד ליישוב — מונע שכבות שקופות מצטברות על אותה גיאומטריה.
 * עדיפות: רקטות/כטב״ם (העדכני) אם יש; אחרת התרעה מקדימה (העדכנית); אחרת האירוע העדכני ביותר.
 */
function buildAlertsForMapPolygons(
  alerts: AlertEvent[],
  munKeys: string[],
  regionLookup: Record<string, unknown>,
): AlertEvent[] {
  const uniqueById = [...new Map(alerts.map((a) => [a.id, a])).values()];
  const byZone = new Map<string, AlertEvent[]>();
  for (const a of uniqueById) {
    const z = stableZoneId(a, munKeys, regionLookup);
    const list = byZone.get(z) ?? [];
    list.push(a);
    byZone.set(z, list);
  }
  const out: AlertEvent[] = [];
  for (const group of byZone.values()) {
    const sorted = [...group].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
    const early = sorted.filter((e) => e.category === 'early warning');
    const esc = sorted.filter((e) => isEscalationCategory(e.category));
    if (esc.length) {
      out.push(esc[0]);
    } else if (early.length) {
      out.push(early[0]);
    } else {
      out.push(sorted[0]);
    }
  }
  return out;
}

function centroidOfPolygonRing(coords: number[][]): [number, number] {
  if (!coords || coords.length === 0) return [34.8, 31.5];
  let sumX = 0;
  let sumY = 0;
  coords.forEach((pt) => {
    sumX += pt[0];
    sumY += pt[1];
  });
  return [
    Number((sumX / coords.length).toFixed(5)),
    Number((sumY / coords.length).toFixed(5)),
  ];
}

type LngLat = [number, number];
type Ring = LngLat[];

function closeRing(ring: Ring): Ring {
  if (ring.length < 3) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (!a || !b) return ring;
  if (a[0] !== b[0] || a[1] !== b[1]) return [...ring, [a[0], a[1]]];
  return ring;
}

/** כשאין התאמה ל־locations_polygons.json — ריבוע קטן סביב קואורדינטה קבועה לפי שם (לא אקראי בין רינדורים). */
const FALLBACK_ALERT_POLY_EPS_DEG = 0.03;

function polygonGeometryFromFallbackCity(city: string): { type: 'Polygon'; coordinates: Ring[] } {
  const [lng, lat] = getFallbackLngLatForCity(city);
  const h = FALLBACK_ALERT_POLY_EPS_DEG / 2;
  const ring: Ring = closeRing([
    [lng - h, lat - h],
    [lng + h, lat - h],
    [lng + h, lat + h],
    [lng - h, lat + h],
  ]);
  return { type: 'Polygon', coordinates: [ring] };
}

function toPolygonGeometry(v: unknown): { type: 'Polygon'; coordinates: Ring[] } | null {
  if (!Array.isArray(v) || v.length === 0) return null;
  const first = v[0] as unknown;
  // Case 1: single ring (array of [lng,lat])
  if (Array.isArray(first) && first.length === 2 && typeof (first as number[])[0] === 'number') {
    const ring = closeRing(v as Ring);
    return { type: 'Polygon', coordinates: [ring] };
  }
  // Case 2: multiple rings (outer + holes).
  const rings = (v as Ring[]).map(closeRing);
  return { type: 'Polygon', coordinates: rings };
}

/** Mapbox `fitBounds` — [[west, south], [east, north]] */
function boundsFromPolygonCoordinates(rings: Ring[]): [[number, number], [number, number]] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const ring of rings) {
    for (const pt of ring) {
      const lng = pt[0];
      const lat = pt[1];
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      minLng = Math.min(minLng, lng);
      maxLng = Math.max(maxLng, lng);
      minLat = Math.min(minLat, lat);
      maxLat = Math.max(maxLat, lat);
    }
  }
  if (!Number.isFinite(minLng) || minLng === Infinity) return null;
  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}

export type MapFocusCityRequest = { city: string; nonce: number };

export function MapPanel({
  alerts,
  fadingEventIds = [],
  focusCityRequest = null,
}: MapPanelProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<any>(null);
  const mapboxglRef = useRef<typeof import('mapbox-gl').default | null>(null);
  const cityFocusPopupRef = useRef<{ remove: () => void } | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [mapInitError, setMapInitError] = useState<string | null>(null);
  const [regionLookup, setRegionLookup] = useState<Record<string, any> | null>(null);
  const [munKeys, setMunKeys] = useState<string[]>([]);
  const [displayPolygonGeoJson, setDisplayPolygonGeoJson] = useState<any>({
    type: 'FeatureCollection',
    features: [],
  });
  const fadeRafRef = useRef<number | null>(null);
  const [timelineRatio, setTimelineRatio] = useState(1);
  const [timelinePreviewRatio, setTimelinePreviewRatio] = useState<number | null>(null);
  const [timelineClock, setTimelineClock] = useState(() => Date.now());
  /** `undefined` — טוען; מערך — נטען מ־oref day-history (יכול להיות ריק). */
  const [dayHistoryEvents, setDayHistoryEvents] = useState<AlertEvent[] | undefined>(undefined);

  const timelineEffectiveRatio = timelinePreviewRatio ?? timelineRatio;
  const jerusalemViewYmd = jerusalemDateYmd(timelineClock);

  const isLg = useMediaQueryLg();

  useEffect(() => {
    const tick = () => setTimelineClock(Date.now());
    const id = window.setInterval(tick, 2000);
    /** טאב ברקע מאט את setInterval — "עכשיו" בציר נשאר מפגר עד חזרה לטאב. */
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  useEffect(() => {
    const ymdForThisEffect = jerusalemViewYmd;
    let cancelled = false;
    setDayHistoryEvents(undefined);
    if (DAY_HISTORY_DISABLED) {
      setDayHistoryEvents([]);
      return () => {
        cancelled = true;
      };
    }
    if (MAP_DISABLED) {
      setDayHistoryEvents([]);
      return () => {
        cancelled = true;
      };
    }

    const isStaleResponse = () =>
      cancelled || jerusalemDateYmd(Date.now()) !== ymdForThisEffect;

    const loadDayHistory = async () => {
      const dayHistoryUrl = getApiUrl(`/api/day-history?date=${encodeURIComponent(ymdForThisEffect)}`);
      // Railway /api/day-history currently proxies to oref-map and can return 403 behind Cloudflare.
      // Keep map/timeline functional using current session events when upstream day-history is blocked.
      if (dayHistoryUrl.includes('sentinel-defence-production.up.railway.app')) {
        if (!isStaleResponse()) setDayHistoryEvents([]);
        return;
      }
      try {
        const res = await fetch(dayHistoryUrl, {
          cache: 'no-store',
        });
        if (isStaleResponse()) return;
        if (!res.ok) {
          if (!isStaleResponse()) setDayHistoryEvents([]);
          return;
        }
        const json: unknown = await res.json();
        if (isStaleResponse()) return;
        const ev = normalizeOrefDayHistoryToEvents(json, Date.now());
        if (!isStaleResponse()) setDayHistoryEvents(ev);
      } catch {
        if (!isStaleResponse()) setDayHistoryEvents([]);
      }
    };

    void loadDayHistory();
    const refreshId = window.setInterval(loadDayHistory, 5 * 60_000);

    const bumpClockAndReloadHistory = () => {
      setTimelineClock(Date.now());
      void loadDayHistory();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') bumpClockAndReloadHistory();
    };
    document.addEventListener('visibilitychange', onVisible);

    const onOnline = () => {
      bumpClockAndReloadHistory();
    };
    window.addEventListener('online', onOnline);

    return () => {
      cancelled = true;
      window.clearInterval(refreshId);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
    };
  }, [jerusalemViewYmd]);

  useEffect(() => {
    let cancelled = false;
    loadLocationsPolygonsJson()
      .then((json) => {
        if (!json || cancelled) return;
        const lookup: Record<string, any> = {};
        const keys: string[] = [];
        for (const [keyRaw, value] of Object.entries(json)) {
          if (!keyRaw || keyRaw.startsWith('_')) continue;
          const key = String(keyRaw).trim();
          if (!key) continue;
          const geometry = toPolygonGeometry(value);
          if (!geometry) continue;
          lookup[key] = { geometry, properties: { hebrew_name: key } };
          keys.push(key);
        }
        setRegionLookup(lookup);
        setMunKeys(keys);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const {
    timelineRangeStartMs,
    timelineRangeEndMs,
    timelineSegments,
    playheadMs,
    alertsAtPlayhead,
  } = useMemo(() => {
    const now = timelineClock;
    const tMax = now;
    const tMin = tMax - MAP_TIMELINE_SLIDER_RANGE_MS;
    const useDayHistoryMerge = dayHistoryEvents !== undefined;

    const merged = useDayHistoryMerge
      ? mergeDayHistoryWithSessionPool(dayHistoryEvents ?? [], alerts)
      : alerts;
    const forStrip = alertEventsTouchingRange(merged, tMin, tMax);

    const segments = buildTimelineSegments(forStrip, tMin, tMax);
    const span = tMax - tMin;
    const r = Math.min(1, Math.max(0, timelineEffectiveRatio));
    const playhead = span > 0 ? Math.round(tMin + r * span) : tMax;
    const clampedPlayhead = Math.min(tMax, Math.max(tMin, playhead));
    const atPlayhead = merged.filter((e) =>
      isAlertShownOnMapAtPlayhead(e, clampedPlayhead, now, fadingEventIds),
    );

    return {
      timelineRangeStartMs: tMin,
      timelineRangeEndMs: tMax,
      timelineSegments: segments,
      playheadMs: clampedPlayhead,
      alertsAtPlayhead: atPlayhead,
    };
  }, [alerts, fadingEventIds, timelineClock, timelineEffectiveRatio, dayHistoryEvents]);

  const { polygonGeoJson } = useMemo(() => {
    if (!regionLookup) {
      return {
        polygonGeoJson: { type: 'FeatureCollection' as const, features: [] },
      };
    }

    const dedupedAlerts = buildAlertsForMapPolygons(alertsAtPlayhead, munKeys, regionLookup);

    const polygonFeatures = dedupedAlerts.flatMap((alert) => {
      const munKey = resolvePhoLabelToMunKey(alert.city, munKeys);
      const feature = regionLookup[munKey];

      if (feature) {
        return [
          {
            type: 'Feature' as const,
            id: alert.id,
            properties: {
              city: alert.city,
              category: alert.category,
              source: alert.source,
              timestamp: alert.timestamp,
            },
            geometry: feature.geometry,
          },
        ];
      }

      return [
        {
          type: 'Feature' as const,
          id: alert.id,
          properties: {
            city: alert.city,
            category: alert.category,
            source: alert.source,
            timestamp: alert.timestamp,
            _approximatePolygon: true,
          },
          geometry: polygonGeometryFromFallbackCity(alert.city),
        },
      ];
    });

    return {
      polygonGeoJson: { type: 'FeatureCollection' as const, features: polygonFeatures },
    };
  }, [alertsAtPlayhead, regionLookup, munKeys]);

  const isTimelineScrubbing = timelinePreviewRatio !== null;

  useEffect(() => {
    if (isTimelineScrubbing) {
      if (fadeRafRef.current !== null) {
        cancelAnimationFrame(fadeRafRef.current);
        fadeRafRef.current = null;
      }
      setDisplayPolygonGeoJson(polygonGeoJson);
      return;
    }

    // Fade-in/out by keeping removed polygons briefly with decreasing opacity.
    const FADE_MS = MAP_POLYGON_FADE_MS;
    const now = performance.now();

    const prevFeatures: any[] = Array.isArray(displayPolygonGeoJson?.features)
      ? displayPolygonGeoJson.features
      : [];
    const nextFeatures: any[] = Array.isArray(polygonGeoJson?.features) ? (polygonGeoJson as any).features : [];

    const prevById = new Map<string, any>();
    for (const f of prevFeatures) {
      const id = String(f?.id ?? f?.properties?.id ?? '');
      if (id) prevById.set(id, f);
    }

    const nextById = new Map<string, any>();
    for (const f of nextFeatures) {
      const id = String(f?.id ?? f?.properties?.id ?? '');
      if (id) nextById.set(id, f);
    }

    const merged: any[] = [];

    // Add / update currently active polygons (fade in if new).
    for (const [id, f] of nextById.entries()) {
      const was = prevById.get(id);
      const base = { ...f, properties: { ...(f.properties ?? {}) } };
      if (was) {
        const lastOpacity = Number(was?.properties?.opacity ?? 1);
        const prevFade = was?.properties?.__fade as string | undefined;
        // Do not snap mid fade-in to opacity 0 + __fade:none — rapid poll/WS updates left polygons invisible until full refresh.
        if (prevFade === 'in' && lastOpacity < 1) {
          base.properties.opacity = lastOpacity;
          base.properties.__fade = 'in';
          base.properties.__fadeStart = Number(was.properties.__fadeStart) || now;
        } else {
          base.properties.__fade = 'none';
          const lo = Number.isFinite(lastOpacity) ? lastOpacity : 1;
          base.properties.opacity = lo > 0 ? lo : 1;
        }
      } else {
        base.properties.opacity = 0;
        base.properties.__fade = 'in';
        base.properties.__fadeStart = now;
      }
      merged.push(base);
    }

    // Keep removed polygons temporarily (fade out).
    for (const [id, f] of prevById.entries()) {
      if (nextById.has(id)) continue;
      const base = { ...f, properties: { ...(f.properties ?? {}) } };
      base.properties.__fade = 'out';
      base.properties.__fadeStart = base.properties.__fadeStart ?? now;
      merged.push(base);
    }

    setDisplayPolygonGeoJson({ type: 'FeatureCollection', features: merged });

    if (fadeRafRef.current !== null) {
      cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    }

    const fadeUntil = now + FADE_MS + 34;
    const tick = () => {
      const t = performance.now();
      let changed = false;

      setDisplayPolygonGeoJson((curr: any) => {
        const feats: any[] = Array.isArray(curr?.features) ? curr.features : [];
        const updated: any[] = [];

        for (const f of feats) {
          const p = { ...(f.properties ?? {}) };
          const fade = p.__fade as 'in' | 'out' | 'none' | undefined;
          const start = Number(p.__fadeStart ?? now);
          const k = Math.min(1, Math.max(0, (t - start) / FADE_MS));

          if (fade === 'in') {
            const nextOpacity = k;
            if (p.opacity !== nextOpacity) changed = true;
            p.opacity = nextOpacity;
            if (k >= 1) {
              p.__fade = 'none';
              p.__fadeStart = undefined;
            }
            updated.push({ ...f, properties: p });
          } else if (fade === 'out') {
            const nextOpacity = 1 - k;
            if (nextOpacity <= 0.01) {
              changed = true;
              continue;
            }
            if (p.opacity !== nextOpacity) changed = true;
            p.opacity = nextOpacity;
            updated.push({ ...f, properties: p });
          } else {
            // Ensure a default opacity exists.
            if (p.opacity === undefined) {
              p.opacity = 1;
              changed = true;
            }
            updated.push({ ...f, properties: p });
          }
        }

        return changed ? { type: 'FeatureCollection', features: updated } : curr;
      });

      if (t < fadeUntil) {
        fadeRafRef.current = requestAnimationFrame(tick);
      } else {
        fadeRafRef.current = null;
      }
    };

    fadeRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (fadeRafRef.current !== null) cancelAnimationFrame(fadeRafRef.current);
      fadeRafRef.current = null;
    };
    /* displayPolygonGeoJson נשאר בחוץ בכוונה — מיזוג fade תלוי במצב הקודם, לא בכל שינוי state */
  }, [polygonGeoJson, isTimelineScrubbing]);

  useEffect(() => {
    if (!mapContainer.current) return;

    let cancelled = false;

    const initMap = async () => {
      if (MAP_DISABLED) {
        setMapInitError('Map temporarily disabled while production connectivity is stabilized.');
        return;
      }
      const token = (process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? '').trim();
      if (!token || !token.startsWith(MAPBOX_PUBLIC_TOKEN_PREFIX)) {
        setMapInitError(
          'Invalid Mapbox token. Set a valid NEXT_PUBLIC_MAPBOX_TOKEN (public token starting with pk.).',
        );
        return;
      }

      const mapboxgl = await import('mapbox-gl');
      if (cancelled || !mapContainer.current) return;

      mapboxglRef.current = mapboxgl.default;

      // Avoid noisy console errors when ad/content blockers block Mapbox telemetry.
      try {
        (mapboxgl.default as any).setTelemetryEnabled?.(false);
      } catch {
        // ignore
      }
      mapboxgl.default.accessToken = token;

      const instance = new mapboxgl.default.Map({
        container: mapContainer.current,
        style: 'mapbox://styles/mapbox/dark-v11',
        center: [34.8, 31.5],
        zoom: 6.7,
        attributionControl: false,
      });
      map.current = instance;
      instance.on('error', (ev: unknown) => {
        const maybeError =
          typeof ev === 'object' && ev !== null && 'error' in ev ? (ev as { error?: unknown }).error : undefined;
        const message =
          typeof maybeError === 'object' && maybeError !== null && 'message' in maybeError
            ? String((maybeError as { message?: unknown }).message ?? '')
            : '';
        const lower = message.toLowerCase();
        if (lower.includes('access token') || lower.includes('forbidden') || lower.includes('unauthorized')) {
          setMapInitError('Mapbox token rejected (403). Verify token value and allowed URLs in Mapbox settings.');
        }
      });

      if (cancelled) {
        instance.remove();
        map.current = null;
        return;
      }

      instance.on('load', () => {
        if (cancelled || map.current !== instance) return;

        const m = map.current;
        if (!m.getSource(ALERT_POLYGONS_SOURCE_ID)) {
          m.addSource(ALERT_POLYGONS_SOURCE_ID, {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
        }

        if (!m.getLayer(ALERT_FILL_LAYER_ID)) {
          m.addLayer({
            id: ALERT_FILL_LAYER_ID,
            type: 'fill',
            source: ALERT_POLYGONS_SOURCE_ID,
            paint: {
              'fill-color': mapboxFillColorMatchExpression() as object,
              'fill-opacity': [
                '*',
                ['coalesce', ['get', 'opacity'], 1],
                [
                  'match',
                  ['get', 'category'],
                  'early warning',
                  0.2,
                  'hostile aircraft',
                  0.2,
                  0.1,
                ],
              ],
            },
          });
        }
        if (!m.getLayer(ALERT_OUTLINE_LAYER_ID)) {
          m.addLayer({
            id: ALERT_OUTLINE_LAYER_ID,
            type: 'line',
            source: ALERT_POLYGONS_SOURCE_ID,
            paint: {
              'line-color': mapboxOutlineColorMatchExpression() as object,
              'line-width': 1.5,
              'line-opacity': [
                '*',
                ['coalesce', ['get', 'opacity'], 1],
                [
                  'match',
                  ['get', 'category'],
                  'early warning',
                  0.65,
                  0.3,
                ],
              ],
            },
          });
        }

        setIsLoaded(true);
        // iOS Safari: גודל המכילה מתייצב אחרי paint / סרגל כתובות — בלי resize הקנבס יכול להישאר ריק או חתוך.
        queueMicrotask(() => {
          instance.resize();
          requestAnimationFrame(() => instance.resize());
        });
      });
    };

    void initMap();

    return () => {
      cancelled = true;
      setIsLoaded(false);
      try {
        cityFocusPopupRef.current?.remove();
      } catch {
        // ignore
      }
      cityFocusPopupRef.current = null;
      mapboxglRef.current = null;
      if (map.current) {
        try {
          map.current.remove();
        } catch {
          // ignore
        }
        map.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!map.current || !isLoaded || !mapContainer.current) return;
    const m = map.current;
    const el = mapContainer.current;
    const bump = () => {
      try {
        m.resize();
      } catch {
        // ignore
      }
    };
    bump();
    const ro = new ResizeObserver(() => bump());
    ro.observe(el);
    window.addEventListener('resize', bump);
    window.addEventListener('orientationchange', bump);
    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      vv.addEventListener('resize', bump);
      vv.addEventListener('scroll', bump);
    }
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', bump);
      window.removeEventListener('orientationchange', bump);
      if (vv) {
        vv.removeEventListener('resize', bump);
        vv.removeEventListener('scroll', bump);
      }
    };
  }, [isLoaded]);

  useEffect(() => {
    if (!map.current || !isLoaded) return;
    const m = map.current;
    const ps = m.getSource(ALERT_POLYGONS_SOURCE_ID);
    if (ps) (ps as { setData: (d: object) => void }).setData(displayPolygonGeoJson as object);
    m.triggerRepaint();
  }, [displayPolygonGeoJson, isLoaded]);

  useEffect(() => {
    if (!focusCityRequest || !map.current || !isLoaded || !regionLookup || munKeys.length === 0) {
      return;
    }

    const m = map.current;
    const munKey = resolvePhoLabelToMunKey(focusCityRequest.city, munKeys);
    const feature = regionLookup[munKey];
    const geometry = feature?.geometry as { type: string; coordinates: Ring[] } | undefined;
    if (!geometry?.coordinates?.length) return;

    const bounds = boundsFromPolygonCoordinates(geometry.coordinates);
    if (!bounds) return;

    try {
      cityFocusPopupRef.current?.remove();
    } catch {
      // ignore
    }
    cityFocusPopupRef.current = null;

    m.fitBounds(bounds, { padding: 72, maxZoom: 14, duration: 750 });

    const Mb = mapboxglRef.current;
    if (!Mb) return;

    const outerRing = geometry.coordinates[0];
    if (!outerRing?.length) return;
    const center = centroidOfPolygonRing(outerRing);

    const hebrewLabel =
      (typeof feature.properties?.hebrew_name === 'string' && feature.properties.hebrew_name) ||
      munKey ||
      focusCityRequest.city;
    const el = document.createElement('div');
    el.className = 'text-sm font-medium';
    el.style.padding = '2px 4px';
    el.textContent = cityNameToEnglish(hebrewLabel);

    const popup = new Mb.Popup({
      closeButton: false,
      closeOnClick: true,
      maxWidth: '280px',
      className: 'sentinel-city-popup',
    })
      .setLngLat(center)
      .setDOMContent(el)
      .addTo(m);

    cityFocusPopupRef.current = popup;
  }, [focusCityRequest, isLoaded, regionLookup, munKeys]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden lg:min-h-[500px]">
      <div ref={mapContainer} className="absolute inset-0 h-full w-full" />
      {mapInitError ? (
        <div className="absolute inset-0 z-[3] flex items-center justify-center bg-black/60 px-6">
          <div className="max-w-md text-center">
            <p className="text-sm font-medium text-white">{mapInitError}</p>
          </div>
        </div>
      ) : null}
      {(() => {
        const timelineStripProps = {
          segments: timelineSegments,
          rangeStartMs: timelineRangeStartMs,
          rangeEndMs: timelineRangeEndMs,
          ratio: timelineEffectiveRatio,
          playheadMs: playheadMs,
          isScrubbing: timelinePreviewRatio !== null,
          onPreviewRatioChange: setTimelinePreviewRatio,
          onRatioCommit: (r: number) => {
            setTimelineRatio(r);
            setTimelinePreviewRatio(null);
          },
        };
        if (isLg) {
          return <MapTimelineStrip {...timelineStripProps} />;
        }
        return null;
      })()}
    </div>
  );
}
