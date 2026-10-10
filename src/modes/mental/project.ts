import { geoAzimuthalEquidistant, geoCentroid, geoNaturalEarth1, type GeoProjection } from 'd3-geo';
import type { Pt } from './fit';

export const EARTH_KM = 6371.0088;

/**
 * Ground-truth layout for a set, in kilometres, north up.
 * Regional sets: azimuthal equidistant centred on the set, so distances and directions from the
 * middle are true and a locally correct mental map scores ~100 with no fake N–S bias.
 * World sets: Natural Earth, the best compromise between the atlas maps people picture (no flat map is "right" at that scale; the N–S readout is hidden there).
 */
export function setProjection(places: { lat: number; lon: number }[], world = false): GeoProjection {
  if (world) {
    let x = 0;
    let y = 0;
    for (const p of places) {
      x += Math.cos((p.lon * Math.PI) / 180);
      y += Math.sin((p.lon * Math.PI) / 180);
    }
    const lon0 = (Math.atan2(y, x) * 180) / Math.PI;
    return geoNaturalEarth1().rotate([-lon0, 0]).scale(EARTH_KM).translate([0, 0]).precision(5);
  }
  const [lon0, lat0] = geoCentroid({ type: 'MultiPoint', coordinates: places.map((p) => [p.lon, p.lat]) });
  return geoAzimuthalEquidistant().rotate([-lon0, -lat0]).scale(EARTH_KM).translate([0, 0]).precision(5);
}

/**
 * The projection a country's shape is drawn with when it is a piece in the player's hand.
 * Regional sets: the set's own projection, so a piece put in the right place covers the real map exactly.
 * World sets: the same projection turned to the country's own meridian, so no piece is sheared or cut
 * in two by the edge of the map.
 */
export function pieceProjection(places: { lat: number; lon: number }[], place: { lon: number }, world = false): GeoProjection {
  return world ? geoNaturalEarth1().rotate([-place.lon, 0]).scale(EARTH_KM).translate([0, 0]) : setProjection(places);
}

export function projectAll(proj: GeoProjection, places: { lat: number; lon: number }[]): Pt[] {
  return places.map((p) => proj([p.lon, p.lat]) as Pt);
}
