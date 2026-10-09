# Meridian mode guide

Meridian is a static site with six daily geography puzzles. Zero running cost: no backend, no paid APIs.
Everything a puzzle needs is pre-computed offline into `public/data/<mode>/` by a Node script.

## Stack
- Vite 7 + TypeScript (strict), vanilla DOM. No UI framework.
- `d3-geo`, `topojson-client` at runtime. `topojson-server`, `topojson-simplify`, `geotiff` for data scripts.
- Do not add or upgrade npm packages and do not touch `package.json` / `package-lock.json`.
  Python 3 standard library is available for data scripts if you prefer it.

## Files you own (one mode = one folder)
- `src/modes/<id>/index.ts` – default export implements `ModeModule` (`src/modes/types.ts`).
- `src/modes/<id>/*.ts`, `src/modes/<id>/style.css` – import the CSS from index.ts. Scope every selector under `.mode-<id>`.
- `scripts/build-<id>.mjs` – reads `data-raw/`, writes `public/data/<id>/…`. Must be re-runnable.
- `tests/<id>.test.mjs` – `node --test` tests for the pure logic (scoring, feedback) and the generated data.

Do not edit shared files (`src/core/*`, `src/main.ts`, `src/style.css`, `src/modes/registry.ts`, `scripts/lib/*`).
If you truly need a change there, describe it in your final report instead.

## Shared building blocks (read them)
- `src/core/daily.ts` – `puzzleIndex(day, n)`, `mulberry32(seed)`. `?day=N` in the URL overrides the day for testing.
- `src/core/storage.ts` – `loadGame/saveGame(mode, day, state)` restore progress on reload; `recordResult(mode, day, won, bucket, label)` once at game end.
- `src/core/i18n.ts` – `makeT({ en: {...}, tr: {...} })`. Every user-visible string must exist in English and Turkish. `fold()` for accent-insensitive matching.
- `src/core/countries.ts` – `public/data/countries.json`: 237 entries `{c, en, tr, lat, lon, cont, sov, area, pop, nb, al}`. `country(code)`, `countryName(code)`, `countryItems()` for autocomplete. Codes are ISO 3166-1 alpha-2 (XK Kosovo). Loaded before `mount` runs.
- `src/core/ui.ts` – `h()` hyperscript, `svgEl()`, `autocomplete()`, `modal()`, `toast()`, `resultPanel()` (headline, detail, share text, stats, countdown).
- `src/core/geo.ts` – `haversineKm`, `bearingDeg`, `arrowFor`, `formatKm`, `flag`.
- `src/core/map.ts` – `loadWorld()` + `drawWorld(svg, projection, world, fill)` for a display world map (country features have `id` = code).
- `src/core/data.ts` – `loadJSON(path)` relative to `public/data/`.
- CSS tokens in `src/style.css` (`--good`, `--near`, `--bad`, `--accent`, `--land`, `--sea`, `.panel`, `.btn`, `.guess`, `.tile`, `.mapbox`…). Use the tokens; both light and dark mode must look right.

## Game rules every mode follows
- One puzzle per local day, same for everyone: `puzzles[puzzleIndex(day, puzzles.length)]`.
  Generate at least 365 puzzles, already shuffled with a fixed seed in the build script so neighbouring days differ.
- One screen, finishable in under 3 minutes, works at 360 px phone width with no horizontal scroll, touch + mouse.
- Progress is saved after every action and fully restored on reload; a finished game shows the result panel again.
- Call `recordResult` exactly once when the game ends. `bucket` must be one of the labels you pass as `buckets` to `resultPanel`.
- Share text: first line `Meridian <Mode name> #<day>`, then an emoji line that shows how it went without spoiling the answer, then the URL `https://meridian.example/#/<id>` (placeholder, will be replaced).
- `howTo()` returns a short explanation with one concrete example, in the current language.
- Answers live in public JSON; that is acceptable. Do not show them before the game ends.
- Data attribution for the reveal screen where relevant (GeoNames CC BY 4.0, © OpenStreetMap contributors ODbL, GHSL CC BY 4.0, Natural Earth public domain).

## Raw data already in `data-raw/` (git-ignored, from `npm run data:fetch`)
- `ne_10m_admin_0_countries.geojson`, `ne_50m_admin_0_countries.geojson` – use `scripts/lib/countries-src.mjs` (`loadFeatures`, `mergeByCode`) so country codes match `countries.json`.
- `ne_10m_rivers_lake_centerlines.geojson`, `ne_10m_lakes.geojson`
- `cities500.txt` (GeoNames, places with population ≥ 500; tab-separated, see https://download.geonames.org/export/dump/readme.txt), `countryInfo.txt`.
Download anything else you need into `data-raw/` from your build script (idempotent, skip if present) and add it to `scripts/fetch-sources.mjs` only via your report.

## Verification before you finish
1. `node scripts/build-<id>.mjs` runs clean and prints a summary.
2. `node --test tests/<id>.test.mjs` passes.
3. `npx tsc --noEmit` shows no errors in your folder (errors in other modes' folders are someone else's work in progress; ignore them).
4. Keep `public/data/<id>/` small: target under 1.5 MB total gzip for the mode, and the file loaded for a single day under 300 KB.
