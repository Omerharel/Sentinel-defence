import http from 'node:http';

import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';

import { mapTzevaAlertsHistoryToRows } from './tzeva-map.mjs';

const app = express();

const PORT = Number(process.env.PORT || 3000);
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 6500);
const TZEWA_URL =
  process.env.TZEWA_ALERTS_HISTORY_URL || 'https://api.tzevaadom.co.il/alerts-history';

const DEFAULT_TZEWA_WS_UPSTREAM = 'wss://ws.tzevaadom.co.il/socket?platform=WEB';

/** העתקת בקשות ל־oref-map (למשל כש־Vercel מקבל 403 ישירות). */
const OREF_MAP_UPSTREAM = (process.env.OREF_MAP_UPSTREAM_URL || 'https://oref-map.org').replace(
  /\/$/,
  '',
);

const OREF_PASSTHROUGH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
/** Effective upstream for `/tzeva-socket` (env override, else default). */
const TZEWA_WS_UPSTREAM =
  (process.env.TZEWA_WS_UPSTREAM_URL ?? '').trim() || DEFAULT_TZEWA_WS_UPSTREAM;

const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://sentinel-defence-site.s3-website.eu-north-1.amazonaws.com',
];
const ALLOWED_ORIGINS = new Set(
  (process.env.CORS_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS.join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function parseJsonSafely(text) {
  const clean = text.replace(/^\uFEFF/, '').trim();
  if (!clean) return [];
  if (clean === 'null') return [];
  return JSON.parse(clean);
}

async function fetchJsonFrom(url, headers) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers,
    });

    const rawText = await response.text();
    const text = rawText.replace(/^\uFEFF/, '').trim();

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        bodyHead: text.slice(0, 180),
      };
    }

    let payload;
    try {
      payload = parseJsonSafely(text);
    } catch {
      return { ok: false, status: 502, bodyHead: text.slice(0, 180), parseError: true };
    }

    return { ok: true, payload };
  } finally {
    clearTimeout(timeoutId);
  }
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

/** Plain GET in a browser tab is not a WebSocket — avoid confusing "Cannot GET /tzeva-socket". */
function tzevaSocketPlainGet(_req, res) {
  res.status(200).type('text/plain; charset=utf-8').send(
    [
      'This URL is a WebSocket endpoint only.',
      'Open the Sentinel Defense dashboard with NEXT_PUBLIC_TZEWA_WS_PROXY_URL pointing here;',
      'the app connects with wss:// and Upgrade: websocket (not a normal browser visit).',
      '',
      'Health: GET /health',
    ].join('\n'),
  );
}
app.get('/tzeva-socket', tzevaSocketPlainGet);
app.get('/tzeva-socket/', tzevaSocketPlainGet);

app.use((req, res, next) => {
  applyCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

async function passthroughOrefMap(req, res, orefPath) {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = `${OREF_MAP_UPSTREAM}${orefPath}${q}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(target, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/json, text/plain, */*',
        'User-Agent': OREF_PASSTHROUGH_UA,
      },
    });
    const text = await r.text();
    const ct = r.headers.get('content-type') || 'application/json; charset=utf-8';
    res.status(r.status).type(ct).send(text);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'passthrough failed';
    res.status(502).json({ ok: false, error: message, target: target.slice(0, 120) });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchMappedTzevaRows() {
  const tzevaResult = await fetchJsonFrom(TZEWA_URL, {
    Accept: 'application/json, text/plain, */*',
    'User-Agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  });
  if (tzevaResult.ok) {
    return { ok: true, rows: mapTzevaAlertsHistoryToRows(tzevaResult.payload) };
  }
  return {
    ok: false,
    errorBody: {
      ok: false,
      source: 'proxy',
      error: 'Tzeva Adom alerts-history failed',
      upstream: {
        tzeva: {
          status: tzevaResult.status,
          bodyHead: tzevaResult.bodyHead,
        },
      },
    },
  };
}

app.get('/api/history', (req, res) => {
  void passthroughOrefMap(req, res, '/api/history');
});
app.get('/api/alerts', (req, res) => {
  void (async () => {
    try {
      const r = await fetchMappedTzevaRows();
      if (r.ok) return res.status(200).json(r.rows);
      return res.status(502).json(r.errorBody);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown proxy error';
      return res.status(502).json({
        ok: false,
        source: 'proxy',
        error: message,
      });
    }
  })();
});
app.get('/api/day-history', (req, res) => {
  void passthroughOrefMap(req, res, '/api/day-history');
});

app.get('/health', (_req, res) => {
  const upstreamFromEnv = !!(process.env.TZEWA_WS_UPSTREAM_URL ?? '').trim();
  res.status(200).json({
    ok: true,
    service: 'sentinel-alerts-proxy',
    timestamp: new Date().toISOString(),
    websocketPath: '/tzeva-socket',
    /** True when `/tzeva-socket` has a non-empty upstream URL (env or built-in default). */
    hasUpstream: !!TZEWA_WS_UPSTREAM,
    /** URL the proxy uses toward Tzeva (same as env if set, else default). */
    upstreamPreview: TZEWA_WS_UPSTREAM,
    /** True only when `TZEWA_WS_UPSTREAM_URL` is set in the environment. */
    upstreamFromEnv,
  });
});

app.get('/alerts', async (_req, res) => {
  try {
    const r = await fetchMappedTzevaRows();
    if (r.ok) return res.status(200).json(r.rows);
    return res.status(502).json(r.errorBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown proxy error';
    return res.status(502).json({
      ok: false,
      source: 'proxy',
      error: message,
    });
  }
});

const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

const UPSTREAM_WS_HEADERS = {
  Origin: 'https://www.tzevaadom.co.il',
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
};

server.on('upgrade', (request, socket, head) => {
  console.log('[tzeva-socket] upgrade request', {
    url: request.url,
    effectiveUpstream: TZEWA_WS_UPSTREAM,
    upstreamFromEnv: !!(process.env.TZEWA_WS_UPSTREAM_URL ?? '').trim(),
  });

  const path = request.url?.split('?')[0] ?? '';
  if (path !== '/tzeva-socket' && path !== '/tzeva-socket/') {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (clientWs) => {
    const upstream = new WebSocket(TZEWA_WS_UPSTREAM, { headers: UPSTREAM_WS_HEADERS });

    const pendingFromClient = [];

    upstream.on('open', () => {
      console.log('[tzeva-socket] upstream open');
      for (const { data, isBinary } of pendingFromClient) {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(data, { binary: isBinary });
        }
      }
      pendingFromClient.length = 0;
    });

    clientWs.on('message', (data, isBinary) => {
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        pendingFromClient.push({ data, isBinary });
      }
    });

    /** Tzeva JSON is UTF-8; forwarding `binary: true` makes browsers expose `Blob` and our client only parses strings. */
    function upstreamPayloadToUtf8Text(data) {
      if (Buffer.isBuffer(data)) return data.toString('utf8');
      if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
      if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
      return String(data);
    }

    upstream.on('message', (data) => {
      if (clientWs.readyState !== WebSocket.OPEN) return;
      clientWs.send(upstreamPayloadToUtf8Text(data), { binary: false });
    });

    let closed = false;
    const shutdown = () => {
      if (closed) return;
      closed = true;
      try {
        upstream.close();
      } catch {
        // ignore
      }
      try {
        clientWs.close();
      } catch {
        // ignore
      }
    };

    upstream.on('error', (err) => {
      console.error('[tzeva-socket] upstream error', err?.message ?? err);
      shutdown();
    });

    upstream.on('close', (code, reason) => {
      console.log('[tzeva-socket] upstream close', {
        code,
        reason: reason?.toString?.() ?? '',
      });
      shutdown();
    });

    clientWs.on('close', shutdown);
    clientWs.on('error', shutdown);
  });
});

server.listen(PORT, () => {
  console.log(`sentinel-alerts-proxy listening on :${PORT} (HTTP + WS /tzeva-socket)`);
});
