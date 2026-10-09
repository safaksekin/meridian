import { geoArea, geoAzimuthalEqualArea, geoBounds, geoCentroid, geoPath } from 'd3-geo';
import type { GeometryCollection, MultiPolygon, Position } from 'geojson';
import { drawWorld, loadWorld } from '../../core/map';
import { svgEl } from '../../core/ui';
import type { HName } from './logic';

const W = 400;
const PAD = 18;

/** Small map of the target country with the six names as numbered dots. */
export async function revealMap(code: string, names: HName[]): Promise<SVGSVGElement> {
  const world = await loadWorld();
  const pts: Position[] = names.map((n) => [n.lon, n.lat]);
  const g = world.countries.find((c) => c.id === code)?.geometry;
  const polys: Position[][][] = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];

  // Keep the part of the country around the names (drops far-away overseas territories).
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const span = Math.max(Math.max(...lons) - Math.min(...lons), Math.max(...lats) - Math.min(...lats));
  const pad = Math.max(2, span * 0.25);
  const box = [Math.min(...lons) - pad, Math.min(...lats) - pad, Math.max(...lons) + pad, Math.max(...lats) + pad];
  let largest: Position[][] | null = null;
  let largestArea = -1;
  for (const p of polys) {
    const a = geoArea({ type: 'Polygon', coordinates: p });
    if (a > largestArea) (largestArea = a), (largest = p);
  }
  const kept = polys.filter((p) => {
    if (p === largest) return true;
    const [[x0, y0], [x1, y1]] = geoBounds({ type: 'Polygon', coordinates: p });
    if (x0 > x1) return true; // crosses the antimeridian: keep, cheap and rare
    return x1 >= box[0] && x0 <= box[2] && y1 >= box[1] && y0 <= box[3];
  });
  const shape: MultiPolygon = { type: 'MultiPolygon', coordinates: kept };
  const fit: GeometryCollection = { type: 'GeometryCollection', geometries: [shape, { type: 'MultiPoint', coordinates: pts }] };

  const center = kept.length ? geoCentroid(shape) : geoCentroid({ type: 'MultiPoint', coordinates: pts });
  const projection = geoAzimuthalEqualArea().rotate([-center[0], -center[1]]).clipAngle(90);
  projection.fitWidth(W - 2 * PAD, fit);
  const [[, by0], [, by1]] = geoPath(projection).bounds(fit);
  const H = Math.round(Math.min(380, Math.max(200, by1 - by0 + 2 * PAD)));
  projection.fitExtent(
    [
      [PAD, PAD],
      [W - PAD, H - PAD],
    ],
    fit,
  );

  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
  const { layer } = drawWorld(svg, projection, world, (c) => (c === code ? 'var(--hl-target)' : null));
  names.forEach((n, i) => {
    const xy = projection([n.lon, n.lat]);
    if (!xy) return;
    const grp = svgEl('g', { class: 'hl-dot', transform: `translate(${xy[0].toFixed(1)} ${xy[1].toFixed(1)})` });
    grp.append(svgEl('circle', { r: 8 }));
    const label = svgEl('text', { 'text-anchor': 'middle', dy: '0.35em' });
    label.textContent = String(i + 1);
    grp.append(label);
    layer.append(grp);
  });
  return svg;
}
