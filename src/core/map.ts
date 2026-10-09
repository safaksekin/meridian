import { geoPath, type GeoProjection, type GeoPermissibleObjects } from 'd3-geo';
import { feature, mesh } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry, MultiLineString } from 'geojson';
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
  if ((projection as unknown as { clipAngle?: () => number }).clipAngle?.()) {
    g.append(svgEl('path', { d: path({ type: 'Sphere' }) ?? '', class: 'sphere' }));
  }
  for (const f of w.countries) {
    const d = path(f as GeoPermissibleObjects);
    if (!d) continue;
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
