// Builds public/data/expedition/pool.json: the places an Expedition run can send the player to,
// each with the clue "window" it is shown through. Runs themselves are planned in the browser
// from a seed (src/modes/expedition/logic.ts), so the daily run and endless runs share this pool.
//
// Sources (all already used by other modes, nothing new to download):
//   GeoNames cities500 (CC BY 4.0) · Natural Earth 50m admin-0 (public domain) for the land mask ·
//   Streetprint crops (public/data/streets, © OpenStreetMap contributors, ODbL).
// Usage: node scripts/build-expedition.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadFeatures } from './lib/countries-src.mjs';

const ROOT = new URL('../', import.meta.url);
const RAW = new URL('data-raw/', ROOT);
const OUT = new URL('public/data/expedition/', ROOT);
const R = 6371.0088;
const D2R = Math.PI / 180;

/** Clue window half-sizes in km per tier (kept in sync with WINDOW_KM in logic.ts). */
const COAST_KM = [1600, 1100, 700];
const NAMES_RADIUS_KM = 45;
const NAMES_SHOWN = 6;

export function haversine(a1, o1, a2, o2) {
  const dA = (a2 - a1) * D2R;
  const dO = (o2 - o1) * D2R;
  const s = Math.sin(dA / 2) ** 2 + Math.cos(a1 * D2R) * Math.cos(a2 * D2R) * Math.sin(dO / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Seeded PRNG (same as src/core/daily.ts). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- land mask
// Natural Earth countries rasterised (even-odd per polygon, OR across polygons) on a 0.05° grid.
// Good enough to tell a coastal city from an inland one and to measure how much sea a window shows.
const CELL = 0.05;
const MW = Math.round(360 / CELL);
const MH = Math.round(180 / CELL);

export function buildLandMask(features) {
  const mask = new Uint8Array(MW * MH);
  const polys = [];
  for (const f of features) {
    const g = f.geometry;
    for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) polys.push(poly);
  }
  for (const poly of polys) {
    // edges of all rings of this polygon, bucketed by row
    const rows = new Map();
    for (const ring of poly) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [x1, y1] = ring[i];
        const [x2, y2] = ring[i + 1];
        if (y1 === y2) continue;
        const r1 = Math.ceil((90 - Math.max(y1, y2)) / CELL - 0.5);
        const r2 = Math.floor((90 - Math.min(y1, y2)) / CELL - 0.5);
        for (let r = Math.max(0, r1); r <= Math.min(MH - 1, r2); r++) {
          const y = 90 - (r + 0.5) * CELL;
          if ((y1 > y) === (y2 > y)) continue;
          const x = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
          if (!rows.has(r)) rows.set(r, []);
          rows.get(r).push(x);
        }
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c1 = Math.max(0, Math.ceil((xs[i] + 180) / CELL - 0.5));
        const c2 = Math.min(MW - 1, Math.floor((xs[i + 1] + 180) / CELL - 0.5));
        for (let c = c1; c <= c2; c++) mask[r * MW + c] = 1;
      }
    }
  }
  return mask;
}

export function isLand(mask, lat, lon) {
  const r = Math.floor((90 - lat) / CELL);
  let c = Math.floor((((lon + 180) % 360) + 360) % 360 / CELL);
  if (r < 0 || r >= MH) return false;
  if (c >= MW) c = MW - 1;
  return mask[r * MW + c] === 1;
}

/** Point `km` away from (lat, lon) on the initial bearing `brg` (degrees). */
export function destination(lat, lon, brg, km) {
  const d = km / R;
  const p1 = lat * D2R;
  const b = brg * D2R;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = lon * D2R + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [p2 / D2R, ((((l2 / D2R + 540) % 360) + 360) % 360) - 180];
}

/** Sea within `km` of the point in any of 16 directions. */
function nearSea(mask, lat, lon, km) {
  for (let b = 0; b < 360; b += 22.5) {
    for (const f of [0.35, 0.7, 1]) {
      const [a, o] = destination(lat, lon, b, km * f);
      if (!isLand(mask, a, o)) return true;
    }
  }
  return false;
}

/** Share of land in a square window of half-size `km` (azimuthal sample, 21 × 21 points). */
export function landShare(mask, lat, lon, km) {
  let land = 0;
  let n = 0;
  for (let i = -10; i <= 10; i++) {
    for (let j = -10; j <= 10; j++) {
      const dx = (j / 10) * km;
      const dy = (i / 10) * km;
      const dist = Math.hypot(dx, dy);
      const [a, o] = dist ? destination(lat, lon, (Math.atan2(dx, -dy) / D2R + 360) % 360, dist) : [lat, lon];
      n++;
      if (isLand(mask, a, o)) land++;
    }
  }
  return land / n;
}

// ---------------------------------------------------------------- GeoNames
function readCities() {
  const lines = readFileSync(new URL('cities500.txt', RAW), 'utf8').split('\n');
  const out = [];
  for (const line of lines) {
    if (!line) continue;
    const f = line.split('\t');
    if (f[6] !== 'P') continue;
    out.push({ id: f[0], n: f[1], a: +f[4], o: +f[5], code: f[7], c: f[8], pop: +f[14] || 0 });
  }
  return out;
}

/** Greedy spacing: keep items (already sorted by priority) at least `km` apart. */
function spread(items, km) {
  const kept = [];
  for (const it of items) if (kept.every((k) => haversine(k.a, k.o, it.a, it.o) >= km)) kept.push(it);
  return kept;
}

const round = (x, d = 3) => Math.round(x * 10 ** d) / 10 ** d;

// ---------------------------------------------------------------- build
function main() {
  const countries = JSON.parse(readFileSync(new URL('public/data/countries.json', ROOT), 'utf8'));
  const known = new Map(countries.map((c) => [c.c, c]));
  const cities = readCities().filter((c) => known.has(c.c));
  console.log(`GeoNames places: ${cities.length}`);

  console.time('land mask');
  const mask = buildLandMask(loadFeatures('50m'));
  console.timeEnd('land mask');

  // Turkish names for big cities, where Streetprint's list has one.
  const trName = new Map();
  for (const c of JSON.parse(readFileSync(new URL('public/data/streets/cities.json', ROOT), 'utf8'))) if (c.t) trName.set(c.i, c.t);
  const entry = (k, t, c, extra = {}) => ({ k, t, a: round(c.a), o: round(c.o), n: c.n, ...(trName.has(c.id) ? { tr: trName.get(c.id) } : {}), c: c.c, ...extra });

  const byPop = [...cities].sort((a, b) => b.pop - a.pop);
  const majors = byPop.filter((c) => !['PPLX', 'PPLH', 'PPLQ', 'PPLW'].includes(c.code));

  // Population windows: big cities, the density pattern around them is the clue.
  const pop = spread(majors.filter((c) => c.pop >= 1_000_000), 450).map((c) => entry('pop', c.pop >= 8e6 ? 1 : c.pop >= 3e6 ? 2 : 3, c));

  // Coast windows: coastal cities whose window shows a real coastline (neither all sea nor all land).
  const coastCands = majors.filter((c) => c.pop >= 100_000 && nearSea(mask, c.a, c.o, 30));
  const coast = [];
  for (const c of spread(coastCands, 300)) {
    const t = c.pop >= 2e6 || c.code === 'PPLC' ? 1 : c.pop >= 500_000 ? 2 : 3;
    const share = landShare(mask, c.a, c.o, COAST_KM[t - 1]);
    if (share < 0.12 || share > 0.85) continue;
    coast.push(entry('coast', t, c));
  }

  // Village signs: a mid-sized town, shown only through small places around it.
  const small = cities.filter((c) => c.pop >= 300 && c.pop < 15_000 && ['PPL', 'PPLA3', 'PPLA4'].includes(c.code));
  const grid = new Map(); // 1° buckets for neighbour search
  const key = (a, o) => `${Math.floor(a)},${Math.floor(o)}`;
  for (const s of small) {
    const k = key(s.a, s.o);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(s);
  }
  const around = (c) => {
    const out = [];
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++)
        for (const s of grid.get(key(c.a + i, c.o + j)) ?? []) {
          if (s.c !== c.c) continue; // one country's signs, like a real drive
          const d = haversine(c.a, c.o, s.a, s.o);
          if (d > 4 && d <= NAMES_RADIUS_KM) out.push(s);
        }
    return out;
  };
  const rnd = mulberry32(0xe4bed);
  const towns = majors.filter((c) => c.pop >= 15_000 && c.pop < 400_000 && ['PPL', 'PPLA', 'PPLA2'].includes(c.code));
  const perCountry = new Map();
  const names = [];
  for (const c of spread(towns, 160)) {
    const n = perCountry.get(c.c) ?? 0;
    const cap = Math.max(2, Math.round(Math.sqrt(known.get(c.c).area / 20_000)));
    if (n >= cap) continue;
    const signs = around(c).filter((s) => !s.n.includes(c.n) && !c.n.includes(s.n) && s.n.length <= 22);
    const uniq = [...new Map(signs.map((s) => [s.n, s])).values()];
    if (uniq.length < 10) continue;
    // a random but spread-out pick: shuffle, then prefer names far from each other
    uniq.sort(() => rnd() - 0.5);
    const shown = spread(uniq, 6).slice(0, NAMES_SHOWN);
    if (shown.length < NAMES_SHOWN) continue;
    perCountry.set(c.c, n + 1);
    const cpop = known.get(c.c).pop;
    names.push(entry('names', cpop >= 30e6 ? 1 : cpop >= 5e6 ? 2 : 3, c, { x: shown.map((s) => s.n) }));
  }

  // Street crops: one per Streetprint city (its first, most characteristic crop).
  const popById = new Map(cities.map((c) => [c.id, c]));
  const streetsIndex = JSON.parse(readFileSync(new URL('public/data/streets/index.json', ROOT), 'utf8'));
  const seen = new Set();
  const streets = [];
  for (const p of streetsIndex) {
    if (seen.has(p.c) || !existsSync(new URL(`public/data/streets/p/${p.id}.json`, ROOT))) continue;
    seen.add(p.c);
    const city = popById.get(p.c);
    const cpop = city?.pop ?? 0;
    streets.push(entry('streets', cpop >= 3e6 ? 2 : 3, { id: p.c, n: p.n, a: p.lat, o: p.lon, c: p.cc }, { x: p.id }));
  }

  const pool = [...pop, ...coast, ...names, ...streets];
  const count = (k) => {
    const list = pool.filter((p) => p.k === k);
    return `${k} ${list.length} (t1 ${list.filter((p) => p.t === 1).length} · t2 ${list.filter((p) => p.t === 2).length} · t3 ${list.filter((p) => p.t === 3).length})`;
  };
  mkdirSync(OUT, { recursive: true });
  const doc = {
    attribution: 'GeoNames (CC BY 4.0) · Natural Earth (public domain) · © OpenStreetMap contributors (ODbL) · GHSL (CC BY 4.0)',
    pool,
  };
  const json = JSON.stringify(doc);
  writeFileSync(new URL('pool.json', OUT), json);
  console.log(['pop', 'coast', 'names', 'streets'].map(count).join('\n'));
  console.log(`pool.json: ${pool.length} places, ${(json.length / 1024).toFixed(0)} KB`);
}

// ---------------------------------------------------------------- home card art
// A globe with real Natural Earth land (the display map) and a route with one missed hop, in the
// brand palette. Flat colours only (no glow).
async function buildArt() {
  const { geoOrthographic, geoPath, geoGraticule10, geoCircle } = await import('d3-geo');
  const { merge } = await import('topojson-client');
  const topo = JSON.parse(readFileSync(new URL('public/data/world.json', ROOT), 'utf8'));
  const land = merge(topo, topo.objects.countries.geometries);
  const W = 800;
  const H = 500;
  const proj = geoOrthographic().rotate([-44, -18]).scale(330).translate([500, 290]).clipAngle(90).precision(0.2);
  const path = geoPath(proj);
  const f = (d) => d.replace(/(\d+\.\d{2})\d+/g, '$1');
  // Istanbul → Cairo → (miss in Sudan) → Nairobi → Muscat → Mumbai
  const stops = [[28.97, 41.01], [31.24, 30.04], [30.2, 15.5], [36.82, -1.29], [58.41, 23.59], [72.88, 19.08]];
  const arcs = stops.slice(1).map((p, i) => f(path({ type: 'LineString', coordinates: [stops[i], p] })));
  const dots = stops.map((p, i) => {
    const [x, y] = proj(p);
    const missed = i === 2;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${missed ? 7 : 8}" fill="${missed ? '#0b1b3a' : '#ffffff'}" stroke="${missed ? '#ff8a3d' : '#0b1b3a'}" stroke-width="3.5"/>`;
  });
  const [px, py] = proj(stops[stops.length - 1]);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0b1b3a"/>
<path d="${f(path({ type: 'Sphere' }))}" fill="#1d4f9e"/>
<path d="${f(path(geoGraticule10()))}" fill="none" stroke="#65d0f4" stroke-opacity=".18" stroke-width="1"/>
<path d="${f(path(land))}" fill="#ffffff" stroke="#9db6de" stroke-width=".8"/>
<path d="${f(path(geoCircle().center(stops[stops.length - 1]).radius(16)()))}" fill="#65d0f4" fill-opacity=".1" stroke="#65d0f4" stroke-width="2.5" stroke-dasharray="9 7"/>
${arcs.map((d) => `<path d="${d}" fill="none" stroke="#ff8a3d" stroke-width="5" stroke-linecap="round"/>`).join('\n')}
${dots.join('\n')}
<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="13" fill="#2373f4" stroke="#ffffff" stroke-width="4"/>
</svg>
`;
  writeFileSync(new URL('public/img/card-expedition.svg', ROOT), svg);
  console.log(`card-expedition.svg: ${(svg.length / 1024).toFixed(0)} KB`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
  await buildArt();
}
