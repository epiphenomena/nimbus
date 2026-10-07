// Small formatting helpers and the staleness rule.
// With direct fetches, `issued` is NWS's updateTime; NWS refreshes grids
// several times a day, so a forecast older than this is worth flagging.
export const STALE_HOURS = 8;
export const isStale = (issued, now = Date.now() / 1000) => now - issued > STALE_HOURS * 3600;

const DIRS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = d => d == null ? '' : DIRS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16];

export const fmt = {
  deg: v => v == null ? '–' : `${Math.round(v)}°`,
  pct: v => v == null ? '–' : `${Math.round(v)}%`,
  mph: v => v == null ? '–' : `${Math.round(v)}`,
  inch: v => v == null ? '–' : v === 0 ? '0' : v < 0.01 ? '<0.01' : v.toFixed(2),
};
