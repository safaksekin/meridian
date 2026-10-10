// Live, spoiler-free previews of today's puzzle for each home card ("Editorial Cartography").
// Every preview is a dark navy chart panel (viewBox 0 0 320 200) drawn from the same data files
// the mode itself loads (through the loadJSON cache), so opening the game afterwards is instant.
// Nothing here may reveal an answer: only what the game shows on its first screen, or less.
import './previews.css';
import { geoGraticule10, geoOrthographic, geoPath, type GeoPermissibleObjects } from 'd3-geo';
import { loadJSON } from '../core/data';
import { mulberry32, puzzleIndex } from '../core/daily';
import { loadWorld } from '../core/map';
import { flag, haversineKm } from '../core/geo';
import { svgEl } from '../core/ui';
import { coverScale, type PuzzleMeta as StreetMeta } from '../modes/streets/logic';
import { decodeGrid, type Grid } from '../modes/headcount/pop.js';

const W = 320;
const H = 200;
const D2R = Math.PI / 180;
let uid = 0;

type Pt = [number, number];
type Box = [number, number, number, number];
type Attrs = Record<string, string | number>;

// ------------------------------------------------------------------ small helpers

const f1 = (n: number): string => String(Math.round(n * 10) / 10);

function add<K extends keyof SVGElementTagNameMap>(parent: Element, tag: K, attrs: Attrs = {}, text?: string): SVGElementTagNameMap[K] {
  const e = svgEl(tag, attrs);
  if (text != null) e.textContent = text;
  parent.append(e);
  return e;
}

/** Day-seeded PRNG, decorrelated per mode so two cards never share a layout. */
function rng(day: number, salt: number): () => number {
  return mulberry32(Math.imul(day + 1, 0x9e3779b1) ^ salt);
}

/**
 * Path-data collector usable as a d3-geo context. Rounds to 0.1 px and drops vertices closer than
 * `minD` px to the previous one, which keeps the DOM light without visible loss at thumbnail size.
 */
class PathBuf {
  private out: string[] = [];
  private ring = '';
  private n = 0;
  private closed = false;
  private lx = 0;
  private ly = 0;
  private px = NaN;
  private py = NaN;
  private min2: number;
  constructor(minD = 0.6) {
    this.min2 = minD * minD;
  }
  moveTo(x: number, y: number): void {
    this.commit();
    this.ring = `M${f1(x)} ${f1(y)}`;
    this.n = 1;
    this.lx = x;
    this.ly = y;
  }
  lineTo(x: number, y: number): void {
    if (!this.n) return this.moveTo(x, y);
    const dx = x - this.lx;
    const dy = y - this.ly;
    if (dx * dx + dy * dy < this.min2) {
      this.px = x;
      this.py = y;
      return;
    }
    this.ring += `L${f1(x)} ${f1(y)}`;
    this.n++;
    this.lx = x;
    this.ly = y;
    this.px = NaN;
  }
  closePath(): void {
    this.closed = true;
    this.commit();
  }
  beginPath(): void {
    /* one path string per buffer */
  }
  arc(): void {
    /* points are never drawn through this context */
  }
  private commit(): void {
    if (this.n) {
      if (!this.closed && !Number.isNaN(this.px)) {
        this.ring += `L${f1(this.px)} ${f1(this.py)}`;
        this.n++;
      }
      if (this.n >= (this.closed ? 3 : 2)) this.out.push(this.ring + (this.closed ? 'Z' : ''));
    }
    this.ring = '';
    this.n = 0;
    this.closed = false;
    this.px = NaN;
  }
  toString(): string {
    this.commit();
    return this.out.join('');
  }
}

/** Both ends beyond the same edge of the box: the segment cannot be visible. */
function rejected(a: Pt, b: Pt, box: Box): boolean {
  return (a[0] < box[0] && b[0] < box[0]) || (a[0] > box[2] && b[0] > box[2]) || (a[1] < box[1] && b[1] < box[1]) || (a[1] > box[3] && b[1] > box[3]);
}

/** Delta-encoded polylines [x0, y0, dx1, dy1, ...] (streets and tripoint share the format) into a PathBuf. */
function addLines(buf: PathBuf, lines: number[][], tx: (x: number, y: number) => Pt, box: Box): void {
  for (const l of lines) {
    if (!Array.isArray(l)) continue;
    let x = 0;
    let y = 0;
    let prev: Pt | null = null;
    let pen = false;
    for (let i = 0; i + 1 < l.length; i += 2) {
      x += l[i];
      y += l[i + 1];
      const q = tx(x, y);
      if (prev) {
        if (rejected(prev, q, box)) pen = false;
        else {
          if (!pen) buf.moveTo(prev[0], prev[1]);
          pen = true;
          buf.lineTo(q[0], q[1]);
        }
      }
      prev = q;
    }
  }
}

// ------------------------------------------------------------------ the chart panel

function baseSvg(id: string): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${W} ${H}`,
    class: `pv pv-${id}`,
    preserveAspectRatio: 'xMidYMid slice',
    'aria-hidden': 'true',
    focusable: 'false',
  });
  add(svg, 'rect', { width: W, height: H, class: 'pv-bg' });
  return svg;
}

/** Fine coordinate grid: minor lines every `step` px, major every 4 steps. */
function coordGrid(svg: SVGSVGElement, step = 20): void {
  let minor = '';
  let major = '';
  for (let x = step, i = 1; x < W; x += step, i++) (i % 4 ? (s: string) => (minor += s) : (s: string) => (major += s))(`M${x} 0V${H}`);
  for (let y = step, i = 1; y < H; y += step, i++) (i % 4 ? (s: string) => (minor += s) : (s: string) => (major += s))(`M0 ${y}H${W}`);
  add(svg, 'path', { d: minor, class: 'pv-grid' });
  add(svg, 'path', { d: major, class: 'pv-grid pv-grid-major' });
}

/** Inset neatline with graduation ticks, like the border of a printed chart. */
function neatline(svg: SVGSVGElement): void {
  const m = 7;
  add(svg, 'rect', { x: m, y: m, width: W - 2 * m, height: H - 2 * m, class: 'pv-neat' });
  let d = '';
  for (let x = m + 10; x < W - m; x += 10) {
    const len = (x - m) % 50 === 0 ? 4 : 2;
    d += `M${x} ${m}v${len}M${x} ${H - m}v${-len}`;
  }
  for (let y = m + 10; y < H - m; y += 10) {
    const len = (y - m) % 50 === 0 ? 4 : 2;
    d += `M${m} ${y}h${len}M${W - m} ${y}h${-len}`;
  }
  add(svg, 'path', { d, class: 'pv-ticks' });
}

// ------------------------------------------------------------------ beeline

interface BeelinePuzzle { city: string; cc: string; lat: number; lon: number; b: number }

/** Point `km` along the great circle leaving (lat, lon) with initial bearing `b`. */
function destination(lat: number, lon: number, b: number, km: number): Pt {
  const d = km / 6371.0088;
  const p1 = lat * D2R;
  const t = b * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = lon * D2R + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 / D2R + 540) % 360) - 180, p2 / D2R];
}

async function beeline(svg: SVGSVGElement, day: number): Promise<void> {
  const [puzzles, world] = await Promise.all([loadJSON<BeelinePuzzle[]>('beeline/puzzles.json'), loadWorld()]);
  const p = puzzles[puzzleIndex(day, puzzles.length)];
  if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.b)) throw new Error('beeline: bad puzzle');

  const R = 172;
  // Shift the start a little against the heading so pin + arrow sit in the optical centre.
  const sx = 160 - 16 * Math.sin(p.b * D2R);
  const sy = 104 + 12 * Math.cos(p.b * D2R);
  const proj = geoOrthographic()
    .scale(R)
    .translate([sx, sy])
    .rotate([-p.lon, -p.lat])
    .clipAngle(90)
    .clipExtent([[-2, -2], [W + 2, H + 2]])
    .precision(0.6);
  const draw = (obj: GeoPermissibleObjects, minD: number): string => {
    const b = new PathBuf(minD);
    geoPath(proj, b)(obj);
    return b.toString();
  };

  const gid = `pv-g${++uid}`;
  const defs = add(svg, 'defs');
  const grad = add(defs, 'radialGradient', { id: gid, cx: f1(sx - R * 0.3), cy: f1(sy - R * 0.35), r: R * 1.25, gradientUnits: 'userSpaceOnUse' });
  add(grad, 'stop', { offset: 0, class: 'pv-sphere-hi' });
  add(grad, 'stop', { offset: 1, class: 'pv-sphere-lo' });

  // Stars of a chart: the faint coordinate grid shows in the corners outside the limb.
  coordGrid(svg);
  add(svg, 'path', { d: draw({ type: 'Sphere' }, 0.5), class: 'pv-sphere', fill: `url(#${gid})` });
  add(svg, 'path', { d: draw(geoGraticule10(), 0.8), class: 'pv-grat' });
  add(svg, 'path', { d: draw({ type: 'FeatureCollection', features: world.countries } as GeoPermissibleObjects, 0.7), class: 'pv-land' });
  add(svg, 'path', { d: draw(world.borders, 0.8), class: 'pv-borders' });
  add(svg, 'path', { d: draw({ type: 'Sphere' }, 0.5), class: 'pv-limb' });

  // Compass bezel around the start: ticks every 15°, cardinals longer.
  const c = proj([p.lon, p.lat]) ?? [sx, sy];
  const [cx, cy] = c;
  const g = add(svg, 'g', { transform: `translate(${f1(cx)} ${f1(cy)})` });
  let ticks = '';
  for (let a = 0; a < 360; a += 15) {
    const r0 = a % 90 === 0 ? 22 : 25;
    const s = Math.sin(a * D2R);
    const k = -Math.cos(a * D2R);
    ticks += `M${f1(r0 * s)} ${f1(r0 * k)}L${f1(28 * s)} ${f1(28 * k)}`;
  }
  add(g, 'circle', { r: 28, class: 'pv-bezel' });
  add(g, 'path', { d: ticks, class: 'pv-bezel-ticks' });
  add(g, 'path', { d: 'M0 -31L-2.2 -35.5H2.2Z', class: 'pv-north' });

  // Opening hint: the first ~600 km of the heading, nothing more.
  const end = proj(destination(p.lat, p.lon, p.b, 600));
  if (end) {
    const dx = end[0] - cx;
    const dy = end[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const tip: Pt = [cx + ux * Math.max(len, 18), cy + uy * Math.max(len, 18)];
    add(svg, 'path', { d: `M${f1(cx + ux * 5)} ${f1(cy + uy * 5)}L${f1(tip[0] - ux * 4)} ${f1(tip[1] - uy * 4)}`, class: 'pv-route' });
    const hx = tip[0];
    const hy = tip[1];
    add(svg, 'path', {
      d: `M${f1(hx + ux * 3)} ${f1(hy + uy * 3)}L${f1(hx - ux * 5 - uy * 3.6)} ${f1(hy - uy * 5 + ux * 3.6)}L${f1(hx - ux * 3)} ${f1(hy - uy * 3)}L${f1(hx - ux * 5 + uy * 3.6)} ${f1(hy - uy * 5 - ux * 3.6)}Z`,
      class: 'pv-arrowhead',
    });
  }
  add(svg, 'circle', { cx: f1(cx), cy: f1(cy), r: 7.5, class: 'pv-pin-halo' });
  add(svg, 'circle', { cx: f1(cx), cy: f1(cy), r: 3.2, class: 'pv-pin' });
}

// ------------------------------------------------------------------ streets

interface StreetCrop { s: number; m: number[][]; r: number[][] }

async function streets(svg: SVGSVGElement, day: number): Promise<void> {
  const index = await loadJSON<StreetMeta[]>('streets/index.json');
  const meta = index[puzzleIndex(day, index.length)];
  if (!meta) throw new Error('streets: no puzzle');
  const p = await loadJSON<StreetCrop>(`streets/p/${meta.id}.json`);
  if (!p || !(p.s > 0) || !Array.isArray(p.r) || !Array.isArray(p.m)) throw new Error('streets: bad crop');

  // Same as the game's first view: rotate(rot) scale(coverScale(rot)) about the crop centre,
  // with the square crop spanning the full card width (the 200 px band is its middle).
  const rot = Number.isFinite(meta.rot) ? meta.rot : 0;
  const k = (W / (2 * p.s)) * coverScale(rot);
  const cos = Math.cos(rot * D2R);
  const sin = Math.sin(rot * D2R);
  const tx = (x: number, y: number): Pt => [160 + k * (x * cos - y * sin), 100 + k * (x * sin + y * cos)];
  const box: Box = [-2, -2, W + 2, H + 2];

  let minor = '';
  let major = '';
  // Dense cities: loosen the vertex filter until the DOM stays light.
  for (const minD of [0.7, 1.1, 1.6, 2.4]) {
    const a = new PathBuf(minD);
    addLines(a, p.r, tx, box);
    const b = new PathBuf(minD);
    addLines(b, p.m, tx, box);
    minor = a.toString();
    major = b.toString();
    if (minor.length + major.length < 56000) break;
  }

  const cid = `pv-c${++uid}`;
  const defs = add(svg, 'defs');
  add(add(defs, 'clipPath', { id: cid }), 'rect', { width: W, height: H });
  coordGrid(svg);
  const g = add(svg, 'g', { 'clip-path': `url(#${cid})` });
  add(g, 'path', { d: minor, class: 'pv-street' });
  add(g, 'path', { d: major, class: 'pv-street pv-street-major' });
  // A surveyor's reticle on the crop centre.
  const r = add(svg, 'g', { class: 'pv-reticle', transform: 'translate(160 100)' });
  add(r, 'circle', { r: 9 });
  add(r, 'path', { d: 'M0 -15V-5M0 5V15M-15 0H-5M5 0H15' });
  add(svg, 'circle', { cx: 160, cy: 100, r: 1.6, class: 'pv-dot-gold' });
}

// ------------------------------------------------------------------ mental

interface MentalSet { region: string; codes: string[] }

async function mental(svg: SVGSVGElement, day: number): Promise<void> {
  const sets = await loadJSON<MentalSet[]>('mental/sets.json');
  const set = sets[puzzleIndex(day, sets.length)];
  if (!set || !Array.isArray(set.codes) || !set.codes.length) throw new Error('mental: bad set');

  // The blank canvas: a paper sheet with a fine grid and registration marks.
  const x0 = 22;
  const y0 = 18;
  const x1 = W - 22;
  const y1 = H - 18;
  add(svg, 'rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, rx: 3, class: 'pv-sheet' });
  let fine = '';
  let bold = '';
  for (let x = x0 + 9.2, i = 1; x < x1 - 1; x += 9.2, i++) (i % 5 ? (fine += `M${f1(x)} ${y0}V${y1}`) : (bold += `M${f1(x)} ${y0}V${y1}`));
  for (let y = y0 + 9.1, i = 1; y < y1 - 1; y += 9.1, i++) (i % 5 ? (fine += `M${x0} ${f1(y)}H${x1}`) : (bold += `M${x0} ${f1(y)}H${x1}`));
  add(svg, 'path', { d: fine, class: 'pv-grid' });
  add(svg, 'path', { d: bold, class: 'pv-grid pv-grid-major' });
  let reg = '';
  for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
    reg += `M${x - sx * 8} ${y}h${sx * 16}M${x} ${y - sy * 8}v${sy * 16}`;
  }
  add(svg, 'path', { d: reg, class: 'pv-reg' });

  // Seven pins at seeded positions: they say nothing about where the countries really are.
  const rand = rng(day, 0x4d454e54);
  const pts: Pt[] = [];
  const codes = set.codes.slice(0, 7);
  // Keep pins (and their flag labels) inside the centre 200 × 200 so square phone cards, which crop
  // the 320 × 200 panel to its middle, never cut them off.
  const sx0 = 78;
  const sx1 = 222;
  const pick = (): Pt => [sx0 + rand() * (sx1 - sx0), y0 + 18 + rand() * (y1 - y0 - 36)];
  let minD = 38;
  for (let i = 0; i < codes.length; i++) {
    let best: Pt = pick();
    for (let tries = 0; tries < 60; tries++) {
      const q: Pt = pick();
      if (pts.every((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) >= minD)) {
        best = q;
        break;
      }
      if (tries === 59) minD *= 0.85;
    }
    pts.push(best);
  }
  pts.forEach(([x, y], i) => {
    add(svg, 'circle', { cx: f1(x), cy: f1(y), r: 6.5, class: 'pv-pin-halo' });
    add(svg, 'circle', { cx: f1(x), cy: f1(y), r: 2.8, class: 'pv-pin' });
    const left = x > sx1 - 30;
    add(svg, 'text', { x: f1(left ? x - 9 : x + 9), y: f1(y + 4.5), class: 'pv-flag', 'text-anchor': left ? 'end' : 'start' }, flag(codes[i]));
  });
}

// ------------------------------------------------------------------ headcount

interface HeadcountDoc { puzzles: { r: number; t: number; p: { lat: number; lon: number }[] }[] }

const HC_COLS = 128;
const HC_ROWS = 80;
const HC_TOP = 78;
const HC_BOT = -58;
let binsP: Promise<Float32Array> | null = null;

/** Same loader as the mode (gzip sniffing), binned once into a coarse dot-matrix and cached. */
function popBins(): Promise<Float32Array> {
  binsP ??= (async () => {
    const res = await fetch(new URL('data/headcount/grid.bin', document.baseURI).toString());
    if (!res.ok) throw new Error(`grid.bin: ${res.status}`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    await new Promise((r) => setTimeout(r, 0)); // let the page breathe between download and decode
    const g: Grid = decodeGrid(bytes);
    const bins = new Float32Array(HC_COLS * HC_ROWS);
    const colBin = new Int16Array(g.w);
    for (let c = 0; c < g.w; c++) {
      const lon = g.lon0 + (c + 0.5) * g.cell;
      colBin[c] = Math.min(HC_COLS - 1, Math.max(0, Math.floor((((lon + 540) % 360) / 360) * HC_COLS)));
    }
    for (let r = 0; r < g.h; r++) {
      const lat = g.lat0 - (r + 0.5) * g.cell;
      if (lat >= HC_TOP || lat <= HC_BOT) continue;
      const base = Math.floor(((HC_TOP - lat) / (HC_TOP - HC_BOT)) * HC_ROWS) * HC_COLS;
      const off = r * g.w;
      for (let c = 0; c < g.w; c++) {
        const v = g.vals[off + c];
        if (v) bins[base + colBin[c]] += v;
      }
    }
    return bins;
  })();
  binsP.catch(() => (binsP = null));
  return binsP;
}

async function headcount(svg: SVGSVGElement, day: number): Promise<void> {
  const [doc, bins] = await Promise.all([loadJSON<HeadcountDoc>('headcount/puzzles.json'), popBins()]);
  const pz = doc.puzzles[puzzleIndex(day, doc.puzzles.length)];
  if (!pz) throw new Error('headcount: no puzzle');

  const sx = W / HC_COLS;
  const sy = H / HC_ROWS;
  const proj = (lat: number, lon: number): Pt => [((lon + 180) / 360) * W, ((HC_TOP - lat) / (HC_TOP - HC_BOT)) * H];

  // Dot-matrix sea: a pattern of faint dots, one per bin.
  const pid = `pv-p${++uid}`;
  const defs = add(svg, 'defs');
  const pat = add(defs, 'pattern', { id: pid, width: sx, height: sy, patternUnits: 'userSpaceOnUse' });
  add(pat, 'circle', { cx: sx / 2, cy: sy / 2, r: 0.45, class: 'pv-seadot' });
  add(svg, 'rect', { width: W, height: H, fill: `url(#${pid})` });
  // Equator, tropics, prime meridian: hairlines in the background.
  let lines = '';
  for (const lat of [0, 23.44, -23.44, 66.56]) lines += `M0 ${f1(proj(lat, 0)[1])}H${W}`;
  for (let lon = -150; lon <= 150; lon += 30) lines += `M${f1(proj(0, lon)[0])} 0V${H}`;
  add(svg, 'path', { d: lines, class: 'pv-grid' });

  // People per bin -> five dot weights. Thresholds on the bin total (a bin is ~2.8° × 1.7°).
  const LEVELS = [2e4, 3e5, 2e6, 8e6, 2.5e7];
  const d = ['', '', '', '', ''];
  for (let r = 0; r < HC_ROWS; r++) {
    for (let c = 0; c < HC_COLS; c++) {
      const v = bins[r * HC_COLS + c];
      if (v < LEVELS[0]) continue;
      let lv = 0;
      while (lv < 4 && v >= LEVELS[lv + 1]) lv++;
      d[lv] += `M${f1((c + 0.5) * sx)} ${f1((r + 0.5) * sy)}h0`;
    }
  }
  d.forEach((dd, i) => add(svg, 'path', { d: dd, class: `pv-pop pv-pop${i}` }));

  // A neutral sample circle: far out at sea, as far as possible from every perfect circle.
  const spots: Pt[] = [[-30, -18], [-34, 78], [12, -142], [33, -42], [-24, -112], [22, 162], [-10, -125], [44, -150]];
  const far = spots.map((s) => Math.min(...(pz.p ?? []).map((q) => haversineKm(s[0], s[1], q.lat, q.lon)), 1e9));
  const okIdx = spots.map((_, i) => i).filter((i) => far[i] > 3500);
  const pickFrom = okIdx.length ? okIdx : [far.indexOf(Math.max(...far))];
  const spot = spots[pickFrom[Math.floor(rng(day, 0x48434e54)() * pickFrom.length)]];
  const [cx, cy] = proj(spot[0], spot[1]);
  const R = 17;
  const g = add(svg, 'g', { transform: `translate(${f1(cx)} ${f1(cy)})` });
  add(g, 'circle', { r: R, class: 'pv-lens' });
  add(g, 'circle', { r: R, class: 'pv-lens-ring' });
  add(g, 'path', { d: `M0 0L${f1(R * 0.71)} ${f1(-R * 0.71)}`, class: 'pv-lens-radius' });
  add(g, 'path', { d: 'M-3 0H3M0 -3V3', class: 'pv-lens-cross' });
}

// ------------------------------------------------------------------ hinterland

interface HinterlandPuzzle { country: string; names: { n: string }[] }

/** Wobbly closed ring for contour lines. */
function blob(cx: number, cy: number, r: number, ph: number[], sq: number): string {
  let d = '';
  const N = 56;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const k = 1 + 0.16 * Math.sin(2 * a + ph[0]) + 0.09 * Math.sin(3 * a + ph[1]) + 0.05 * Math.sin(5 * a + ph[2]);
    d += `${i ? 'L' : 'M'}${f1(cx + Math.cos(a) * r * k)} ${f1(cy + Math.sin(a) * r * k * sq)}`;
  }
  return d + 'Z';
}

const HOUSE = 'M-4 1V-3L0 -6.5L4 -3V1ZM-1.2 1V-1.6H1.2V1';

async function hinterland(svg: SVGSVGElement, day: number): Promise<void> {
  const puzzles = await loadJSON<HinterlandPuzzle[]>('hinterland/puzzles.json');
  const pz = puzzles[puzzleIndex(day, puzzles.length)];
  const name = pz?.names?.[0]?.n;
  if (!name || typeof name !== 'string') throw new Error('hinterland: no clue');
  const rand = rng(day, 0x48494e54);

  coordGrid(svg, 20);
  // Contour hills drifting off the edges.
  let contours = '';
  let index = '';
  const hills: Pt[] = [
    [30 + rand() * 60, 20 + rand() * 40],
    [230 + rand() * 70, 150 + rand() * 40],
    [200 + rand() * 60, -10 + rand() * 30],
  ];
  hills.forEach(([hx, hy], hi) => {
    const ph = [rand() * 6.3, rand() * 6.3, rand() * 6.3];
    const sq = 0.7 + rand() * 0.3;
    const rings = hi === 2 ? 4 : 6;
    for (let i = 1; i <= rings; i++) {
      const ring = blob(hx + i * 1.5, hy - i, 9 * i + rand() * 3, ph.map((p) => p + i * 0.12), sq);
      if (i === 3) index += ring;
      else contours += ring;
    }
  });
  add(svg, 'path', { d: contours, class: 'pv-contour' });
  add(svg, 'path', { d: index, class: 'pv-contour pv-contour-index' });

  // A few hamlets and the lanes between them, kept clear of the title band.
  const houses: Pt[] = [];
  for (let i = 0; i < 40 && houses.length < 7; i++) {
    const q: Pt = [24 + rand() * 272, 20 + rand() * 160];
    if (q[1] > 58 && q[1] < 146) continue;
    if (q[0] > 236 && q[1] < 80) continue; // stamp corner
    if (houses.some((o) => Math.hypot(o[0] - q[0], o[1] - q[1]) < 30)) continue;
    houses.push(q);
  }
  let lanes = '';
  for (let i = 1; i < houses.length; i++) {
    const [ax, ay] = houses[i - 1];
    const [bx, by] = houses[i];
    if (Math.hypot(ax - bx, ay - by) > 120 || ay < 100 !== by < 100) continue;
    lanes += `M${f1(ax)} ${f1(ay)}Q${f1((ax + bx) / 2 + (rand() - 0.5) * 30)} ${f1((ay + by) / 2 + (rand() - 0.5) * 30)} ${f1(bx)} ${f1(by)}`;
  }
  add(svg, 'path', { d: lanes, class: 'pv-lane' });
  for (const [x, y] of houses) add(svg, 'path', { d: HOUSE, transform: `translate(${f1(x)} ${f1(y)})`, class: 'pv-house' });

  // The first clue, typeset like a place name on a printed map.
  const len = [...name].length;
  const size = Math.max(16, Math.min(44, 262 / (0.62 * Math.max(4, len))));
  const estW = Math.min(272, 0.6 * size * len);
  add(svg, 'text', { x: 160, y: f1(104 + size * 0.34), class: 'pv-name', 'font-size': f1(size), 'text-anchor': 'middle' }, name);
  const ry = f1(104 + size * 0.34 + 13);
  add(svg, 'path', { d: `M${f1(160 - estW / 2)} ${ry}H${f1(160 + estW / 2)}`, class: 'pv-rule' });
  add(svg, 'circle', { cx: f1(160 - estW / 2), cy: ry, r: 1.4, class: 'pv-dot-gold' });
  add(svg, 'circle', { cx: f1(160 + estW / 2), cy: ry, r: 1.4, class: 'pv-dot-gold' });

  // "Where is this?" stamp.
  const st = add(svg, 'g', { transform: `translate(266 44) rotate(${f1(-8 - rand() * 10)})`, class: 'pv-stamp' });
  add(st, 'circle', { r: 21, class: 'pv-stamp-outer' });
  add(st, 'circle', { r: 16.5, class: 'pv-stamp-inner' });
  add(st, 'text', { y: 8, 'text-anchor': 'middle', class: 'pv-stamp-q' }, '?');
}

// ------------------------------------------------------------------ tripoint

interface TripointPuzzle { unit: number; b: number[][] }

async function tripoint(svg: SVGSVGElement, day: number): Promise<void> {
  const index = await loadJSON<{ count: number }>('tripoint/index.json');
  if (!(index?.count > 0)) throw new Error('tripoint: bad index');
  const P = await loadJSON<TripointPuzzle>(`tripoint/p/${puzzleIndex(day, index.count)}.json`);
  if (!P || !Array.isArray(P.b) || !(P.unit > 0)) throw new Error('tripoint: bad puzzle');

  const cx = 160;
  const cy = 100;
  const R = 84;
  const NEAR_KM = 150; // the game's opening radius
  const s = R / (NEAR_KM / P.unit);
  const tx = (x: number, y: number): Pt => [cx + x * s, cy + y * s];
  const box: Box = [cx - R - 2, cy - R - 2, cx + R + 2, cy + R + 2];
  const buf = new PathBuf(0.6);
  addLines(buf, P.b, tx, box);

  coordGrid(svg);
  const cid = `pv-c${++uid}`;
  const defs = add(svg, 'defs');
  add(add(defs, 'clipPath', { id: cid }), 'circle', { cx, cy, r: R });
  add(svg, 'circle', { cx, cy, r: R, class: 'pv-disc' });
  // Range rings at 50 and 100 km.
  add(svg, 'circle', { cx, cy, r: f1(R / 3), class: 'pv-range' });
  add(svg, 'circle', { cx, cy, r: f1((2 * R) / 3), class: 'pv-range' });
  add(svg, 'path', { d: `M${cx - R} ${cy}H${cx + R}M${cx} ${cy - R}V${cy + R}`, class: 'pv-range' });
  const g = add(svg, 'g', { 'clip-path': `url(#${cid})` });
  add(g, 'path', { d: buf.toString(), class: 'pv-border' });
  // Bezel: degree ticks around the ring.
  let ticks = '';
  for (let a = 0; a < 360; a += 5) {
    const r1 = R + (a % 30 === 0 ? 6 : a % 15 === 0 ? 4 : 2.2);
    const sn = Math.sin(a * D2R);
    const cs = -Math.cos(a * D2R);
    ticks += `M${f1(cx + R * sn)} ${f1(cy + R * cs)}L${f1(cx + r1 * sn)} ${f1(cy + r1 * cs)}`;
  }
  add(svg, 'circle', { cx, cy, r: R, class: 'pv-ring' });
  add(svg, 'path', { d: ticks, class: 'pv-bezel-ticks' });
  add(svg, 'path', { d: `M${cx} ${cy - R - 9}l-2.6 -5h5.2z`, class: 'pv-north' });
  // Gold centre ring: the tripoint itself.
  add(svg, 'circle', { cx, cy, r: 6, class: 'pv-centre-ring' });
  add(svg, 'path', { d: `M${cx} ${cy - 13}V${cy - 8.5}M${cx} ${cy + 8.5}V${cy + 13}M${cx - 13} ${cy}H${cx - 8.5}M${cx + 8.5} ${cy}H${cx + 13}`, class: 'pv-centre-ticks' });
  add(svg, 'circle', { cx, cy, r: 1.6, class: 'pv-dot-gold' });
}

// ------------------------------------------------------------------ fallback

const GLYPHS: Record<string, string> = {
  beeline: 'M-26 0A26 26 0 1 0 26 0A26 26 0 1 0 -26 0M-26 0Q0 -12 26 0M0 -26Q-12 0 0 26',
  streets: 'M-24 -16H24M-24 0H24M-24 16H24M-16 -24V24M0 -24V24M16 -24V24',
  mental: 'M-20 -12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M14 -16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M2 16m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0',
  headcount: 'M-24 0A24 24 0 1 0 24 0A24 24 0 1 0 -24 0M-6 -4h0M4 6h0M8 -8h0M-10 8h0',
  hinterland: 'M-16 10V-6L0 -20L16 -6V10ZM-5 10V0H5V10',
  tripoint: 'M0 0L0 -26M0 0L22 14M0 0L-22 14M-6 0A6 6 0 1 0 6 0A6 6 0 1 0 -6 0',
};

function fallback(svg: SVGSVGElement, id: string): SVGSVGElement {
  svg.replaceChildren();
  add(svg, 'rect', { width: W, height: H, class: 'pv-bg' });
  coordGrid(svg);
  neatline(svg);
  const g = add(svg, 'g', { transform: 'translate(160 100)' });
  add(g, 'circle', { r: 44, class: 'pv-range' });
  add(g, 'path', { d: GLYPHS[id] ?? 'M0 -24L5 -5L24 0L5 5L0 24L-5 5L-24 0L-5 -5Z', class: 'pv-glyph' });
  return svg;
}

// ------------------------------------------------------------------ entry point

const DRAW: Record<string, (svg: SVGSVGElement, day: number) => Promise<void>> = {
  beeline,
  streets,
  mental,
  headcount,
  hinterland,
  tripoint,
};

/** Returns an <svg> (viewBox 0 0 320 200) for mode `id` on puzzle day `day`. Never reveals answers, never throws. */
export async function preview(id: string, day: number): Promise<SVGSVGElement> {
  const svg = baseSvg(id);
  const draw = DRAW[id];
  if (!draw) return fallback(svg, id);
  try {
    await draw(svg, Number.isFinite(day) ? Math.max(1, Math.floor(day)) : 1);
    neatline(svg);
    return svg;
  } catch (err) {
    console.warn(`[preview] ${id} day ${day}:`, err);
    return fallback(svg, id);
  }
}
