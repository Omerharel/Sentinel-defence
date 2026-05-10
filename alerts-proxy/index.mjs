import serverless from 'serverless-http';
import express from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import http from 'node:http';
import { mapTzevaAlertsHistoryToRows } from './tzeva-map.mjs';

const app = express();

const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 6500);
const TZEWA_URL =
  process.env.TZEWA_ALERTS_HISTORY_URL || 'https://api.tzevaadom.co.il/alerts-history';
const OREF_MAP_UPSTREAM = (process.env.OREF_MAP_UPSTREAM_URL || 'https://oref-map.org').replace(/\/$/, '');
const OREF_PASSTHROUGH_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';


function parseJsonSafely(text) {
  const clean = text.replace(/^﻿/, '').trim();
  if (!clean || clean === 'null') return [];
  return JSON.parse(clean);
}

async function fetchJsonFrom(url, headers) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: 'GET', cache: 'no-store', redirect: 'follow', signal: controller.signal, headers });
    const text = await response.text();
    if (!response.ok) return { ok: false, status: response.status, bodyHead: text.slice(0, 180) };
    try {
      return { ok: true, payload: parseJsonSafely(text) };
    } catch {
      return { ok: false, status: 502, bodyHead: text.slice(0, 180), parseError: true };
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function passthroughOrefMap(req, res, orefPath) {
  const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const target = `${OREF_MAP_UPSTREAM}${orefPath}${q}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(target, { method: 'GET', cache: 'no-store', redirect: 'follow', signal: controller.signal, headers: { Accept: 'application/json, text/plain, */*', 'User-Agent': OREF_PASSTHROUGH_UA } });
    const text = await r.text();
    res.status(r.status).type(r.headers.get('content-type') || 'application/json').send(text);
  } catch (e) {
    res.status(502).json({ ok: false, error: e instanceof Error ? e.message : 'passthrough failed' });
  } finally {
    clearTimeout(timeoutId);
  }
}

app.get('/health', (_req, res) => res.status(200).json({ ok: true, service: 'sentinel-alerts-proxy' }));
app.get('/api/history', (req, res) => void passthroughOrefMap(req, res, '/api/history'));
app.get('/api/alerts', (req, res) => void passthroughOrefMap(req, res, '/api/alerts'));
app.get('/api/day-history', (req, res) => void passthroughOrefMap(req, res, '/api/day-history'));

app.get('/alerts', async (_req, res) => {
  try {
    const result = await fetchJsonFrom(TZEWA_URL, { Accept: 'application/json, text/plain, */*', 'User-Agent': OREF_PASSTHROUGH_UA });
    if (result.ok) return res.status(200).json(mapTzevaAlertsHistoryToRows(result.payload));
    return res.status(502).json({ ok: false, error: 'Tzeva Adom alerts-history failed', upstream: result });
  } catch (error) {
    return res.status(502).json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

export const handler = serverless(app);
