export type AlertCategory =
  | 'rockets'
  | 'hostile aircraft'
  | 'early warning'
  | 'incident ended'
  | 'earthquake'
  | 'tsunami'
  | 'hazmat'
  | 'terror'
  | 'unknown';

/** מקור נירמול — פיקוד דרך oref-map או צבע אדום (WebSocket / היסטוריה). */
export type AlertEventSource = 'oref' | 'tzevaadom';

/** Top-level `source` on {@link AlertsResponse}. */
export type AlertsResponseSource = AlertEventSource;

export interface AlertEvent {
  id: string;
  city: string;
  timestamp: string;
  expiresAt?: string;
  source: AlertEventSource;
  category: AlertCategory;
  endedCategory?: AlertCategory;
  polygonId?: string;
}

export interface AlertsResponse {
  ok: boolean;
  source: AlertsResponseSource;
  fetchedAt: string;
  title: string;
  hasActiveAlerts: boolean;
  events: AlertEvent[];
  rawCount: number;
}
