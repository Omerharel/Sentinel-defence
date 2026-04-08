'use client';

import { useId, useLayoutEffect, useRef } from 'react';

const C = 28;
const R_OUT = 22;
const R_IN = 13;

function ringPoint(radius: number, deg: number): { x: number; y: number } {
  const t = (deg * Math.PI) / 180;
  return {
    x: Math.round((C + radius * Math.cos(t)) * 100) / 100,
    y: Math.round((C + radius * Math.sin(t)) * 100) / 100,
  };
}

const OUT_SW = ringPoint(R_OUT, 145);
const OUT_SE = ringPoint(R_OUT, 35);
const IN_TOP = ringPoint(R_IN, -90);

const DEFAULT_BLIP_X = OUT_SW.x;
const DEFAULT_BLIP_Y = OUT_SW.y;
const DEFAULT_BLIP2_X = OUT_SE.x;
const DEFAULT_BLIP2_Y = OUT_SE.y;
const DEFAULT_BLIP3_X = IN_TOP.x;
const DEFAULT_BLIP3_Y = IN_TOP.y;
const BLIP_R = 2.55;
/** משך fade לנקודות — ארוך יותר = פחות "קאטי" (מילישניות) */
const BLIP_OPACITY_MS = 480;
/** fade-in / fade-out לנקודות */
const BLIP_OPACITY_EASE = 'ease-in-out';
const BLIP_HYST_PAD = 8;
const RING_STROKE_W = 2;
/** רקע פנים הרדאר (בתוך העיגול החיצוני) */
const RADAR_FACE_FILL = '#232323';
const SW_A = 105;
const SW_B = 172;

const ROT_MS = 8000;

function blipThetaDeg(blipX: number, blipY: number): number {
  return ((Math.atan2(blipY - C, blipX - C) * 180) / Math.PI + 360) % 360;
}

function sweepD(): string {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const xy = (deg: number) => {
    const t = rad(deg);
    return `${(C + R_OUT * Math.cos(t)).toFixed(2)} ${(C + R_OUT * Math.sin(t)).toFixed(2)}`;
  };
  return `M ${C} ${C} L ${xy(SW_A)} A ${R_OUT} ${R_OUT} 0 0 1 ${xy(SW_B)} Z`;
}

const D_SWEEP = sweepD();

function norm360(x: number): number {
  return ((x % 360) + 360) % 360;
}

function blipHit(R: number, th: number, pad: number): boolean {
  const a = norm360(SW_A + R - pad);
  const b = norm360(SW_B + R + pad);
  const e = 0.15;
  if (a <= b) return th >= a - e && th <= b + e;
  return th >= a - e || th <= b + e;
}

export function RadarIdleIcon({
  size = 56,
  className,
  blipX = DEFAULT_BLIP_X,
  blipY = DEFAULT_BLIP_Y,
  blip2X = DEFAULT_BLIP2_X,
  blip2Y = DEFAULT_BLIP2_Y,
  blip3X = DEFAULT_BLIP3_X,
  blip3Y = DEFAULT_BLIP3_Y,
}: {
  size?: number;
  className?: string;
  blipX?: number;
  blipY?: number;
  blip2X?: number;
  blip2Y?: number;
  blip3X?: number;
  blip3Y?: number;
}) {
  const gid = useId().replace(/:/g, '');
  const sweepRef = useRef<SVGGElement>(null);
  const blipRef = useRef<SVGGElement>(null);
  const blip2Ref = useRef<SVGGElement>(null);
  const blip3Ref = useRef<SVGGElement>(null);

  useLayoutEffect(() => {
    const sweep = sweepRef.current;
    if (!sweep) return;

    const b1 = blipRef.current;
    const b2 = blip2Ref.current;
    const b3 = blip3Ref.current;
    const th1 = b1 ? blipThetaDeg(blipX, blipY) : 0;
    const th2 = b2 ? blipThetaDeg(blip2X, blip2Y) : 0;
    const th3 = b3 ? blipThetaDeg(blip3X, blip3Y) : 0;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sweep.setAttribute('transform', 'rotate(0)');
      if (b1) {
        b1.style.transition = 'none';
        b1.style.opacity = '1';
      }
      if (b2) {
        b2.style.transition = 'none';
        b2.style.opacity = '1';
      }
      if (b3) {
        b3.style.transition = 'none';
        b3.style.opacity = '1';
      }
      return;
    }

    const blipTransition = `opacity ${BLIP_OPACITY_MS}ms ${BLIP_OPACITY_EASE}`;
    for (const el of [b1, b2, b3]) {
      if (!el) continue;
      el.style.setProperty('transition', blipTransition);
      el.style.setProperty('will-change', 'opacity');
      el.style.setProperty('opacity', '0');
    }
    const t0 = performance.now();
    let raf = 0;
    let was1 = false;
    let was2 = false;
    let was3 = false;

    const loop = (now: number) => {
      const R = (((now - t0) % ROT_MS) / ROT_MS) * 360;
      sweep.setAttribute('transform', `rotate(${R})`);
      if (b1) {
        const on1 = blipHit(R, th1, was1 ? BLIP_HYST_PAD : 0);
        was1 = on1;
        const o1 = on1 ? '1' : '0';
        if (b1.style.opacity !== o1) b1.style.setProperty('opacity', o1);
      }
      if (b2) {
        const on2 = blipHit(R, th2, was2 ? BLIP_HYST_PAD : 0);
        was2 = on2;
        const o2 = on2 ? '1' : '0';
        if (b2.style.opacity !== o2) b2.style.setProperty('opacity', o2);
      }
      if (b3) {
        const on3 = blipHit(R, th3, was3 ? BLIP_HYST_PAD : 0);
        was3 = on3;
        const o3 = on3 ? '1' : '0';
        if (b3.style.opacity !== o3) b3.style.setProperty('opacity', o3);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [blipX, blipY, blip2X, blip2Y, blip3X, blip3Y]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <defs>
        <linearGradient
          id={`radar-sweep-${gid}`}
          gradientUnits="objectBoundingBox"
          x1="0"
          y1="0"
          x2="1"
          y2="1"
        >
          <stop stopColor="#fff" stopOpacity={0.22} />
          <stop offset="1" stopColor="#fff" stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={R_OUT} fill={RADAR_FACE_FILL} />
      <g transform="translate(28 28)">
        <g ref={sweepRef} transform="rotate(0)">
          <g transform="translate(-28 -28)">
            <path d={D_SWEEP} fill={`url(#radar-sweep-${gid})`} />
          </g>
        </g>
      </g>
      <circle
        cx={C}
        cy={C}
        r={R_OUT}
        fill="none"
        stroke="#7a7a7a"
        strokeWidth={RING_STROKE_W}
      />
      <circle
        cx={C}
        cy={C}
        r={R_IN}
        fill="none"
        stroke="#7a7a7a"
        strokeWidth={RING_STROKE_W}
      />
      <g ref={blipRef} transform={`translate(${blipX} ${blipY})`}>
        <circle r={BLIP_R} fill="#fff" />
      </g>
      <g ref={blip2Ref} transform={`translate(${blip2X} ${blip2Y})`}>
        <circle r={BLIP_R} fill="#fff" />
      </g>
      <g ref={blip3Ref} transform={`translate(${blip3X} ${blip3Y})`}>
        <circle r={BLIP_R} fill="#fff" />
      </g>
    </svg>
  );
}
