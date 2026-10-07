// The app: a forecast view and a Locations view. Forecasts come straight from
// api.weather.gov (nwsapi.js), transformed in nws.js.
import { points, grid, OutsideCoverage } from './nwsapi.js';
import { transform } from './nws.js';
import { setTZ } from './time.js';
import { renderNow, redrawNow, tickNow, loadingNow, problemNow } from './now.js';
import { initPlaces, renderPlaces, defaultPlace, byId, remember, openPicker } from './places.js';

const $ = id => document.getElementById(id);
let current = null;   // the place on screen
let lastLoad = 0;
let seq = 0;

async function load(place, { force = false } = {}) {
  const my = ++seq;
  const switching = current?.id !== place.id;
  current = place;
  try { sessionStorage.setItem('wx-place', place.id); } catch {}
  lastLoad = Date.now();
  loadingNow(place);
  try {
    const meta = await points(place.lat, place.lon);
    remember(place, meta);
    const g = await grid(meta.grid, { force });
    if (my !== seq) return; // a newer request won
    setTZ(meta.tz || Intl.DateTimeFormat().resolvedOptions().timeZone);
    const fc = { ...transform(g.json), place: place.name, city: meta.city, state: meta.state, lat: place.lat, lon: place.lon, tz: meta.tz, radar: meta.radar };
    renderNow(fc, { source: g.source, fetched: g.fetched, error: g.error, reset: switching });
  } catch (e) {
    if (my !== seq) return;
    problemNow(place, e instanceof OutsideCoverage
      ? `${place.name} is outside NWS forecast coverage (the US and its territories).`
      : `Couldn’t get the forecast from NWS: ${e.message}. Try again in a minute.`);
  }
}

function show(view) {
  for (const t of document.querySelectorAll('.tab[data-view]')) {
    if (t.dataset.view === view) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
  }
  $('view-now').hidden = view !== 'now';
  $('view-places').hidden = view !== 'places';
  try { sessionStorage.setItem('wx-view', view); } catch {}
  if (view === 'places') renderPlaces(current?.id);
  else redrawNow(); // sizes may have changed while hidden
  window.scrollTo(0, 0);
}

// With no place saved yet there is no forecast to show: Locations it is.
for (const t of document.querySelectorAll('.tab[data-view]')) t.addEventListener('click', () => show(current ? t.dataset.view : 'places'));

initPlaces({
  open(p) { show('now'); load(p); },
  changed(deleted) {
    if (deleted && deleted.id === current?.id) load(defaultPlace());
    else if (current) { const p = byId(current.id); if (p && p.name !== current.name) load(p); }
  },
});

// Share: copy the app's address (not the page's, which may be a dev server).
const SITE = 'https://nimbus.literal.work/';
$('share').addEventListener('click', async e => {
  const b = e.currentTarget;
  try { await navigator.clipboard.writeText(SITE); }
  catch {
    const t = Object.assign(document.createElement('textarea'), { value: SITE });
    document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  }
  b.textContent = 'Link copied';
  setTimeout(() => { b.textContent = 'Share'; }, 2000);
});

$('place-btn').addEventListener('click', () => openPicker(current?.id, p => load(p), () => show('places')));
$('picker').addEventListener('click', e => { if (e.target === e.currentTarget) e.currentTarget.close(); }); // tap outside closes

// uPlot colors are fixed at creation: rebuild on a light/dark or layout switch.
for (const q of ['(prefers-color-scheme: light)', '(min-width: 900px)']) matchMedia(q).addEventListener('change', () => redrawNow());

// Coming back to the app: refresh if it has been a while (grid() decides
// whether its cached copy is still fresh).
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && current && Date.now() - lastLoad > 10 * 60e3) load(current);
});
setInterval(tickNow, 60e3);

let start = defaultPlace(), view = 'now';
try {
  start = byId(sessionStorage.getItem('wx-place')) ?? start; // a reload keeps what was on screen
  view = sessionStorage.getItem('wx-view') || 'now';
} catch {}
if (!start) show('places');
else {
  if (view === 'places') show('places');
  load(start);
}

if ('serviceWorker' in navigator && !['127.0.0.1', 'localhost'].includes(location.hostname) || new URLSearchParams(location.search).has('sw')) {
  navigator.serviceWorker?.register('sw.js').catch(() => {});
}
