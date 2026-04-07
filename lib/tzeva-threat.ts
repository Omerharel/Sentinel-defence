/**
 * Tzeva Adom `alerts-history` — each alert has numeric `threat`.
 * Values are defined by the Tzeva feed (not Pikud’s `category` enum 1:1).
 *
 * Observed in live `https://api.tzevaadom.co.il/alerts-history`: `0`, `5`.
 * `7` is used for early-warning style rows when present.
 *
 * Output uses Pikud-shaped `category` + Hebrew `title` for `normalizeOrefHistoryPayload`.
 * Unmapped codes use category `99` (displayed as `unknown` in the app).
 */

/** ירי רקטות וטילים — רוב ההתראות בפיד. */
export const TZEWA_THREAT_ROCKETS = 0;

/** כלי טיס עוין (כטב"ם / מטוס עוין וכו'). */
export const TZEWA_THREAT_HOSTILE_AIRCRAFT = 5;

/** התרעה מקדימה — כאשר מופיע בפיד. */
export const TZEWA_THREAT_EARLY_WARNING = 7;

/** Reserved for future Tzeva codes; maps to `unknown` until explicitly handled. */
export const TZEWA_THREAT_UNMAPPED_FALLBACK_CATEGORY = 99;

export function mapTzevaThreatToPikudShapedFields(threat: number): { category: number; title: string } {
  switch (threat) {
    case TZEWA_THREAT_ROCKETS:
      return { category: 1, title: 'ירי רקטות וטילים' };
    case TZEWA_THREAT_HOSTILE_AIRCRAFT:
      return { category: 2, title: 'כלי טיס עוין' };
    case TZEWA_THREAT_EARLY_WARNING:
      return { category: 7, title: 'התרעה מקדימה' };
    default:
      return {
        category: TZEWA_THREAT_UNMAPPED_FALLBACK_CATEGORY,
        title: `התרעה (קוד איום ${threat})`,
      };
  }
}
