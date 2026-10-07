// Offline support for the app shell only: stale-while-revalidate, so an
// update shows on the next launch. Forecast data is fetched cross-origin from
// api.weather.gov and cached by the page itself (js/nwsapi.js, Cache API
// 'wx-grid'), which this worker never touches. Bump VERSION when the file
// list changes. ({{ID}} is filled in from app.json by tools/build-dist.mjs.)
const VERSION = '{{ID}}-v4';

const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
  'css/tokens.css', 'css/app.css', 'vendor/uPlot.min.css', 'vendor/uPlot.iife.min.js',
  'js/app.js', 'js/charts.js', 'js/fmt.js', 'js/now.js', 'js/nws.js', 'js/nwsapi.js', 'js/places.js',
  'js/sun.js', 'js/time.js', 'js/uplot.js',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // only our own shell caches; the page's 'wx-grid' cache stays
    for (const key of await caches.keys()) if (key !== VERSION && key.startsWith('{{ID}}-')) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const refresh = () => fetch(req).then(res => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });
    if (hit) {
      e.waitUntil(refresh().catch(() => {}));
      return hit;
    }
    try {
      return await refresh();
    } catch (err) {
      if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
      throw err;
    }
  })());
});
