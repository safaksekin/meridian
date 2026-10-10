# Meridian

Six daily geography puzzles in one static site: Beeline, Streetprint, Mental Map, Headcount, Hinterland and Tripoint.
Every puzzle is pre-generated from open data, so the site runs with no backend and no running cost.

## Develop

```
npm install
npm run dev
```

Raw data for rebuilding puzzles: `npm run data:fetch`, then `node scripts/build-<mode>.mjs`. Contributor notes are in `docs/MODE_GUIDE.md`.

## Data

Natural Earth (public domain), GeoNames (CC BY 4.0), © OpenStreetMap contributors (ODbL), GHSL population grid (CC BY 4.0), Wikidata (CC0).
