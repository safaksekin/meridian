import { geoPath, type GeoProjection, type GeoPermissibleObjects } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, MultiLineString, Position } from 'geojson';
import { loadJSON } from './data';
import { svgEl } from './ui';

export type CountryFeature = Feature<Geometry, Record<string, never>> & { id: string };

let world: { countries: CountryFeature[]; borders: MultiLineString } | null = null;

/** Display-resolution world map (simplified Natural Earth 50m), features keyed by country code. */
export async function loadWorld() {
  if (!world) {
    const topo = await loadJSON<Topology<{ countries: GeometryCollection }>>('world.json');
    const fc = feature(topo, topo.objects.countries) as unknown as FeatureCollection<Geometry>;
    world = {
      countries: fc.features as CountryFeature[],
      borders: mesh(topo, topo.objects.countries, (a, b) => a !== b) as MultiLineString,
    };
  }
  return world;
}

/**
 * Simplifying the map collapses tiny islands and enclaves into rings of two distinct points.
 * d3-geo cannot tell the inside of such a ring from its outside, and at some rotations it paints
 * the whole globe in that country's fill. Draw only the rings that still enclose an area.
 */
const drawable = new WeakMap<CountryFeature, GeoPermissibleObjects | null>();
export function drawableShape(f: CountryFeature): GeoPermissibleObjects | null {
  if (drawable.has(f)) return drawable.get(f)!;
  const g = f.geometry;
  const solid = (ring: Position[]) => new Set(ring.map((c) => `${c[0]},${c[1]}`)).size >= 3;
  let shape: GeoPermissibleObjects | null = f as GeoPermissibleObjects;
  if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
    const polygons = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates)
      .filter((poly) => solid(poly[0]))
      .map((poly) => poly.filter((ring, i) => i === 0 || solid(ring)));
    shape = polygons.length ? { type: 'MultiPolygon', coordinates: polygons } : null;
  }
  drawable.set(f, shape);
  return shape;
}

/**
 * Draws the world into an <svg> with the given projection.
 * `fill` returns a CSS fill (or null for default land colour) per country code.
 */
export function drawWorld(
  svg: SVGSVGElement,
  projection: GeoProjection,
  w: NonNullable<typeof world>,
  fill: (code: string) => string | null = () => null,
): { path: ReturnType<typeof geoPath>; layer: SVGGElement } {
  const path = geoPath(projection);
  svg.replaceChildren();
  const g = svgEl('g');
  const globe = !!(projection as unknown as { clipAngle?: () => number }).clipAngle?.();
  const sphere = globe ? (path({ type: 'Sphere' }) ?? '') : '';
  if (globe) g.append(svgEl('path', { d: sphere, class: 'sphere' }));
  for (const f of w.countries) {
    const shape = drawableShape(f);
    const d = shape && path(shape);
    // A country on the far side must project to nothing. If it comes back as the full disc, d3-geo
    // misjudged it (a rare rounding case); skip it instead of flooding the globe.
    if (!d || (globe && d === sphere)) continue;
    const p = svgEl('path', { d, class: 'land', 'data-code': f.id });
    const c = fill(f.id);
    if (c) p.style.fill = c;
    g.append(p);
  }
  g.append(svgEl('path', { d: path(w.borders) ?? '', class: 'borders' }));
  svg.append(g);
  const layer = svgEl('g');
  svg.append(layer);
  return { path, layer };
}

/** Distance-based colour ramp used by several modes: near = hot, far = cold. */
export function heat(km: number, maxKm = 5000): string {
  const t = Math.max(0, Math.min(1, km / maxKm));
  const hue = 8 + t * 42; // red -> amber
  const light = 45 + t * 40;
  return `hsl(${hue} 85% ${light}%)`;
}
