# Sentinel Alerts Proxy (Railway)

Small Express service that pulls [Tzeva Adom `alerts-history`](https://api.tzevaadom.co.il/alerts-history), maps it to Pikud-shaped rows (same idea as the Next.js route), and exposes:

- `GET /health`
- `GET /alerts`
- **WebSocket** `GET /tzeva-socket` — bridges to `wss://ws.tzevaadom.co.il/socket?platform=WEB` with `Origin: https://www.tzevaadom.co.il` so browsers on other domains (e.g. Vercel) are not rejected with **403** on the handshake.

The Next.js app cannot connect directly to Tzeva’s WebSocket from `https://your-app.vercel.app` because the browser sends that origin and Tzeva’s server blocks it. Point the app at this proxy instead (see below).

## Local run

```bash
cd alerts-proxy
npm install
npm start
```

Then test:

- `http://localhost:3000/health`
- `http://localhost:3000/alerts`

## Deploy on Railway

1. Create a new Railway project from this folder/repo.
2. Set service root directory to `alerts-proxy`.
3. Build command: `npm install`
4. Start command: `npm start`
5. After deploy, test:
   - `https://<your-railway-domain>/health`
   - `https://<your-railway-domain>/alerts`

## Connect to Vercel

Set in Vercel (Production):

`EXTERNAL_ALERTS_API_URL=https://<your-railway-domain>/alerts`

For **real-time “incident ended”** WebSocket messages, also set:

`NEXT_PUBLIC_TZEWA_WS_PROXY_URL=wss://<your-railway-domain>/tzeva-socket`

Use `wss://` on HTTPS sites; for local dev against `http://localhost:3000` you can use `ws://localhost:<proxy-port>/tzeva-socket` (run the proxy on another port, e.g. `PORT=3001`).

Redeploy Vercel after setting the env vars.
