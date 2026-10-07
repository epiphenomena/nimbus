// Saved locations (localStorage) and the Locations view.
//
// A place: {id, name, lat, lon, city, state, def}. `def` (the star) is the
// one that opens on launch; the first place added gets it. Adding: "Use my location"
// (Geolocation, named after NWS's nearest city) or a search via Open-Meteo's
// geocoder (CORS-open; takes city names and US ZIP codes).
import { points, round4, OutsideCoverage } from './nwsapi.js';

const KEY = 'wx-places';
const GEOCODE = 'https://geocoding-api.open-meteo.com/v1/search';
const $ = id => document.getElementById(id);

let list = null;
let hooks = { open() {}, changed() {} };

export function places() {
  if (!list) {
    try { list = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (!Array.isArray(list)) list = [];
    if (list.length && !list.some(p => p.def)) list[0].def = true;
  }
  return list;
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {} };

export const defaultPlace = () => places().find(p => p.def) ?? places()[0];
export const byId = id => places().find(p => p.id === id);
export const label = p => p.city && p.city.toLowerCase() !== p.name.toLowerCase() ? `${p.city}, ${p.state}` : p.state || '';

/** Fill in city/state from NWS once known. */
export function remember(p, meta) {
  if (p.city === meta.city && p.state === meta.state) return;
  p.city = meta.city; p.state = meta.state;
  save();
}

function add(name, lat, lon, meta) {
  lat = round4(lat); lon = round4(lon);
  const same = places().find(p => p.lat === lat && p.lon === lon);
  if (same) return same;
  const p = { id: Math.random().toString(36).slice(2, 10), name, lat, lon, city: meta.city, state: meta.state, def: !list.some(q => q.def) };
  list.push(p);
  save();
  return p;
}

// ---- view ----

/** Wire up the Locations view. hooks: {open(place), changed()} */
export function initPlaces(h) {
  hooks = h;
  $('pl-search').addEventListener('submit', e => { e.preventDefault(); search($('pl-q').value.trim()); });
  $('pl-geo').addEventListener('click', geolocate);
  renderPlaces();
}

const msg = (text, err) => { const m = $('pl-msg'); m.textContent = text || ''; m.classList.toggle('err', !!err); };

export function renderPlaces(current) {
  const ul = $('pl-list');
  $('pl-empty').hidden = places().length > 0;
  ul.textContent = '';
  for (const p of places()) {
    const li = document.createElement('li');
    li.className = 'place' + (p.id === current ? ' place--current' : '');

    const star = button('place__star', p.def ? 'Opens on launch' : 'Open this on launch', p.def ? '★' : '☆');
    star.setAttribute('aria-pressed', String(!!p.def));
    star.addEventListener('click', () => { for (const q of list) q.def = q === p; save(); renderPlaces(current); hooks.changed(); });

    const main = button('place__main', `Show ${p.name}`);
    const nm = document.createElement('span'); nm.className = 'place__name'; nm.textContent = p.name;
    const sub = document.createElement('span'); sub.className = 'place__sub'; sub.textContent = label(p) || `${p.lat}, ${p.lon}`;
    main.append(nm, sub);
    main.addEventListener('click', () => hooks.open(p));

    const ren = button('place__btn', `Rename ${p.name}`, '✎');
    ren.addEventListener('click', () => rename(li, p, current));
    const del = button('place__btn', `Delete ${p.name}`, '×');
    del.disabled = list.length === 1;
    del.addEventListener('click', () => confirmDelete(li, p, current));

    li.append(star, main, ren, del);
    ul.append(li);
  }
}

function button(cls, aria, text) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.setAttribute('aria-label', aria);
  if (text) b.textContent = text;
  return b;
}

function rename(li, p, current) {
  const main = li.querySelector('.place__main');
  const f = document.createElement('form'); f.className = 'place__main place__edit';
  const inp = document.createElement('input'); inp.value = p.name; inp.maxLength = 40; inp.setAttribute('aria-label', 'Name');
  const ok = button('place__btn', 'Save', '✓'); ok.type = 'submit';
  f.append(inp, ok);
  f.addEventListener('submit', e => {
    e.preventDefault();
    const v = inp.value.trim();
    if (v) { p.name = v; save(); hooks.changed(); }
    renderPlaces(current);
  });
  inp.addEventListener('keydown', e => { if (e.key === 'Escape') renderPlaces(current); });
  main.replaceWith(f);
  inp.focus(); inp.select();
}

function confirmDelete(li, p, current) {
  li.textContent = '';
  li.className = 'place place--confirm';
  const t = document.createElement('span'); t.className = 'place__main'; t.textContent = `Delete ${p.name}?`;
  const yes = button('btn btn--danger', `Delete ${p.name}`, 'Delete');
  const no = button('btn btn--ghost', 'Keep', 'Keep');
  yes.addEventListener('click', () => {
    list = list.filter(q => q !== p);
    if (!list.some(q => q.def)) list[0].def = true;
    save(); renderPlaces(current); hooks.changed(p);
  });
  no.addEventListener('click', () => renderPlaces(current));
  li.append(t, yes, no);
}

async function addChecked(name, lat, lon) {
  msg('Checking NWS coverage…');
  try {
    const meta = await points(lat, lon);
    const p = add(name || meta.city || `${round4(lat)}, ${round4(lon)}`, lat, lon, meta);
    msg('');
    $('pl-results').textContent = '';
    $('pl-q').value = '';
    hooks.open(p);
  } catch (e) {
    msg(e instanceof OutsideCoverage ? 'That spot is outside NWS forecast coverage.' : `Couldn’t reach NWS: ${e.message}`, true);
  }
}

function geolocate() {
  if (!navigator.geolocation) return msg('This browser can’t share its location.', true);
  msg('Finding you…');
  navigator.geolocation.getCurrentPosition(
    pos => addChecked('', pos.coords.latitude, pos.coords.longitude),
    err => msg(err.code === 1 ? 'Location permission was denied.' : 'Couldn’t get your location.', true),
    { enableHighAccuracy: false, timeout: 15000, maximumAge: 10 * 60e3 },
  );
}

async function search(q) {
  const box = $('pl-results');
  box.textContent = '';
  if (!q) return;
  // "lat, lon" (e.g. pasted from a map) adds that exact point, named after NWS's nearest city.
  const ll = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (ll) return addChecked('', +ll[1], +ll[2]);
  msg('Searching…');
  try {
    const url = `${GEOCODE}?name=${encodeURIComponent(q)}&count=6&language=en&format=json&countryCode=US`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const results = (await res.json()).results || [];
    msg(results.length ? '' : 'No matches. Try a city name, a ZIP code or "lat, lon".', !results.length);
    for (const r of results) {
      const b = button('result', `Add ${r.name}, ${r.admin1 || ''}`);
      const n = document.createElement('span'); n.className = 'place__name'; n.textContent = r.name;
      const s = document.createElement('span'); s.className = 'place__sub';
      s.textContent = [r.admin2, r.admin1].filter(Boolean).join(', ');
      b.append(n, s);
      b.addEventListener('click', () => addChecked(r.name, r.latitude, r.longitude));
      box.append(b);
    }
  } catch (e) {
    msg(`Search failed: ${e.message}`, true);
  }
}

// ---- quick picker (from the forecast header) ----

export function openPicker(current, onPick, onManage) {
  const dlg = $('picker');
  const ul = $('picker-list');
  ul.textContent = '';
  for (const p of places()) {
    const b = button('picker__item' + (p.id === current ? ' is-current' : ''), `Show ${p.name}`);
    const n = document.createElement('span'); n.className = 'place__name'; n.textContent = `${p.def ? '★ ' : ''}${p.name}`;
    const s = document.createElement('span'); s.className = 'place__sub'; s.textContent = label(p);
    b.append(n, s);
    b.addEventListener('click', () => { dlg.close(); onPick(p); });
    ul.append(b);
  }
  $('picker-manage').onclick = () => { dlg.close(); onManage(); };
  dlg.showModal();
}
