'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatTimelinePlayheadLabel } from '@/lib/dashboard-time';
import type { TimelineEarlyWarningBand, TimelineSegment } from '@/lib/map-timeline';

function segmentBarColor(kind: TimelineSegment['kind']): string {
  if (kind === 'quiet') return '#292929';
  if (kind === 'rockets' || kind === 'hostile aircraft') return '#FF848C';
  if (kind === 'early warning') return '#FFE57F';
  if (kind === 'incident ended') return '#0BC5B3';
  if (kind === 'earthquake') return '#FF848C';
  if (kind === 'tsunami') return '#FF848C';
  if (kind === 'hazmat') return '#FF848C';
  if (kind === 'terror') return '#FF848C';
  if (kind === 'unknown') return '#FF848C';
  return '#6b7280';
}

/** מקדים / סיום אירוע — מנפחים משך בפלקס בלבד (לא רוחב פיקסלים) */
const TIMELINE_EARLY_ENDED_VISUAL_MIN_MS = 6 * 60 * 1000;

interface MapTimelineStripProps {
  segments: TimelineSegment[];
  /** התרעות מקדימה — פס צהוב מעל המקטעים כשהדומיננטי אדום וכו׳ */
  earlyWarningBands: TimelineEarlyWarningBand[];
  rangeStartMs: number;
  rangeEndMs: number;
  ratio: number;
  playheadMs: number;
  /** תצוגה מקדימה/גרירה — בלי אנימציית מיקום על הטולטיפ והפלייהד */
  isScrubbing?: boolean;
  onPreviewRatioChange: (ratio: number | null) => void;
  onRatioCommit: (ratio: number) => void;
  /** מובייל: בשורה ליד Last Update — בלי absolute */
  inline?: boolean;
}

export function MapTimelineStrip({
  segments,
  earlyWarningBands,
  rangeStartMs,
  rangeEndMs,
  ratio,
  playheadMs,
  isScrubbing = false,
  onPreviewRatioChange,
  onRatioCommit,
  inline = false,
}: MapTimelineStripProps) {
  const total = rangeEndMs - rangeStartMs;
  const trackRef = useRef<HTMLDivElement>(null);
  const hoverRafRef = useRef<number | null>(null);
  const pendingClientXRef = useRef<number | null>(null);
  /** צעד אחרון שדווח ב-hover (0–1000) — מונע לולאת setState כשהרקט משתנה בגלל אנימציית flex/שעון. */
  const lastHoverStepRef = useRef<number | null>(null);
  const onPreviewRatioChangeRef = useRef(onPreviewRatioChange);
  const [tooltipVisible, setTooltipVisible] = useState(false);

  useLayoutEffect(() => {
    onPreviewRatioChangeRef.current = onPreviewRatioChange;
  }, [onPreviewRatioChange]);

  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    };
  }, []);

  const ratioFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    const t = (clientX - rect.left) / rect.width;
    return Math.min(1, Math.max(0, t));
  }, []);

  const scheduleHoverPreview = useCallback((clientX: number) => {
    pendingClientXRef.current = clientX;
    if (hoverRafRef.current !== null) return;
    hoverRafRef.current = requestAnimationFrame(() => {
      hoverRafRef.current = null;
      const x = pendingClientXRef.current;
      if (x == null) return;
      const next = ratioFromClientX(x);
      const step = Math.round(next * 1000);
      if (lastHoverStepRef.current === step) return;
      lastHoverStepRef.current = step;
      onPreviewRatioChangeRef.current(step / 1000);
    });
  }, [ratioFromClientX]);

  const barSegments =
    total > 0 && segments.length > 0
      ? segments
      : [{ startMs: rangeStartMs, endMs: rangeEndMs, kind: 'quiet' as const }];

  const tooltipText = formatTimelinePlayheadLabel(playheadMs);
  const clampedRatio = Math.min(1, Math.max(0, ratio));

  const playheadMotionClass = isScrubbing
    ? ''
    : 'transition-[left] duration-100 ease-out motion-reduce:transition-none';

  const rootClass = inline
    ? 'pointer-events-none z-[2] w-full max-w-[min(42vw,280px)] shrink-0'
    : 'pointer-events-none absolute right-4 z-[2] w-[min(32vw,420px)] bottom-4';

  return (
    <div className={rootClass} dir="ltr">
      <div className="pointer-events-auto rounded-full bg-black/55 px-3 py-0.5 shadow-lg backdrop-blur-md">
        <div className="relative">
          {tooltipVisible ? (
            <div
              className={`pointer-events-none absolute bottom-[calc(100%+6px)] z-[1] min-w-max -translate-x-1/2 rounded-full bg-zinc-900/95 px-2.5 py-1 text-[11px] font-medium tabular-nums text-white shadow-md will-change-[left] ${playheadMotionClass}`}
              style={{ left: `${clampedRatio * 100}%` }}
            >
              {tooltipText}
              <span
                className="absolute left-1/2 top-full -translate-x-1/2 border-[5px] border-transparent border-t-zinc-900/95"
                aria-hidden
              />
            </div>
          ) : null}

          <div
            ref={trackRef}
            className="relative flex h-8 w-full select-none items-center [-webkit-tap-highlight-color:transparent]"
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-1/2 h-3 w-full -translate-y-1/2 overflow-hidden rounded-full"
              style={{ backgroundColor: '#2d4f8f' }}
            >
              <div className="absolute inset-0 z-0 flex">
                {barSegments.map((s, i) => {
                  const dur = s.endMs - s.startMs;
                  const isEarlyOrEnded =
                    s.kind === 'early warning' || s.kind === 'incident ended';
                  const flexGrow =
                    total > 0
                      ? Math.max(
                          1,
                          isEarlyOrEnded
                            ? Math.max(dur, TIMELINE_EARLY_ENDED_VISUAL_MIN_MS)
                            : dur,
                        )
                      : 1;
                  const minWidthPx = s.kind === 'quiet' ? 0 : 4;
                  const bg = segmentBarColor(s.kind);
                  return (
                    <div
                      key={`${s.startMs}-${s.endMs}-${i}`}
                      className="h-full shrink-0 transition-[flex-grow] duration-150"
                      style={{
                        flexGrow,
                        flexBasis: 0,
                        minWidth: minWidthPx,
                        backgroundColor: bg,
                      }}
                    />
                  );
                })}
              </div>
              <div
                className="pointer-events-none absolute inset-0 z-[1]"
                aria-hidden
              >
                {earlyWarningBands.map((b) => (
                  <div
                    key={b.id}
                    className="absolute top-0 h-full"
                    style={{
                      left: `${b.leftPct}%`,
                      width: `${b.widthPct}%`,
                      minWidth: 3,
                      backgroundColor: '#FFE57F',
                      opacity: 0.95,
                      boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.2)',
                    }}
                  />
                ))}
              </div>
              {tooltipVisible ? (
                <div
                  className={`pointer-events-none absolute inset-y-0 z-[2] w-0.5 rounded-full bg-white shadow-[0_0_6px_rgba(255,255,255,0.65)] will-change-[left] ${playheadMotionClass}`}
                  style={{ left: `${clampedRatio * 100}%`, transform: 'translateX(-50%)' }}
                  aria-hidden
                />
              ) : null}
            </div>

            <input
              type="range"
              min={0}
              max={1000}
              step={1}
              value={Math.round(clampedRatio * 1000)}
              disabled={total <= 0}
              onPointerEnter={() => {
                if (total > 0) setTooltipVisible(true);
              }}
              onPointerMove={(e) => {
                if (total <= 0) return;
                if (e.buttons !== 0) return;
                scheduleHoverPreview(e.clientX);
              }}
              onPointerLeave={() => {
                setTooltipVisible(false);
                if (hoverRafRef.current !== null) {
                  cancelAnimationFrame(hoverRafRef.current);
                  hoverRafRef.current = null;
                }
                pendingClientXRef.current = null;
                lastHoverStepRef.current = null;
                onPreviewRatioChangeRef.current(null);
              }}
              onInput={(e) => {
                onPreviewRatioChange(Number((e.target as HTMLInputElement).value) / 1000);
              }}
              onChange={(e) => {
                onRatioCommit(Number((e.target as HTMLInputElement).value) / 1000);
              }}
              className="absolute inset-0 z-[1] h-full w-full cursor-ew-resize opacity-0 disabled:cursor-not-allowed"
              style={{ touchAction: 'none' }}
              aria-label="מיקום בציר הזמן"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
