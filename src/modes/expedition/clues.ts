// Clue windows: each destination is shown only through one of these. Every window is centred on the
// destination; nothing in it is labelled.
import { geoAzimuthalEqualArea, geoPath, type GeoProjection } from 'd3-geo';
import { merge } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import type { MultiPolygon } from 'geojson';
import { h, svgEl } from '../../core/ui';
import { loadJSON } from '../../core/data';
import { flag } from '../../core/geo';
import { decodeGrid, type Grid } from '../headcount/pop.js';
import { drawView } from '../streets/draw';
import type { Puzzle as StreetPuzzle } from '../streets/logic';
import { WINDOW_KM, hhmm, sunDay, type Place } from './logic';

const SIZE = 400;
const R_KM = 6371.0088;

let landP: Promise<MultiPolygon> | null = null;
/** World land as one shape (country borders dissolved), from the shared display map. */
export function loadLand(): Promise<MultiPolygon> {
  landP ??= loadJSON<Topology<{ countries: GeometryCollection }>>('world.json').then(
    (topo) => merge(topo, topo.objects.countries.geometries as never) as MultiPolygon,
  );
  return landP;
}

let gridP: Promise<Grid> | null = null;
/** GHSL population grid shared with Headcount (gzip; some hosts decode it in transit). */
export function loadGrid(): Promise<Grid> {
  gridP ??= (async () => {
    const res = await fetch(new URL('data/headcount/grid.bin', document.baseURI).toString());
    if (!res.ok) throw new Error(`grid.bin: ${res.status}`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return decodeGrid(bytes);
  })();
  gridP.catch(() => (gridP = null));
  return gridP;
}

/** North-up azimuthal view of half-size `km`, centred on the place, filling a SIZE × SIZE square. */
function windowProjection(p: Place, km: number): GeoProjection {
  const theta = km / R_KM;
  return geoAzimuthalEqualArea()
    .rotate([-p.o, -p.a])
    .scale(SIZE / 2 / (2 * Math.sin(theta / 2)))
    .translate([SIZE / 2, SIZE / 2])
    .clipExtent([[0, 0], [SIZE, SIZE]])
    .precision(0.2);
}

/** A round-number scale bar about a quarter of the window wide. */
function scaleBar(km: number, fmt: (n: number) => string): SVGGElement {
  const pxPerKm = SIZE / 2 / km;
  const nice = [50, 100, 200, 250, 500, 1000].reduce((best, n) => (Math.abs(n * pxPerKm - 90) < Math.abs(best * pxPerKm - 90) ? n : best));
  const w = nice * pxPerKm;
  const g = svgEl('g', { class: 'ex-scale', transform: `translate(14 ${SIZE - 16})` });
  g.append(svgEl('path', { d: `M0 -5V0H${w}V-5` }));
  const tx = svgEl('text', { x: w + 6, y: 0 });
  tx.textContent = `${fmt(nice)} km`;
  g.append(tx);
  return g;
}

function crosshair(): SVGGElement {
  const c = SIZE / 2;
  const g = svgEl('g', { class: 'ex-cross' });
  g.append(svgEl('circle', { cx: c, cy: c, r: 9 }));
  g.append(svgEl('path', { d: `M${c} ${c - 22}V${c - 12}M${c} ${c + 12}V${c + 22}M${c - 22} ${c}H${c - 12}M${c + 12} ${c}H${c + 22}` }));
  return g;
}

export async function coastClue(p: Place, fmt: (n: number) => string): Promise<SVGSVGElement> {
  const km = WINDOW_KM.coast[p.t - 1];
  const land = await loadLand();
  const proj = windowProjection(p, km);
  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'ex-win ex-coast', role: 'img' });
  svg.append(svgEl('rect', { width: SIZE, height: SIZE, class: 'ex-sea' }));
  svg.append(svgEl('path', { d: geoPath(proj)(land) ?? '', class: 'ex-land' }));
  svg.append(crosshair(), scaleBar(km, fmt));
  return svg;
}

/** Population density around the place, one square per 0.25° GHSL cell, darker = more people. */
export async function popClue(p: Place, fmt: (n: number) => string): Promise<HTMLElement> {
  const km = WINDOW_KM.pop[p.t - 1];
  const [grid, land] = await Promise.all([loadGrid(), p.t < 3 ? loadLand() : Promise.resolve(null)]);
  const proj = windowProjection(p, km);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = h('canvas', { width: String(SIZE * dpr), height: String(SIZE * dpr), class: 'ex-win-canvas' });
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const ink = css.getPropertyValue('--heading').trim() || '#0b1b3a';
  const pxPerKm = SIZE / 2 / km;
  const dLat = (km * 1.5) / 111.2;
  const cosLat = Math.max(0.15, Math.cos((p.a * Math.PI) / 180));
  const dLon = Math.min(180, (km * 1.5) / (111.2 * cosLat));
  const r0 = Math.max(0, Math.floor((grid.lat0 - (p.a + dLat)) / grid.cell));
  const r1 = Math.min(grid.h - 1, Math.ceil((grid.lat0 - (p.a - dLat)) / grid.cell));
  ctx.fillStyle = ink;
  for (let r = r0; r <= r1; r++) {
    const lat = grid.lat0 - (r + 0.5) * grid.cell;
    const hpx = grid.cell * 111.2 * pxPerKm + 0.7;
    const wpx = grid.cell * 111.2 * Math.cos((lat * Math.PI) / 180) * pxPerKm + 0.7;
    for (let lo = p.o - dLon; lo <= p.o + dLon; lo += grid.cell) {
      let c = Math.floor((lo - grid.lon0) / grid.cell);
      c = ((c % grid.w) + grid.w) % grid.w;
      const v = grid.vals[r * grid.w + c];
      if (v < 200) continue;
      const lon = grid.lon0 + (c + 0.5) * grid.cell;
      const xy = proj([lon, lat]);
      if (!xy || xy[0] < -wpx || xy[0] > SIZE + wpx || xy[1] < -hpx || xy[1] > SIZE + hpx) continue;
      // log scale: 200 people → faint, 2 million+ → full ink
      ctx.globalAlpha = Math.min(1, Math.max(0.08, (Math.log10(v) - 2.3) / 4));
      ctx.fillRect(xy[0] - wpx / 2, xy[1] - hpx / 2, wpx, hpx);
    }
  }
  ctx.globalAlpha = 1;
  const box = h('div', { class: 'ex-win ex-pop', role: 'img' }, canvas);
  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'ex-win-over' });
  if (land) svg.append(svgEl('path', { d: geoPath(proj)(land) ?? '', class: 'ex-coastline' }));
  svg.append(crosshair(), scaleBar(km, fmt));
  box.append(svg);
  return box;
}

export function namesClue(p: Place): HTMLElement {
  const names = Array.isArray(p.x) ? p.x : [];
  return h('div', { class: 'ex-win ex-names' }, h('ul', { class: 'ex-signs' }, ...names.map((n) => h('li', { class: 'ex-sign' }, n))));
}

export async function streetsClue(p: Place): Promise<HTMLElement> {
  const puzzle = await loadJSON<StreetPuzzle>(`streets/p/${p.x}.json`);
  const view = p.t <= 2 ? drawView(puzzle.z, 'zoom', puzzle) : drawView(puzzle, 'crop', puzzle);
  return h('div', { class: 'ex-win ex-streets st-map' }, view.svg);
}

/** Daylight bar for the destination on `date` (UTC). */
export function sunClue(p: Place, date: Date, t: (k: string, v?: Record<string, string | number>) => string): HTMLElement {
  const s = sunDay(p.a, p.o, date);
  const bar = h('div', { class: 'ex-sunbar', 'aria-hidden': 'true' });
  const seg = (from: number, to: number) => bar.append(h('span', { class: 'ex-day', style: { left: `${(from / 24) * 100}%`, width: `${((to - from) / 24) * 100}%` } }));
  if (s.rise == null || s.set == null) {
    if (s.hours >= 24) seg(0, 24);
  } else if (s.rise < s.set) seg(s.rise, s.set);
  else {
    seg(0, s.set);
    seg(s.rise, 24);
  }
  bar.append(h('span', { class: 'ex-noon', style: { left: `${(s.noon / 24) * 100}%` } }));
  const ticks = h('div', { class: 'ex-sunticks', 'aria-hidden': 'true' }, ...[0, 6, 12, 18, 24].map((x) => h('span', {}, String(x).padStart(2, '0'))));
  const date8 = date.toISOString().slice(0, 10);
  const line =
    s.rise == null || s.set == null
      ? t(s.hours >= 24 ? 'sunPolarDay' : 'sunPolarNight')
      : t('sunLine', { rise: hhmm(s.rise), set: hhmm(s.set), len: `${Math.floor(s.hours)}:${String(Math.round((s.hours % 1) * 60) % 60).padStart(2, '0')}` });
  return h(
    'div',
    { class: 'ex-extra ex-sun' },
    h('p', { class: 'ex-extra-title' }, `☀️ ${t('sunTitle', { date: date8 })}`),
    bar,
    ticks,
    h('p', { class: 'ex-extra-text' }, line, ' ', h('span', { class: 'muted' }, t('sunNoon', { noon: hhmm(s.noon) }))),
  );
}

export function flagClue(p: Place, t: (k: string) => string): HTMLElement {
  return h('div', { class: 'ex-extra ex-flag' }, h('p', { class: 'ex-extra-title' }, t('flagTitle')), h('span', { class: 'ex-flag-emoji' }, flag(p.c)));
}
