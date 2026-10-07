// api.weather.gov, straight from the browser (it sends CORS headers).
//
//   points(lat, lon)  /points/{lat},{lon} -> gridpoint URL, time zone, radar
//                     station, nearest city. Cached in localStorage 30 days
//                     (NWS itself marks it cacheable for a day; it never moves).
//   grid(url)         the raw gridpoint forecast, cached per gridpoint in the
//                     Cache API:
//                       - a copy younger than FRESH (10 min) is used as is;
//                       - otherwise fetch, giving up after TIMEOUT (7 s);
//                       - on timeout, network error or an HTTP error, fall back to the
//                         cached copy (marked fallback, so the UI says so).
//                     NWS's CDN also caches gridpoints (max-age up to ~900 s),
//                     so a fetch can itself return a copy minutes old; and its
//                     servers occasionally answer with an older updateTime
//                     than one already seen -- then the newer cached copy wins.
export class OutsideCoverage extends Error {}

const BASE = 'https://api.weather.gov';
const FRESH = 10 * 60e3;
const TIMEOUT = 7e3;
const POINTS_TTL = 30 * 86400e3;
const CACHE = 'wx-grid';

export const round4 = v => Math.round(v * 1e4) / 1e4; // NWS 301-redirects more precision to 4 places

async function fetchTimeout(url, ms = TIMEOUT) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timed out')), ms);
  try {
    return await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/geo+json' } });
  } finally {
    clearTimeout(timer);
  }
}

/** {grid, tz, radar, city, state} for a location. Throws OutsideCoverage on 404. */
export async function points(lat, lon) {
  const key = `wx-pt:${round4(lat)},${round4(lon)}`;
  try {
    const hit = JSON.parse(localStorage.getItem(key) || 'null');
    if (hit && Date.now() - hit.t < POINTS_TTL) return hit.data;
  } catch {}
  const res = await fetchTimeout(`${BASE}/points/${round4(lat)},${round4(lon)}`);
  if (res.status === 404) throw new OutsideCoverage('outside NWS coverage');
  if (!res.ok) throw new Error(`NWS points: HTTP ${res.status}`);
  const p = (await res.json()).properties;
  if (!p?.forecastGridData) throw new OutsideCoverage('no NWS forecast grid here');
  const rel = p.relativeLocation?.properties || {};
  const data = { grid: p.forecastGridData, tz: p.timeZone, radar: p.radarStation, city: rel.city || '', state: rel.state || '' };
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch {}
  return data;
}

const updateTime = js => Date.parse(js?.properties?.updateTime || '') || 0;

async function cached(url) {
  try {
    const cache = await caches.open(CACHE);
    const res = await cache.match(url);
    if (!res) return null;
    return { json: await res.json(), fetched: Number(res.headers.get('x-fetched')) || 0 };
  } catch {
    return null;
  }
}

async function store(url, json, fetched) {
  try {
    const cache = await caches.open(CACHE);
    await cache.put(url, new Response(JSON.stringify(json), { headers: { 'Content-Type': 'application/json', 'x-fetched': String(fetched) } }));
  } catch {}
}

/**
 * The gridpoint JSON: {json, fetched (ms), source: 'fresh'|'network'|'fallback', error?}.
 * `force` skips the freshness window (pull to refresh).
 */
export async function grid(url, { force = false } = {}) {
  const old = await cached(url);
  if (old && !force && Date.now() - old.fetched < FRESH) return { ...old, source: 'fresh' };
  let error;
  try {
    const res = await fetchTimeout(url);
    if (!res.ok) throw new Error(`NWS: HTTP ${res.status}`);
    const json = await res.json();
    if (!json?.properties?.updateTime) throw new Error('NWS sent an empty forecast');
    const fetched = Date.now();
    // a lagging NWS server: keep the newer copy we already have
    const keep = old && updateTime(old.json) > updateTime(json) ? old.json : json;
    await store(url, keep, fetched);
    return { json: keep, fetched, source: 'network' };
  } catch (e) {
    error = e;
  }
  if (old) return { ...old, source: 'fallback', error };
  throw error;
}
