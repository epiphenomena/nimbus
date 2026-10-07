// Sunrise / sunset (NOAA-style, after suncalc by V. Agafonkin). Epoch seconds.
const RAD = Math.PI / 180, E = RAD * 23.4397, J1970 = 2440588, J2000 = 2451545, J0 = 0.0009;

const toDays = ms => ms / 864e5 - 0.5 + J1970 - J2000;
const fromJulian = j => (j + 0.5 - J1970) * 86400;
const meanAnomaly = d => RAD * (357.5291 + 0.98560028 * d);
const eclipticLon = M => M + RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M)) + RAD * 102.9372 + Math.PI;
const transit = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);

/** {rise, set} for the solar day nearest epoch seconds t. */
export function sunTimes(t, lat, lon) {
  const lw = RAD * -lon, phi = RAD * lat, d = toDays(t * 1000);
  const n = Math.round(d - J0 - lw / (2 * Math.PI));
  const ds = J0 + lw / (2 * Math.PI) + n;
  const M = meanAnomaly(ds), L = eclipticLon(M);
  const dec = Math.asin(Math.sin(E) * Math.sin(L));
  const noon = transit(ds, M, L);
  const w = Math.acos((Math.sin(-0.833 * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));
  const set = transit(J0 + (w + lw) / (2 * Math.PI) + n, M, L);
  return { rise: fromJulian(noon - (set - noon)), set: fromJulian(set) };
}

/** Night intervals [[start, end], ...] covering [a, b]. */
export function nights(a, b, lat, lon) {
  const out = [];
  let prevSet = null;
  for (let t = a - 86400; t <= b + 86400; t += 86400) {
    const { rise, set } = sunTimes(t, lat, lon);
    if (prevSet !== null && rise > prevSet) out.push([prevSet, rise]);
    prevSet = set;
  }
  return out.filter(([s, e]) => e > a && s < b);
}

export function isNight(t, lat, lon) {
  const { rise, set } = sunTimes(t, lat, lon);
  return t < rise || t > set;
}
