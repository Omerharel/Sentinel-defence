/**
 * ייבוא גיאומטריית יישובים בלבד מ־Tzeva Adom (קבצי `cities.json` / `polygons.json` הסטטיים).
 * זה לא חלק מפיד ההתראות — רק בניית `public/data/locations_polygons.json` למפה.
 *
 * אין טעינת polygons בזמן ריצה מהאפליקציה — רק הקובץ הזה אחרי `npm run import:polygons`.
 *
 * ראו `lib/mun-resolve.ts`, `components/dashboard/map-panel.tsx`.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/data/locations_polygons.json');

const FETCH_INIT = {
  headers: {
    Accept: 'application/json, text/plain, */*',
    'User-Agent':
      'Mozilla/5.0 (compatible; SentinelDefence/1.0; +https://sentinel-defence.vercel.app)',
  },
};

function isPair(x) {
  return Array.isArray(x) && x.length >= 2 && typeof x[0] === 'number' && typeof x[1] === 'number';
}

/** טבעת/טבעות [lat,lng] → [lng,lat] בסגנון GeoJSON. */
function latLngRingsToLngLat(value) {
  if (!Array.isArray(value) || value.length === 0) return value;
  if (isPair(value[0])) {
    return value.map(([lat, lng]) => [lng, lat]);
  }
  return value.map((ring) => ring.map(([lat, lng]) => [lng, lat]));
}

async function main() {
  const verRes = await fetch('https://api.tzevaadom.co.il/lists-versions', FETCH_INIT);
  let citiesVer = 10;
  let polygonsVer = 5;
  if (verRes.ok) {
    const ver = await verRes.json();
    if (typeof ver?.cities === 'number') citiesVer = ver.cities;
    if (typeof ver?.polygons === 'number') polygonsVer = ver.polygons;
  }

  const citiesUrl = `https://www.tzevaadom.co.il/static/cities.json?v=${citiesVer}`;
  const polygonsUrl = `https://www.tzevaadom.co.il/static/polygons.json?v=${polygonsVer}`;

  const [citiesRes, polygonsRes] = await Promise.all([
    fetch(citiesUrl, FETCH_INIT),
    fetch(polygonsUrl, FETCH_INIT),
  ]);
  if (!citiesRes.ok) throw new Error(`cities.json failed: ${citiesRes.status}`);
  if (!polygonsRes.ok) throw new Error(`polygons.json failed: ${polygonsRes.status}`);

  const citiesJson = await citiesRes.json();
  const polygonsJson = await polygonsRes.json();

  const idToHe = new Map();
  const cities = citiesJson?.cities;
  if (cities && typeof cities === 'object') {
    for (const [, row] of Object.entries(cities)) {
      const id = row?.id;
      const he = (row?.he ?? '').trim();
      if (id == null || !he) continue;
      idToHe.set(String(id), he);
    }
  }

  const out = {
    _copyright:
      `Polygon geometry from ${polygonsUrl} (city names from ${citiesUrl}). © tzevaadom.co.il — use subject to their terms.`,
  };

  let matched = 0;
  let skippedNoName = 0;

  for (const [idKey, raw] of Object.entries(polygonsJson)) {
    if (idKey.startsWith('_')) continue;
    const he = idToHe.get(String(idKey));
    if (!he) {
      skippedNoName += 1;
      continue;
    }
    out[he] = latLngRingsToLngLat(raw);
    matched += 1;
  }

  writeFileSync(OUT, JSON.stringify(out), 'utf8');
  console.log(
    `Wrote ${OUT} (${matched} polygons, ${skippedNoName} polygon ids without city name; cities v=${citiesVer} polygons v=${polygonsVer})`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
