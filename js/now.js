// Now / forecast view: header, day strip, stacked meteogram.
import { createStack, css, alpha, bars, refLines } from './charts.js';
import { local, dayStart, whenLabel, dayLabel, dateLabel, hourLabel, ago } from './time.js';
import { isNight, sunTimes } from './sun.js';
import { compass, fmt, isStale } from './fmt.js';

const $ = id => document.getElementById(id);
const QPF_BIN = 3; // hours per rain-amount bar

let stack = null;
let fc = null;
let status = {};
let defaultRange = null;

/**
 * forecast: nws.js transform() output plus {place, lat, lon, tz, radar}.
 * st: {source: 'fresh'|'network'|'fallback', fetched (ms), error, reset}
 * reset (a different location) drops the kept zoom range and crosshair.
 */
export function renderNow(forecast, st = {}) {
  const reset = st.reset || (fc && fc.place !== forecast.place);
  fc = forecast;
  status = { ...st, reset: false };
  $('now-problem').hidden = true;
  $('view-now').classList.remove('loading');
  const keepRange = reset ? null : stack?.range, keepCursor = reset ? null : stack?.cursor;
  const n = fc.series.temp.length;
  const xs = Array.from({ length: n }, (_, i) => fc.t0 + i * fc.step);
  const now = Date.now() / 1000;
  const iNow = Math.min(n - 1, Math.max(0, Math.round((now - fc.t0) / fc.step)));

  $('place-name').textContent = fc.place;
  $('place-btn').title = [fc.city, fc.state].filter(Boolean).join(', ');
  const radar = fc.radar ? `https://radar.weather.gov/station/${fc.radar}/standard` : `https://radar.weather.gov/?center=${fc.lon},${fc.lat}`;
  $('radar-tab').href = radar;
  header(iNow, now);
  issued();
  const xMin = xs[0], xMax = xs[n - 1];
  const start = Math.max(xMin, Math.floor(now / 3600) * 3600 - 2 * 3600);
  defaultRange = [start, Math.min(xMax, start + (innerWidth >= 900 ? 74 : 44) * 3600)];
  days(xs);
  charts(xs, keepRange ?? defaultRange, keepCursor ?? xs[iNow], now);
}

/** Re-render (e.g. after a color-scheme change), keeping range and cursor. */
export function redrawNow() { if (fc) renderNow(fc, status); }

/** While a location loads: its name in the header, the old charts dimmed. */
export function loadingNow(place) {
  $('place-name').textContent = place.name;
  $('view-now').classList.add('loading');
}

/** Something stopped the forecast (outside coverage, NWS down with nothing cached). */
export function problemNow(place, text) {
  $('place-name').textContent = place.name;
  $('view-now').classList.remove('loading');
  const el = $('now-problem');
  el.textContent = text;
  el.hidden = false;
}

export function tickNow() { if (fc) issued(); }

function skyText(sky, pop, t) {
  const night = isNight(t, fc.lat, fc.lon);
  let s = sky == null ? '' : sky <= 10 ? (night ? 'Clear' : 'Sunny') : sky <= 30 ? (night ? 'Mostly clear' : 'Mostly sunny')
    : sky <= 60 ? 'Partly cloudy' : sky <= 85 ? 'Mostly cloudy' : 'Cloudy';
  if (pop != null && pop >= 50) s = 'Rain likely';
  return s;
}

function header(i, now) {
  const S = fc.series;
  $('now-temp').textContent = fmt.deg(S.temp[i]);
  $('now-sky').textContent = skyText(S.sky[i], S.pop[i], now);
  const feels = S.feels[i], dew = S.dew[i];
  $('now-feels').textContent = `Feels ${fmt.deg(feels)}`;
  const nw = t => Object.assign(document.createElement('span'), { className: 'nw', textContent: t });
  $('now-dew').replaceChildren(nw(`Dew ${fmt.deg(dew)}`), ...(S.rh[i] != null ? [' · ', nw(`RH ${Math.round(S.rh[i])}%`)] : []));
  const gust = S.gust[i] != null && S.wind[i] != null && S.gust[i] > S.wind[i] + 3 ? ` g${fmt.mph(S.gust[i])}` : '';
  const wind = S.wind[i] == null ? '' : S.wind[i] < 1 ? `Calm${gust}` : `${compass(S.dir[i])} ${fmt.mph(S.wind[i])}${gust} mph`;

  // next rain: first hour in the next 48 with pop >= 30
  let next = -1, max = 0;
  for (let j = i; j < Math.min(S.pop.length, i + 48); j++) {
    const p = S.pop[j] ?? 0;
    max = Math.max(max, p);
    if (next < 0 && p >= 30) next = j;
  }
  let rain;
  if (next < 0) rain = 'No rain 48h';
  else {
    const t = fc.t0 + next * fc.step;
    const when = next === i ? 'now' : `${local(t).d === local(now).d ? '' : dayLabel(t) + ' '}${hourLabel(t)}`;
    rain = `${Math.round(S.pop[next])}% rain ${when}`; // the day chips carry each day's peak
  }
  $('now-wind').textContent = wind || '\u00a0';
  $('now-rain').textContent = rain;
  // the next sunrise or sunset
  const { rise, set } = sunTimes(now, fc.lat, fc.lon);
  const sun = now < rise ? ['Sunrise', rise] : now < set ? ['Sunset', set] : ['Sunrise', sunTimes(now + 86400, fc.lat, fc.lon).rise];
  $('now-sun').textContent = `${sun[0]} ${new Date(sun[1] * 1000).toLocaleTimeString('en-US', { timeZone: fc.tz, hour: 'numeric', minute: '2-digit' }).replace(' AM', 'a').replace(' PM', 'p')}`;
  // a storm in the next 6h: light up the radar tab
  const soon = S.pop.slice(i, i + 6).some(p => (p ?? 0) >= 40);
  $('radar-tab').classList.toggle('rainy', soon);
}

function issued() {
  const now = Date.now() / 1000;
  const when = new Date(fc.issued * 1000).toLocaleString('en-US', { timeZone: fc.tz, weekday: 'short', hour: 'numeric', minute: '2-digit' });
  $('now-issued').textContent = `NWS ${ago(fc.issued, now)}`;
  $('now-issued').title = `Issued ${when}${status.fetched ? `, fetched ${ago(status.fetched / 1000, now)}` : ''}`;
  const note = $('now-note');
  const stale = isStale(fc.issued, now);
  note.hidden = !stale && status.source !== 'fallback';
  note.classList.toggle('warn', stale);
  note.textContent = status.source === 'fallback'
    ? `Cached copy · issued ${ago(fc.issued, now)} (${when}) · NWS didn’t answer`
    : `Stale · issued ${ago(fc.issued, now)} (${when})`;
}

// ---- day strip ----
function days(xs) {
  const nav = $('days');
  nav.textContent = '';
  const groups = new Map();
  xs.forEach((t, i) => {
    const d = dayStart(t);
    if (!groups.has(d)) groups.set(d, []);
    groups.get(d).push(i);
  });
  const S = fc.series;
  const nowS = Date.now() / 1000;
  // days that are already over (old data) are skipped
  [...groups.entries()].filter(([d]) => d + 86400 > nowS).slice(0, 7).forEach(([d, idx]) => {
    const vals = k => idx.map(i => S[k][i]).filter(v => v != null);
    const temps = vals('temp'), pops = vals('pop');
    const b = document.createElement('button');
    b.className = 'day';
    b.dataset.day = d;
    b.setAttribute('aria-pressed', 'false');
    const pop = pops.length ? Math.max(...pops) : 0;
    const name = document.createElement('span'); name.className = 'day__name';
    name.textContent = d <= Date.now() / 1000 ? 'Today' : dayLabel(d + 43200);
    const hi = document.createElement('span'); hi.className = 'day__hi'; hi.textContent = temps.length ? fmt.deg(Math.max(...temps)) : '–';
    const lo = document.createElement('span'); lo.className = 'day__lo'; lo.textContent = temps.length ? fmt.deg(Math.min(...temps)) : '–';
    const p = document.createElement('span'); p.className = 'day__pop' + (pop >= 30 ? ' wet' : '');
    if (pop >= 10) {
      p.innerHTML = '<svg viewBox="0 0 9 11" aria-hidden="true"><path d="M4.5 0C3 3 0 5.2 0 7.3A4.5 4.5 0 0 0 9 7.3C9 5.2 6 3 4.5 0z"/></svg>';
      p.append(document.createTextNode(`${Math.round(pop)}%`));
    }
    b.setAttribute('aria-label', `${dayLabel(d + 43200)} ${dateLabel(d + 43200)}: high ${hi.textContent}, low ${lo.textContent}, rain ${Math.round(pop)}%`);
    b.append(name, hi, lo, p);
    b.addEventListener('click', () => {
      if (!stack) return;
      if (b.getAttribute('aria-pressed') === 'true') stack.setRange(...defaultRange);
      else {
        stack.setRange(d, d + 24 * 3600);
        const [a, z] = stack.range;
        if (stack.cursor == null || stack.cursor < a || stack.cursor > z) stack.setCursor(Math.max(a, d + 15 * 3600 > z ? a : d + 15 * 3600));
      }
    });
    nav.append(b);
  });
}

function markDays(a, b) {
  for (const el of $('days').children) {
    const d = +el.dataset.day;
    // pressed when the range is (about) that day
    el.setAttribute('aria-pressed', String(Math.abs(a - Math.max(d, xsMin)) < 3600 && Math.abs(b - Math.min(d + 86400, xsMax)) < 3 * 3600 && b - a <= 26 * 3600));
  }
  const r = document.querySelector('#now-readout .range');
  if (r) rangeLabel(r, a, b);
}
let xsMin = 0, xsMax = 0;

function rangeLabel(el, a, b) {
  el.textContent = '';
  const isDefault = defaultRange && Math.abs(a - defaultRange[0]) < 1800 && Math.abs(b - defaultRange[1]) < 1800;
  const span = Math.round((b - a) / 3600);
  el.append(document.createTextNode(isDefault ? `next ${span - 2}h ` : `${span <= 48 ? span + 'h' : Math.round(span / 24) + ' days'} `));
  if (!isDefault) {
    const reset = document.createElement('button');
    reset.textContent = 'Reset';
    reset.addEventListener('click', () => stack.setRange(...defaultRange));
    el.append(reset);
  }
}

// ---- charts ----
function charts(xs, range, cursor, now) {
  const S = fc.series;
  xsMin = xs[0]; xsMax = xs[xs.length - 1];
  const c = {
    temp: css('--s-temp'), feels: css('--s-feels'), dew: css('--s-dew'), rain: css('--s-rain'),
    wind: css('--s-wind'), gust: css('--s-gust'), sky: css('--s-sky'), ref: css('--ref'), faint: css('--text-faint'),
  };

  // rain amount: QPF_BIN-hour totals, bars centered on their bin
  const binStart = xs.findIndex(t => local(t).h % QPF_BIN === 0);
  const qx = [], qy = [];
  for (let i = Math.max(0, binStart); i < xs.length; i += QPF_BIN) {
    let sum = 0, any = false;
    for (let j = i; j < Math.min(xs.length, i + QPF_BIN); j++) if (S.qpf[j] != null) { sum += S.qpf[j]; any = true; }
    qx.push(xs[i] + (QPF_BIN * 3600) / 2);
    qy.push(any ? Math.round(sum * 1000) / 1000 : null);
  }
  const qpfAt = t => { const k = Math.floor((t - (xs[Math.max(0, binStart)])) / (QPF_BIN * 3600)); return qy[k] ?? null; };

  const line = (stroke, width = 2, extra = {}) => ({ stroke, width, points: { show: false }, spanGaps: false, ...extra });
  const pad = (lo, hi) => [Math.floor(lo - 3), Math.ceil(hi + 3)];
  // desktop: wider plots get a bit more height
  const H = h => Math.round(h * (innerWidth >= 900 ? 1.45 : 1));
  const windMax = Math.max(15, ...S.gust.filter(v => v != null), ...S.wind.filter(v => v != null));

  const specs = [
    {
      title: 'Temperature °F', height: H(122), dayLabels: true,
      legend: [{ label: 'Temp', color: c.temp }, { label: 'Feels', color: c.feels }, { label: 'Dew', color: c.dew, kind: 'thin' }],
      // drawn bottom to top: dew, feels, then temp on top
      data: [xs, S.dew, S.feels, S.temp],
      series: [line(alpha(c.dew, 0.75), 1.25), line(c.feels, 1.5), line(c.temp)],
      y: { range: (u, lo, hi) => pad(lo, hi) },
      plugins: [refLines([32, 100], c.ref, v => `${v}°`)],
    },
    {
      title: 'Rain chance & cloud %', height: H(68),
      legend: [{ label: 'Rain', color: c.rain }, { label: 'Cloud', color: alpha(c.sky, 0.45), kind: 'area' }],
      // cloud cover underneath as a quiet wash, rain chance on top
      data: [xs, S.sky, S.pop],
      series: [line(alpha(c.sky, 0.5), 1, { fill: alpha(c.sky, 0.16) }), line(c.rain, 1.75, { fill: alpha(c.rain, 0.14) })],
      y: { range: [0, 100] }, ySplits: () => [0, 50, 100],
    },
    {
      title: `Rain amount in per ${QPF_BIN}h`, height: H(48), cursorPoints: false,
      data: [qx, qy],
      series: [{ stroke: c.rain, fill: c.rain, width: 0, paths: bars(0.72, 18), points: { show: false } }],
      y: { range: (u, lo, hi) => [0, Math.max(0.1, hi * 1.1)] },
      ySplits: (u) => { const m = u.scales.y.max; return m <= 0.1 ? [0, 0.05, 0.1] : [0, +(m / 2).toFixed(2)]; },
      yValues: (u, v) => v.map(x => x === 0 ? '0' : x.toFixed(2).replace(/^0/, '')),
    },
    {
      title: 'Wind mph', height: H(80),
      legend: [{ label: 'Wind', color: c.wind }, { label: 'Gust', color: c.gust, kind: 'thin' }],
      data: [xs, S.wind, S.gust],
      series: [line(c.wind), line(c.gust, 1.25)],
      // the band below zero holds the direction arrows
      y: { range: () => [-windMax * 0.32, windMax * 1.08] },
      ySplits: u => { const m = u.scales.y.max; const st = m > 40 ? 20 : 10; const out = []; for (let v = 0; v <= m; v += st) out.push(v); return out; },
      plugins: [arrows(xs, S.dir, c.faint)],
    },
  ];

  stack?.destroy();
  stack = createStack($('now-stack'), {
    charts: specs, lat: fc.lat, lon: fc.lon, now, step: fc.step,
    xMin: xs[0], xMax: xs[xs.length - 1], minSpan: 8 * 3600, range, cursor,
    onCursor: t => readout(t, qpfAt),
    onRange: markDays,
  });
  readout(stack.cursor, qpfAt);
  markDays(...stack.range);
}

function arrows(xs, dir, color) {
  return {
    hooks: {
      draw: u => {
        const c = u.ctx, dpr = devicePixelRatio;
        const { min, max } = u.scales.x;
        const y = u.valToPos(u.scales.y.min * 0.5, 'y', true);
        const pxPerHour = u.bbox.width / ((max - min) / 3600);
        const every = [1, 2, 3, 6, 12, 24].find(h => h * pxPerHour >= 26 * dpr) ?? 24;
        c.save();
        c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 1.4 * dpr; c.lineCap = 'round';
        for (let i = 0; i < xs.length; i++) {
          const t = xs[i];
          if (t < min || t > max || dir[i] == null || local(t).h % every !== 0) continue;
          const x = u.valToPos(t, 'x', true);
          // NWS direction is where the wind comes FROM; the arrow points where it goes.
          const a = (dir[i] + 180) * Math.PI / 180, r = 6 * dpr;
          const dx = Math.sin(a) * r, dy = -Math.cos(a) * r;
          c.beginPath(); c.moveTo(x - dx, y - dy); c.lineTo(x + dx, y + dy); c.stroke();
          const hx = x + dx, hy = y + dy, s = 3.6 * dpr;
          c.beginPath();
          c.moveTo(hx, hy);
          c.lineTo(hx - Math.sin(a - 0.5) * s, hy + Math.cos(a - 0.5) * s);
          c.lineTo(hx - Math.sin(a + 0.5) * s, hy + Math.cos(a + 0.5) * s);
          c.closePath(); c.fill();
        }
        c.restore();
      },
    },
  };
}

function readout(t, qpfAt) {
  const el = $('now-readout');
  el.textContent = '';
  const when = document.createElement('div');
  when.className = 'readout__when';
  const w = document.createElement('span');
  const range = document.createElement('span');
  range.className = 'range';
  when.append(w, range);
  const vals = document.createElement('div');
  vals.className = 'readout__vals';
  el.append(when, vals);
  if (stack) rangeLabel(range, ...stack.range);
  if (t == null) { w.textContent = ' '; return; }
  const i = Math.round((t - fc.t0) / fc.step), S = fc.series;
  w.textContent = whenLabel(t);
  const item = (color, value, label, kind) => {
    const s = document.createElement('span'); s.className = 'rv';
    if (color) { const k = document.createElement('i'); k.className = `key${kind ? ' key--' + kind : ''}`; k.style.color = color; if (kind === 'area') k.style.background = color; s.append(k); }
    const b = document.createElement('b'); b.textContent = value;
    s.append(b);
    if (label) { const l = document.createElement('span'); l.textContent = label; s.append(l); }
    vals.append(s);
  };
  item(css('--s-temp'), fmt.deg(S.temp[i]), '');
  item(css('--s-feels'), fmt.deg(S.feels[i]), 'feels');
  item(css('--s-dew'), fmt.deg(S.dew[i]), 'dew', 'thin');
  item(css('--s-rain'), fmt.pct(S.pop[i]), 'rain');
  item(css('--s-sky'), fmt.pct(S.sky[i]), 'cloud', 'area');
  item(css('--s-rain'), `${fmt.inch(qpfAt(t))}″`, `/${QPF_BIN}h`, 'area');
  item(css('--s-wind'), `${compass(S.dir[i])} ${fmt.mph(S.wind[i])}`, `g${fmt.mph(S.gust[i])} mph`);
}

