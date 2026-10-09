// Shared by the browser and scripts/build-headcount.mjs: which country (and so which continent)
// a circle centre falls in. Uses the same display world map (public/data/world.json) on both sides.
import { geoBounds, geoContains } from 'd3-geo';

/** Returns a function (lon, lat) -> country code or null (sea / unclaimed). */
export function makeLocator(features) {
  const items = features.map((f) => {
    const [[w, s], [e, n]] = geoBounds(f);
    return { f, w, s, e, n, wrap: w > e };
  });
  return (lon, lat) => {
    for (const it of items) {
      if (lat < it.s || lat > it.n) continue;
      if (it.wrap ? lon < it.w && lon > it.e : lon < it.w || lon > it.e) continue;
      if (geoContains(it.f, [lon, lat])) return String(it.f.id);
    }
    return null;
  };
}

/**
 * region: null (anywhere), { in: 'Africa' } or { out: 'Asia' } using the `cont` names of countries.json.
 * cont: continent of the country under the centre, or null for the sea.
 */
export function regionOk(region, cont) {
  if (!region) return true;
  if (!cont) return false;
  return region.in ? cont === region.in : cont !== region.out;
}
