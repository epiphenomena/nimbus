// Local-time helpers. Everything is epoch seconds UTC in the data; the UI is in the
// location's time zone, computed with Intl (never a fixed offset: DST).
// The zone follows the selected location (NWS points' timeZone): setTZ().
export let TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

let partsFmt;
const cache = new Map();
export function setTZ(tz) {
  if (partsFmt && tz === TZ) return;
  TZ = tz;
  partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric',
  });
  cache.clear();
}
setTZ(TZ);

/** {y, m, d, h, wd} in the location's zone for epoch seconds `t`. */
export function local(t) {
  const key = Math.floor(t / 3600);
  let p = cache.get(key);
  if (!p) {
    const o = {};
    for (const { type, value } of partsFmt.formatToParts(new Date(key * 3600e3))) o[type] = value;
    p = { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, wd: o.weekday };
    if (cache.size > 5000) cache.clear();
    cache.set(key, p);
  }
  return p;
}

/** Epoch seconds of every local midnight in [a, b]. */
export function midnights(a, b) {
  const out = [];
  for (let t = Math.ceil(a / 3600) * 3600; t <= b; t += 3600) if (local(t).h === 0) out.push(t);
  return out;
}

/** Start of the local day containing t. */
export function dayStart(t) {
  let s = Math.floor(t / 3600) * 3600;
  while (local(s).h !== 0) s -= 3600;
  return s;
}

export const hourLabel = t => {
  const h = local(t).h;
  return h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? `${h}a` : `${h - 12}p`;
};
export const hourLong = t => {
  const h = local(t).h;
  return h === 0 ? '12 AM' : h === 12 ? 'Noon' : h < 12 ? `${h} AM` : `${h - 12} PM`;
};
export const dayLabel = t => local(t).wd;
export const dateLabel = t => { const p = local(t); return `${p.m}/${p.d}`; };
export const whenLabel = t => `${dayLabel(t)} ${dateLabel(t)} ${hourLong(t)}`;

export function ago(t, now = Date.now() / 1000) {
  const s = Math.max(0, now - t);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 36 * 3600) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)} days ago`;
}
