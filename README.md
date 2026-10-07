# Nimbus

A small, phone-first weather app: the National Weather Service hourly forecast
drawn as a stacked meteogram, plus one-tap radar links and a few saved
locations.

**Live:** https://nimbus.literal.work/

- **Now:** current temperature, feels-like, dew point, wind and the next chance of rain.
- **Day strip:** seven days of highs, lows and peak rain chance. Tap a day to zoom to it.
- **Meteogram:** four thin charts share one time axis:
  - temperature, feels-like and dew point;
  - rain chance over cloud cover;
  - rain amount, as 3-hour totals;
  - wind and gusts, with direction arrows.
  
  Drag a finger across any chart to move a crosshair through all of them. The values at that hour stay in a row above the charts. Pinch to zoom. Night is shaded and midnights are marked, in the location's own time zone.
- **Radar:** links to the NWS radar station for the location, and to Windy.
- **Locations:** saved places. Add one with "Use my location" or by searching for a city name or US ZIP code. Star the one that opens first.

## Privacy

Nimbus has no accounts, analytics, cookies or server-side code. Your
locations live in your browser's `localStorage`. The browser talks directly to
two services:

- [api.weather.gov](https://www.weather.gov/documentation/services-web-api) (NWS) for the forecast;
- [Open-Meteo's geocoder](https://open-meteo.com/en/docs/geocoding-api), only when you search for a place.

Coverage is wherever NWS forecasts: the US and its territories.

## How it works

The site is static files: vanilla ES modules with no bundler or transpiler, plus
[uPlot](https://github.com/leeoniya/uPlot) (vendored in `vendor/`) for the
charts.

- `js/nwsapi.js` handles the network requests:
  - `/points/{lat},{lon}` gives the forecast grid, time zone, radar station and nearest city. The answer is cached for 30 days.
  - The raw gridpoint forecast is cached in the Cache API. A copy under 10 minutes old is used as is.
  - Otherwise it fetches with a 7-second timeout. If that fails, it shows the cached copy, labelled as such.
  - A forecast more than 8 hours old is flagged as stale.
- `js/nws.js` turns NWS's interval-encoded values (`validTime` like `2026-10-03T16:00:00+00:00/PT3H`) into hourly series:
  - it converts units by each field's `uom`;
  - it spreads precipitation totals evenly across their hours.

- `sw.js` caches the app shell (stale-while-revalidate) so the app opens offline. It shows the last forecast it saw, marked as a cached copy.

## Development

You need Node and Ruby (for `rake`).

```sh
npm install          # wrangler, Cloudflare's CLI
rake check           # node --check everything; sw.js lists every app file
rake dev             # build dist/ and serve it at http://127.0.0.1:8788
```

`dist/` is built by `tools/build-dist.mjs` from an allowlist: `index.html`,
`manifest.webmanifest`, `sw.js`, `css/`, `js/`, `icons/` and `vendor/`. It
fills the app name from `app.json` into those files. Nothing else in the repo is
ever served.

`rake icons` redraws the PNG icons from `tools/make-icons.py`, which matches
`icons/icon.svg`.

## Deploying

The app is deployed to Cloudflare as static assets only, with no Worker
script. `wrangler.toml` points at `dist/` and the custom domain.

```sh
npx wrangler login   # once
rake deploy          # check, build dist/, wrangler deploy, then probe the live site
rake verify          # just the probe: app files 200, repo files 404
```

To rename the app, edit `app.json`. Then edit the two lines marked `NAME` in
`wrangler.toml`.

## Credits

- Forecast data: NOAA / National Weather Service.
- Place search: [Open-Meteo](https://open-meteo.com/) (CC BY 4.0), built on GeoNames.
- Charts: uPlot (MIT).

## License

MIT. See [LICENSE](LICENSE).
