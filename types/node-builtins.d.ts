declare namespace NodeJS {
  interface ProcessEnv {
    /** `1` — להציג כפתור Demo בדשבורד (מזריק התראות לדוגמה). */
    NEXT_PUBLIC_SHOW_DEMO_BUTTON?: string;
    /** `1` — לא לחבר WebSocket לצבע אדום (דורש rebuild — משתנה NEXT_PUBLIC). */
    NEXT_PUBLIC_SENTINEL_DISABLE_TZEVA_WS?: string;
    /** פרוקסי WS (Railway alerts-proxy וכו׳). מתעלמים כש־NEXT_PUBLIC_SENTINEL_DISABLE_TZEWA_WS=1. */
    NEXT_PUBLIC_TZEWA_WS_PROXY_URL?: string;
    /** בסיס ל־oref-map style API: `/api/history`, `/api/alerts` (ברירת מחדל https://oref-map.org). */
    OREF_MAP_PROXY_BASE_URL?: string;
    /** `1` — לא לקרוא ל־`alerts-history` של צבע אדום כגיבוי כש־oref נכשל (נשארים Dleshem CSV וכו׳). */
    SENTINEL_DISABLE_TZEVA_OREF_FALLBACK?: string;
    /** כבה מיזוג סוף ה־CSV מ־dleshem/israel-alerts-data (ערך `1`). */
    SENTINEL_DISABLE_DLESHEM_CSV?: string;
    /** דריסת URL ל־`alerts-history` של צבע אדום (גיבוי ל־oref). */
    TZEVA_ALERTS_HISTORY_URL?: string;
  }
}

/** When `@types/node` is not resolved (some IDE setups), `process.env` still type-checks for Next public vars. */
declare const process: { env: NodeJS.ProcessEnv };

/** Ambient `node:*` modules for `moduleResolution: "bundler"` (Next.js default). */
declare module 'node:fs' {
  export function readFileSync(path: string, encoding?: string): string;
  export function writeFileSync(path: string, data: string, encoding?: string): void;
}

declare module 'node:path' {
  export function join(...paths: string[]): string;
  export function dirname(path: string): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
