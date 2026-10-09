// Beeline: from a start city, follow a great circle at a fixed initial bearing and record
// the first five countries (other than the start country) the line enters.
// Output: public/data/beeline/puzzles.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { loadFeatures, mergeByCode } from './lib/countries-src.mjs';

const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;
const STEP_KM = 4;
const MAX_KM = 20000;
const MIN_SEG_KM = 12; // a hit must stay inside the country at least this long
const HITS = 5;

// ---------- spatial index over Natural Earth 10m polygons ----------
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url)));
const known = new Set(countries.map((c) => c.c));
const sov = new Map(countries.map((c) => [c.c, c.sov]));
const feats = mergeByCode(loadFeatures('10m')).filter((f) => known.has(f.code));

// Rasterise all countries once at RES degrees (scanline fill) so each lookup is one array read.
const RES = 0.02;
const W = Math.round(360 / RES), H = Math.round(180 / RES);
const codes = [null, ...feats.map((f) => f.code)];
const raster = new Uint8Array(W * H);
{
  const rows = Array.from({ length: H }, () => []);
  feats.forEach((f, fi) => {
    for (const rings of f.geometry.coordinates)
      for (const ring of rings)
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [x1, y1] = ring[j], [x2, y2] = ring[i];
          if (y1 === y2) continue;
          const r0 = Math.ceil((90 - Math.max(y1, y2)) / RES - 0.5);
          const r1 = Math.floor((90 - Math.min(y1, y2)) / RES - 0.5);
          for (let r = Math.max(0, r0); r <= Math.min(H - 1, r1); r++) {
            const y = 90 - (r + 0.5) * RES;
            if ((y1 > y) === (y2 > y)) continue;
            rows[r].push(fi + 1, x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
          }
        }
  });
  for (let r = 0; r < H; r++) {
    const row = rows[r];
    // even-odd per feature: group crossings by feature
    const by = new Map();
    for (let k = 0; k < row.length; k += 2) {
      if (!by.has(row[k])) by.set(row[k], []);
      by.get(row[k]).push(row[k + 1]);
    }
    for (const [fid, xs] of by) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] + 180) / RES - 0.5));
        const c1 = Math.min(W - 1, Math.floor((xs[k + 1] + 180) / RES - 0.5));
        raster.fill(fid, r * W + c0, r * W + c1 + 1);
      }
    }
    rows[r] = null;
  }
}

function countryAt(lon, lat) {
  const c = Math.min(W - 1, Math.max(0, Math.floor((lon + 180) / RES)));
  const r = Math.min(H - 1, Math.max(0, Math.floor((90 - lat) / RES)));
  return codes[raster[r * W + c]];
}
console.log('raster ready');

// ---------- great circle / rhumb stepping ----------
function destGC(lat, lon, brg, km) {
  const d = km / R, b = rad(brg), p1 = rad(lat), l1 = rad(lon);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((deg(l2) + 540) % 360) - 180, deg(p2)];
}

function destRhumb(lat, lon, brg, km) {
  const d = km / R, b = rad(brg), p1 = rad(lat);
  let p2 = p1 + d * Math.cos(b);
  if (Math.abs(p2) > Math.PI / 2) p2 = Math.sign(p2) * (Math.PI / 2 - 1e-9);
  const dPsi = Math.log(Math.tan(Math.PI / 4 + p2 / 2) / Math.tan(Math.PI / 4 + p1 / 2));
  const q = Math.abs(dPsi) > 1e-12 ? (p2 - p1) / dPsi : Math.cos(p1);
  const dl = (d * Math.sin(b)) / q;
  return [((deg(rad(lon) + dl) + 540) % 360) - 180, deg(p2)];
}

/** Walk the line and return the first HITS countries entered (excluding start country). */
function walk(lat, lon, brg, dest, startCode) {
  const hits = [];
  const seen = new Set([startCode]);
  let cur = startCode, pending = null;
  for (let km = STEP_KM; km <= MAX_KM; km += STEP_KM) {
    const [x, y] = dest(lat, lon, brg, km);
    const c = countryAt(x, y);
    if (c !== cur) {
      if (pending && km - pending.km < MIN_SEG_KM + STEP_KM) pending.short = true;
      if (hits.length === HITS) break; // the fifth country has been left (or was too short)
      pending = null;
      cur = c;
      if (c && !seen.has(c)) {
        seen.add(c);
        pending = { c, km, lon: +x.toFixed(3), lat: +y.toFixed(3) };
        hits.push(pending);
      }
    }
    if (hits.length === HITS && pending && km - pending.km >= MIN_SEG_KM + STEP_KM) break;
  }
  return hits.length === HITS ? hits : null;
}

const seq = (hits) => hits.map((h) => h.c).join(' ');

// ---------- start cities (GeoNames) ----------
const cityRows = readFileSync(new URL('../data-raw/cities500.txt', import.meta.url), 'utf8').split('\n');
const starts = [];
for (const line of cityRows) {
  const f = line.split('\t');
  if (f.length < 15) continue;
  const pop = +f[14];
  const fcode = f[7];
  const isCap = fcode === 'PPLC';
  if (!(pop >= 1500000 || (isCap && pop >= 150000))) continue;
  const lat = +f[4], lon = +f[5];
  const code = countryAt(lon, lat);
  if (!code) continue; // city on a coastline pixel outside the 10m polygon
  starts.push({ name: f[1], ascii: f[2], cc: code, lat, lon, pop, cap: isCap });
}
// one start per ~150 km cluster: drop smaller cities close to bigger ones
starts.sort((a, b) => b.pop - a.pop);
const kept = [];
const hav = (a, b) => {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
for (const s of starts) if (!kept.some((k) => hav(k, s) < 150)) kept.push(s);
console.log('start cities', kept.length);

// ---------- generate candidates ----------
let seed = 20261010;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

const candidates = [];
for (const s of kept) {
  const bearings = new Set();
  while (bearings.size < 24) bearings.add(Math.floor(rnd() * 72) * 5);
  for (const b of bearings) {
    const hits = walk(s.lat, s.lon, b, destGC, s.cc);
    if (!hits || hits.some((h) => h.short)) continue;
    if (hits[HITS - 1].km > 9000) continue;
    if (hits.some((h, i) => h.km - (i ? hits[i - 1].km : 0) > 4000)) continue; // no huge empty ocean legs
    // robustness: a small error in the bearing must not change the answer
    const lo = walk(s.lat, s.lon, b - 0.4, destGC, s.cc);
    const hi = walk(s.lat, s.lon, b + 0.4, destGC, s.cc);
    if (!lo || !hi || seq(lo) !== seq(hits) || seq(hi) !== seq(hits)) continue;
    const nonSov = hits.filter((h) => !sov.get(h.c)).length;
    if (nonSov > 1) continue;
    const rh = walk(s.lat, s.lon, b, destRhumb, s.cc);
    const surprise = !rh || seq(rh) !== seq(hits);
    candidates.push({ s, b, hits, surprise, rhumb: rh ? rh.map((h) => h.c) : null });
  }
}
console.log('candidates', candidates.length, 'surprising', candidates.filter((c) => c.surprise).length);

// ---------- pick a varied year of puzzles ----------
for (let i = candidates.length - 1; i > 0; i--) {
  const j = Math.floor(rnd() * (i + 1));
  [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
}
const perCity = new Map();
const perCountry = new Map();
const picked = [];
const pass = (maxCity, maxCountry, needSurprise) => {
  for (const c of candidates) {
    if (picked.includes(c)) continue;
    if (needSurprise && !c.surprise) continue;
    if ((perCity.get(c.s.name) || 0) >= maxCity) continue;
    if ((perCountry.get(c.s.cc) || 0) >= maxCountry) continue;
    picked.push(c);
    perCity.set(c.s.name, (perCity.get(c.s.name) || 0) + 1);
    perCountry.set(c.s.cc, (perCountry.get(c.s.cc) || 0) + 1);
  }
};
pass(1, 3, true);
pass(1, 4, false);
pass(2, 6, false);
pass(3, 10, false);
// spread consecutive days: avoid the same start country two days in a row
const order = [];
const pool = picked.slice();
while (pool.length) {
  const last = order[order.length - 1];
  let i = pool.findIndex((p) => !last || (p.s.cc !== last.s.cc && p.hits[0].c !== last.hits[0].c));
  if (i < 0) i = 0;
  order.push(pool.splice(i, 1)[0]);
}

const round = (n) => +n.toFixed(2);
const puzzles = order.map(({ s, b, hits, surprise, rhumb }) => {
  // Waypoints every 500 km up to 300 km past the last entry: lets the client draw and reveal the line.
  const end = hits[HITS - 1].km + 300;
  const path = [];
  for (let km = 0; km <= end; km += 500) path.push(destGC(s.lat, s.lon, b, km).map(round));
  path.push(destGC(s.lat, s.lon, b, end).map(round));
  return {
    city: s.name,
    cc: s.cc,
    lat: round(s.lat),
    lon: round(s.lon),
    b,
    hits: hits.map((h) => ({ c: h.c, km: h.km, lon: h.lon, lat: h.lat })),
    path,
    surprise,
    rhumb,
  };
});

const OUT = new URL('../public/data/beeline/', import.meta.url);
mkdirSync(OUT, { recursive: true });
writeFileSync(new URL('puzzles.json', OUT), JSON.stringify(puzzles));
console.log('puzzles', puzzles.length, 'bytes', JSON.stringify(puzzles).length);
for (const p of puzzles.slice(0, 8)) console.log(`${p.city} (${p.cc}) ${p.b}° -> ${p.hits.map((h) => `${h.c}@${h.km}`).join(' ')}${p.surprise ? '  [rhumb: ' + (p.rhumb || ['?']).join(' ') + ']' : ''}`);
