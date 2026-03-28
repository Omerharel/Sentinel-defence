declare namespace NodeJS {
  interface ProcessEnv {
    /** בסיס ל־oref-map style API: `/api/history`, `/api/alerts` (ברירת מחדל https://oref-map.org). */
    OREF_MAP_PROXY_BASE_URL?: string;
    /** כבה גיבוי אוטומטי ל־Tzeva כש־oref חוסם (ערך `1`). */
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
