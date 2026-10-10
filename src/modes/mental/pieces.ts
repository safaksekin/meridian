import { geoArea, geoDistance, geoPath } from 'd3-geo';
import type { MultiPolygon, Position } from 'geojson';
import { drawableShape, type CountryFeature } from '../../core/map';
import type { Pt } from './fit';
import { EARTH_KM, pieceProjection, projectAll, setProjection } from './project';

/** A country's shape as the player moves it around: canvas units, relative to its scored point. */
export interface Piece {
  /** SVG path of the shape ('' when the map has no shape for it). */
  d: string;
  /** Box the label and the pointer work with: [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  /** Where the pointer holds it: the middle of the box. */
  hold: Pt;
  /** Too small to see or grab: gets a ring around it. */
  tiny: boolean;
  /** Drawing order: big pieces go under small ones. */
  size: number;
}

const GAP_KM = 900; // parts further than this from the rest are left out (Hawaii, French Guiana, ...)
const FILL = 0.84; // share of the canvas the true layout takes
export const TINY = 44; // canvas units
export const RING = 20; // radius of a tiny piece's ring

/** The polygons that make up the country as people picture it: the largest part and whatever lies near it. */
function mainParts(polys: Position[][][]): Position[][][] {
  if (polys.length < 2) return polys;
  const sample = polys.map((p) => p[0].filter((_, i) => i % Math.ceil(p[0].length / 16) === 0) as [number, number][]);
  const area = polys.map((p) => geoArea({ type: 'Polygon', coordinates: p }));
  const near = (a: number, b: number) => sample[a].some((p) => sample[b].some((q) => geoDistance(p, q) * EARTH_KM < GAP_KM));
  const kept = new Set([area.indexOf(Math.max(...area))]);
  let fresh = [...kept];
  while (fresh.length) {
    const next: number[] = [];
    polys.forEach((_, i) => {
      if (!kept.has(i) && fresh.some((k) => near(i, k))) {
        kept.add(i);
        next.push(i);
      }
    });
    fresh = next;
  }
  return polys.filter((_, i) => kept.has(i));
}

/**
 * Pieces for a set, all at one scale: the one at which the true layout takes most of the canvas.
 * A piece that sprawls far past the others (Russia in a Europe set) does not shrink the rest.
 */
export function makePieces(
  codes: string[],
  places: { lat: number; lon: number }[],
  world: boolean,
  features: CountryFeature[],
  size: number,
): Map<string, Piece> {
  const truth = projectAll(setProjection(places, world), places);
  const span = Math.max(1, Math.max(...truth.map((p) => p[0])) - Math.min(...truth.map((p) => p[0])), Math.max(...truth.map((p) => p[1])) - Math.min(...truth.map((p) => p[1])));
  const reach = span / 2; // km: how far a piece's box may run from its point

  const raw = codes.map((code, i) => {
    const f = features.find((c) => c.id === code);
    const shape = f && (drawableShape(f) as MultiPolygon | null);
    const geo: MultiPolygon | null = shape ? { type: 'MultiPolygon', coordinates: mainParts(shape.coordinates) } : null;
    const proj = pieceProjection(places, places[i], world);
    const at = proj([places[i].lon, places[i].lat]) as Pt;
    let box: [number, number, number, number] = [0, 0, 0, 0];
    if (geo) {
      const [[x0, y0], [x1, y1]] = geoPath(proj).bounds(geo);
      const cut = (v: number) => Math.max(-reach, Math.min(reach, v));
      box = [cut(x0 - at[0]), cut(y0 - at[1]), cut(x1 - at[0]), cut(y1 - at[1])];
    }
    return { code, geo, proj, box, place: places[i], truth: truth[i] };
  });

  const w = Math.max(...raw.map((r) => r.truth[0] + r.box[2])) - Math.min(...raw.map((r) => r.truth[0] + r.box[0]));
  const h = Math.max(...raw.map((r) => r.truth[1] + r.box[3])) - Math.min(...raw.map((r) => r.truth[1] + r.box[1]));
  const k = (FILL * size) / Math.max(w, h, 1); // canvas units per km

  const out = new Map<string, Piece>();
  for (const r of raw) {
    let d = '';
    if (r.geo) {
      r.proj.scale(EARTH_KM * k).precision(0.3);
      const at = r.proj([r.place.lon, r.place.lat]) as Pt;
      r.proj.translate([-at[0], -at[1]]);
      d = geoPath(r.proj).digits(1)(r.geo) ?? '';
    }
    let box = r.box.map((v) => v * k) as [number, number, number, number];
    const tiny = Math.max(box[2] - box[0], box[3] - box[1]) < TINY;
    if (tiny) {
      const cx = (box[0] + box[2]) / 2, cy = (box[1] + box[3]) / 2;
      box = [cx - RING, cy - RING, cx + RING, cy + RING];
    }
    out.set(r.code, { d, box, hold: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], tiny, size: (box[2] - box[0]) * (box[3] - box[1]) });
  }
  return out;
}
