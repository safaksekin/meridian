// Headcount: aggregates the GHSL 2025 population grid (30 arc-seconds, CC BY 4.0) to a 0.25° grid,
// then generates daily puzzles (target population + circle radius) with precomputed "perfect circles".
// Output: public/data/headcount/grid.bin (gzip of the shared encoding), public/data/headcount/puzzles.json
// Re-runnable: the download, the unzip and the aggregation are cached under data-raw/ghsl/.
import { mkdir, stat, readFile, writeFile, rename } from 'node:fs/promises';
import { createWriteStream, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gzipSync, gunzipSync } from 'node:zlib';
import { fromFile } from 'geotiff';
import { feature } from 'topojson-client';
import { encodeGrid, decodeGrid, popInCircle, niceTarget, RADII } from '../src/modes/headcount/pop.js';
import { makeLocator, regionOk } from '../src/modes/headcount/region.js';

const ROOT = new URL('../', import.meta.url);
const RAW = new URL('data-raw/ghsl/', ROOT);
const OUT = new URL('public/data/headcount/', ROOT);
const NAME = 'GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0';
export const GHSL_URL = `https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/${NAME}.zip`;

const CELL = 0.25; // degrees
const W = Math.round(360 / CELL);
const H = Math.round(180 / CELL);
const N_PUZZLES = 400;
const SEED = 20261010;

const exists = (u) => stat(u).then(() => true, () => false);
const log = (...a) => console.log(...a);

// ---------- 1. download + unzip ----------
async function ensureTiff() {
  await mkdir(RAW, { recursive: true });
  const tif = new URL(`${NAME}.tif`, RAW);
  if (await exists(tif)) return tif;
  const zip = new URL(`${NAME}.zip`, RAW);
  if (!(await exists(zip))) {
    log(`downloading ${GHSL_URL} (~480 MB)…`);
    const res = await fetch(GHSL_URL, { headers: { 'User-Agent': 'meridian-build/0.1' } });
    if (!res.ok) throw new Error(`${GHSL_URL} -> ${res.status}`);
    const part = new URL(`${NAME}.zip.part`, RAW);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(part));
    await rename(part, zip);
  }
  log('unzipping…');
  execFileSync('unzip', ['-o', '-q', `${NAME}.zip`, `${NAME}.tif`], { cwd: RAW });
  return tif;
}

// ---------- 2. aggregate to 0.25° (cached) ----------
async function aggregate() {
  const cache = new URL(`agg_${CELL}.f64`, RAW);
  if (await exists(cache)) {
    const b = await readFile(cache);
    return new Float64Array(b.buffer, b.byteOffset, W * H).slice();
  }
  const tif = await ensureTiff();
  const img = await (await fromFile(tif.pathname)).getImage();
  const iw = img.getWidth();
  const ih = img.getHeight();
  const [ox, oy] = img.getOrigin();
  const [rx, ry] = img.getResolution();
  const band = img.getTileHeight() || 256;
  log(`GeoTIFF ${iw}×${ih}, origin ${ox.toFixed(5)},${oy.toFixed(5)}, res ${rx}, tile ${img.getTileWidth()}×${band}`);
  // Coarse column of each source column (pixel centre, wrapped around the antimeridian).
  const colOf = new Int32Array(iw);
  for (let i = 0; i < iw; i++) {
    const lon = ox + (i + 0.5) * rx;
    colOf[i] = ((Math.floor((lon + 180) / CELL) % W) + W) % W;
  }
  const agg = new Float64Array(W * H);
  const t0 = Date.now();
  for (let y0 = 0; y0 < ih; y0 += band) {
    const y1 = Math.min(ih, y0 + band);
    const [data] = await img.readRasters({ window: [0, y0, iw, y1], interleave: false });
    for (let y = y0; y < y1; y++) {
      const lat = oy + (y + 0.5) * ry;
      const row = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / CELL)));
      const base = row * W;
      const off = (y - y0) * iw;
      for (let i = 0; i < iw; i++) {
        const v = data[off + i];
        if (v > 0) agg[base + colOf[i]] += v;
      }
    }
    if ((y0 / band) % 10 === 0) process.stdout.write(`  rows ${y0}/${ih} (${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
  }
  await writeFile(cache, Buffer.from(agg.buffer));
  return agg;
}

const agg = await aggregate();
let rawTotal = 0;
for (const v of agg) rawTotal += v;
log(`raw total population: ${(rawTotal / 1e9).toFixed(4)} billion`);

// ---------- 3. encode, write, and decode back (the build uses exactly what the browser will see) ----------
const SCALE = 200; // code = round(log1p(pop) * 200): ≤ 0.25 % error per cell
await mkdir(OUT, { recursive: true });
const payload = encodeGrid(agg, W, H, -180, 90, CELL, SCALE);
const gz = gzipSync(payload, { level: 9 });
await writeFile(new URL('grid.bin', OUT), gz);
const grid = decodeGrid(new Uint8Array(gunzipSync(gz)));
let total = 0;
let nonZero = 0;
for (const v of grid.vals) {
  total += v;
  if (v > 0) nonZero++;
}
log(`grid ${W}×${H} @ ${CELL}°: ${nonZero} populated cells, grid.bin ${(gz.length / 1024).toFixed(0)} KB (gzip), decoded total ${(total / 1e9).toFixed(4)} billion`);
if (Math.abs(total / 8.1e9 - 1) > 0.05) throw new Error(`global total ${total} is not ≈ 8.1 billion`);

// ---------- 4. helpers: country / continent lookup, big cities ----------
const world = JSON.parse(readFileSync(new URL('public/data/world.json', ROOT)));
const countries = JSON.parse(readFileSync(new URL('public/data/countries.json', ROOT)));
const contOf = new Map(countries.map((c) => [c.c, c.cont]));
const locate = makeLocatorCached(feature(world, world.objects.countries).features);
function makeLocatorCached(features) {
  const loc = makeLocator(features);
  const cache = new Map();
  return (lat, lon) => {
    const key = `${lat},${lon}`;
    if (!cache.has(key)) {
      const code = loc(lon, lat);
      cache.set(key, code ? (contOf.get(code) ?? null) : null);
    }
    return cache.get(key);
  };
}

const cities = [];
for (const line of readFileSync(new URL('data-raw/cities500.txt', ROOT), 'utf8').split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  const pop = +f[14];
  if (pop < 100000 || f[6] !== 'P') continue;
  cities.push({ name: f[1], lat: +f[4], lon: +f[5], cc: f[8], pop });
}
const toRad = Math.PI / 180;
function distKm(lat1, lon1, lat2, lon2) {
  const a = Math.sin(((lat2 - lat1) * toRad) / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(((lon2 - lon1) * toRad) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(a)));
}
/** Name a centre after a big city: the most populous city ≥ 100k within D km, else the nearest one. */
function nameFor(lat, lon, rKm) {
  const D = Math.min(150, Math.max(40, rKm / 3));
  let big = null;
  let near = null;
  for (const c of cities) {
    if (Math.abs(c.lat - lat) > 20) continue;
    const d = distKm(lat, lon, c.lat, c.lon);
    if (d <= D && (!big || c.pop > big.c.pop)) big = { c, d };
    if (!near || d < near.d) near = { c, d };
  }
  const pick = big ?? near;
  return pick ? { city: pick.c.name, cc: pick.c.cc, km: Math.round(pick.d) } : { city: '', cc: '', km: 0 };
}

// ---------- 5. population at candidate centres, per radius ----------
const LAT_MIN = -56;
const LAT_MAX = 80;
function latticeFor(step) {
  const pts = [];
  for (let row = 0; row < H; row += step) {
    const lat = 90 - (row + 0.5) * CELL;
    if (lat < LAT_MIN || lat > LAT_MAX) continue;
    for (let col = 0; col < W; col += step) {
      let any = false;
      for (let dr = 0; dr < step && !any; dr++) for (let dc = 0; dc < step && !any; dc++) any = grid.vals[(row + dr) * W + col + dc] > 0;
      if (any) pts.push({ lat, lon: -180 + (col + 0.5) * CELL });
    }
  }
  return pts;
}
const STEP = { 100: 1, 150: 1, 200: 1, 300: 1, 500: 1, 800: 1 };
const MIN_T = { 100: 1e6, 150: 1.5e6, 200: 2e6, 300: 3e6, 500: 5e6, 800: 1e7 };
const field = new Map();
for (const r of RADII) {
  const t0 = Date.now();
  const pts = latticeFor(STEP[r]);
  const pops = new Float64Array(pts.length);
  let max = 0;
  for (let i = 0; i < pts.length; i++) {
    pops[i] = popInCircle(grid, pts[i].lat, pts[i].lon, r);
    if (pops[i] > max) max = pops[i];
  }
  field.set(r, { pts, pops, max });
  log(`  r=${r} km: ${pts.length} centres, max ${(max / 1e6).toFixed(1)} M, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// ---------- 6. puzzles ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const REGIONS = [{ in: 'Africa' }, { in: 'South America' }, { in: 'Europe' }, { in: 'North America' }, { in: 'Asia' }, { out: 'Asia' }, { in: 'Oceania' }];
const TOL = 0.02;
const puzzles = [];
const seen = new Set();
let rejected = 0;
while (puzzles.length < N_PUZZLES) {
  const r = RADII[puzzles.length % RADII.length];
  const region = rnd() < 0.22 ? REGIONS[Math.floor(rnd() * REGIONS.length)] : null;
  const { pts, pops } = field.get(r);
  // Source centre: a random candidate (in the region) that holds enough people.
  let src = -1;
  for (let k = 0; k < 200 && src < 0; k++) {
    const i = Math.floor(rnd() * pts.length);
    if (pops[i] >= MIN_T[r] && regionOk(region, locate(pts[i].lat, pts[i].lon))) src = i;
  }
  if (src < 0) {
    rejected++;
    continue;
  }
  const target = niceTarget(pops[src] * (0.8 + 0.4 * rnd()));
  const key = `${r}|${target}|${JSON.stringify(region)}`;
  if (target < MIN_T[r] || seen.has(key)) {
    rejected++;
    continue;
  }
  // Perfect circles: every candidate within ±2 %, kept at least max(4r, 800 km) apart.
  const hits = [];
  for (let i = 0; i < pts.length; i++) {
    if (Math.abs(pops[i] / target - 1) <= TOL) hits.push(i);
  }
  // Prefer centres on dense cells (city centres): they make the most recognisable reveal.
  const centreVal = (i) => grid.vals[Math.floor((90 - pts[i].lat) / CELL) * W + Math.floor((pts[i].lon + 180) / CELL)];
  hits.sort((a, b) => centreVal(b) - centreVal(a));
  const picks = [];
  const sep = Math.max(4 * r, 800);
  let inRegion = 0;
  for (const i of hits) {
    if (!regionOk(region, locate(pts[i].lat, pts[i].lon))) continue;
    inRegion++;
    if (picks.length >= 3) continue;
    if (picks.some((p) => distKm(p.lat, p.lon, pts[i].lat, pts[i].lon) < sep)) continue;
    picks.push({ lat: pts[i].lat, lon: pts[i].lon, pop: Math.round(pops[i]), ...nameFor(pts[i].lat, pts[i].lon, r) });
  }
  if (!picks.length) {
    rejected++;
    continue;
  }
  seen.add(key);
  puzzles.push({ r, t: target, ...(region ? { reg: region } : {}), n: inRegion, p: picks });
}
// Fixed-seed shuffle so neighbouring days differ: each block of 6 days uses every radius once, in a random
// order, never repeating a radius across block boundaries (or across the wrap from the last day to day 1).
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const groups = new Map(RADII.map((r) => [r, shuffle(puzzles.filter((p) => p.r === r))]));
const ordered = [];
while (ordered.length < puzzles.length) {
  const avail = RADII.filter((r) => groups.get(r).length);
  const isLast = avail.every((r) => groups.get(r).length === 1);
  let perm;
  for (let tries = 0; tries < 1000; tries++) {
    perm = shuffle([...avail]);
    const okStart = !ordered.length || perm[0] !== ordered[ordered.length - 1].r;
    const okEnd = !isLast || perm[perm.length - 1] !== ordered[0].r;
    if (okStart && okEnd) break;
  }
  for (const r of perm) ordered.push(groups.get(r).pop());
}
puzzles.splice(0, puzzles.length, ...ordered);
const doc = {
  source: 'GHSL GHS-POP R2023A, epoch 2025, 30 arc-seconds (European Commission, JRC), CC BY 4.0',
  cell: CELL,
  total: Math.round(total),
  puzzles,
};
const json = JSON.stringify(doc);
await writeFile(new URL('puzzles.json', OUT), json);

// ---------- summary ----------
const byR = Object.fromEntries(RADII.map((r) => [r, puzzles.filter((p) => p.r === r).length]));
const withReg = puzzles.filter((p) => p.reg).length;
const avgPicks = puzzles.reduce((s, p) => s + p.p.length, 0) / puzzles.length;
log(`puzzles: ${puzzles.length} (rejected ${rejected}); by radius ${JSON.stringify(byR)}; region days ${withReg} (${((100 * withReg) / puzzles.length).toFixed(0)} %); avg perfect circles ${avgPicks.toFixed(2)}`);
log(`targets: ${(Math.min(...puzzles.map((p) => p.t)) / 1e6).toFixed(1)} M … ${(Math.max(...puzzles.map((p) => p.t)) / 1e6).toFixed(0)} M`);
log(`puzzles.json ${(json.length / 1024).toFixed(0)} KB (${(gzipSync(json).length / 1024).toFixed(0)} KB gzip)`);
let sameR = 0;
for (let i = 0; i < puzzles.length; i++) if (puzzles[i].r === puzzles[(i + 1) % puzzles.length].r) sameR++;
if (sameR) throw new Error(`${sameR} neighbouring days share a radius`);
log(`sample: ${JSON.stringify(puzzles[0])}`);
