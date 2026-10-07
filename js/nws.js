// NWS gridpoint JSON -> the hourly forecast shape the charts use. No DOM:
// runs in the page and under node.
//
// Output: {issued, t0, step, series: {temp, feels, dew, rh, pop, qpf, wind,
// gust, dir, sky}} -- epoch seconds UTC, hourly from the start of the issued
// hour through the last temperature hour; every series the same length,
// missing values null. Units: °F, %, in per hour, mph, degrees.

const HOUR = 3600;

// Unit conversions by the field's `uom`, rather than assuming NWS's usual ones.
const UNITS = {
  'wmoUnit:degC': v => v * 9 / 5 + 32,
  'wmoUnit:degF': v => v,
  'wmoUnit:K': v => (v - 273.15) * 9 / 5 + 32,
  'wmoUnit:km_h-1': v => v / 1.609344,
  'wmoUnit:m_s-1': v => v * 3600 / 1609.344,
  'wmoUnit:mi_h-1': v => v,
  'wmoUnit:kt': v => v * 1.150779,
  'wmoUnit:mm': v => v / 25.4,
  'wmoUnit:cm': v => v / 2.54,
  'wmoUnit:m': v => v / 0.0254,
  'wmoUnit:in': v => v,
  'wmoUnit:percent': v => v,
  'wmoUnit:degree_(angle)': v => v,
};
// What each field normally comes in, for a field that omits its uom.
const DEFAULT_UOM = { temp: 'wmoUnit:degC', feels: 'wmoUnit:degC', dew: 'wmoUnit:degC', qpf: 'wmoUnit:mm', wind: 'wmoUnit:km_h-1', gust: 'wmoUnit:km_h-1' };

// key: [NWS field, decimals]
export const STATS = {
  temp: ['temperature', 1],
  feels: ['apparentTemperature', 1],
  dew: ['dewpoint', 1],
  rh: ['relativeHumidity', 1],
  pop: ['probabilityOfPrecipitation', 1],
  qpf: ['quantitativePrecipitation', 3],
  wind: ['windSpeed', 1],
  gust: ['windGust', 1],
  dir: ['windDirection', 1],
  sky: ['skyCover', 1],
};
const SPREAD = new Set(['qpf']); // period totals: divided evenly across the period's hours

const DURATION = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/;

/** Python's round(x) for an integer result: ties to even. */
function roundEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** Python's round(x, nd): the double's exact value rounded, exact ties to even. */
export function pyRound(x, nd) {
  const exact = x.toFixed(Math.min(100, nd + 60));          // exact decimal expansion (doubles terminate)
  const tie = new RegExp(`\\.\\d{${nd}}50*$`).test(exact);
  if (!tie) return Number(x.toFixed(nd));
  const m = 10 ** nd;
  const lo = Math.floor(Math.abs(x) * m);
  const r = (lo % 2 === 0 ? lo : lo + 1) / m;
  return x < 0 ? -r : r;
}

const epoch = iso => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) throw new Error(`bad time ${iso}`);
  return Math.floor(ms / 1000);
};

const validCache = new Map();
/** '2023-10-18T16:00:00+00:00/P7DT21H' -> [start epoch, hours]. Ragged times
 *  ('18:00:04/PT59M56S') round both ends to the nearest hour; a value that
 *  rounds to zero hours gets 0 (dropped by the caller). */
export function parseValid(vt) {
  let r = validCache.get(vt);
  if (r) return r;
  const [start, dur] = vt.split('/');
  const m = DURATION.exec(dur ?? '');
  if (!m || dur === 'P' || dur === 'PT') throw new Error(`bad duration ${vt}`);
  const [d, h, mi, sec] = m.slice(1).map(g => Number(g ?? 0));
  const t = epoch(start);
  const end = t + d * 86400 + h * HOUR + mi * 60 + sec;
  const a = roundEven(t / HOUR) * HOUR;
  const b = roundEven(end / HOUR) * HOUR;
  r = [a, Math.floor((b - a) / HOUR)];
  if (validCache.size > 20000) validCache.clear();
  validCache.set(vt, r);
  return r;
}

/** {key: Map(hour -> value)} plus issued, from a gridpoint response. */
export function hourly(js) {
  const props = js.properties;
  const out = {};
  for (const [key, [field]] of Object.entries(STATS)) {
    const vals = new Map();
    const f = props[field] || {};
    const uom = f.uom || DEFAULT_UOM[key] || 'wmoUnit:percent';
    const conv = UNITS[uom];
    if (!conv) throw new Error(`unknown unit ${uom} for ${field}`);
    for (const p of f.values || []) {
      if (p.value == null) continue;
      const [t, hours] = parseValid(p.validTime);
      if (hours <= 0) continue;
      let v = conv(p.value);
      if (SPREAD.has(key)) v = v / hours;
      for (let i = 0; i < hours; i++) vals.set(t + i * HOUR, v);
    }
    out[key] = vals;
  }
  return { issued: epoch(props.updateTime), hourly: out };
}

/** The forecast payload. */
export function transform(js) {
  const { issued, hourly: hr } = hourly(js);
  const t0 = Math.floor(issued / HOUR) * HOUR;
  const end = hr.temp.size ? Math.max(...hr.temp.keys()) : t0;
  const series = {};
  for (const [key, [, nd]] of Object.entries(STATS)) {
    const vals = hr[key], arr = [];
    for (let h = t0; h < end + HOUR; h += HOUR) {
      const v = vals.get(h);
      arr.push(v == null ? null : pyRound(v, nd));
    }
    series[key] = arr;
  }
  return { issued, t0, step: HOUR, series };
}
