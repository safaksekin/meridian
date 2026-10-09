// Builds public/data/tripoint/: one puzzle per land tripoint (three countries meeting at one point).
//   node scripts/build-tripoint.mjs
// Inputs: data-raw/ne_10m_admin_0_countries.geojson (via scripts/lib/countries-src.mjs),
//         data-raw/ne_10m_lakes.geojson, data-raw/ne_10m_rivers_lake_centerlines.geojson,
//         data-raw/wikidata-tripoints.json (fetched once from query.wikidata.org, optional).
// Output: public/data/tripoint/index.json + public/data/tripoint/p/<n>.json (n = position in the daily cycle).
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { topology } from 'topojson-server';
import { geoArea, geoContains, geoDistance, geoAzimuthalEquidistant, geoStream } from 'd3-geo';
import { loadFeatures, mergeByCode } from './lib/countries-src.mjs';

const RAW = new URL('../data-raw/', import.meta.url);
const OUT = new URL('../public/data/tripoint/', import.meta.url);
const R = 6371.0088; // km
const CLIP_KM = 560; // data radius around each tripoint (the widest view is 500 km)
const UNIT = 0.1; // km per stored integer unit
const NEAR_KM = 170; // inside this radius keep fine detail (the opening 150 km view)
const TOL_NEAR = 0.25; // km, simplification tolerance near the centre
const TOL_FAR = 1.0; // km, further out (only seen in the 500 km view)
const TOL_FILL = 1.0; // km, country fills for the reveal
const DEDUP_KM = 2;
const SEED = 20261010;
const FIRST_EASY = 30;
// Well-known tripoints that should show up early (sorted code triples).
const FAMOUS = new Set(['CH-DE-FR', 'DE-FR-LU', 'BE-DE-NL', 'AR-BR-PY', 'FI-NO-SE', 'CH-FR-IT', 'AT-CH-IT', 'AT-CH-LI', 'BG-GR-TR', 'CZ-DE-PL', 'AT-CZ-DE', 'BR-CO-PE', 'CN-KP-RU', 'IQ-IR-TR', 'IQ-SY-TR', 'AT-HU-SK', 'AT-IT-SI', 'BY-PL-UA', 'LT-PL-RU', 'CN-IN-NP', 'MZ-ZA-ZW', 'BZ-GT-MX', 'AD-ES-FR']);

const json = (name) => JSON.parse(readFileSync(new URL(name, RAW)));

// ---------- 1. Topology and arc junctions ----------
const feats = mergeByCode(loadFeatures('10m'));
const featBy = new Map(feats.map((f) => [f.code, f]));
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url)));
const cinfo = new Map(countries.map((c) => [c.c, c]));

const topo = topology(
  { countries: { type: 'FeatureCollection', features: feats.map((f) => ({ type: 'Feature', id: f.code, properties: {}, geometry: f.geometry })) } },
  1e6,
);
const { scale, translate } = topo.transform;
const arcsQ = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => [(x += dx), (y += dy)]);
});
const unq = ([x, y]) => [x * scale[0] + translate[0], y * scale[1] + translate[1]];
const arcsLL = arcsQ.map((a) => a.map(unq));

// arc index -> codes using it (one entry per use)
const arcUsers = arcsQ.map(() => []);
(function walkAll() {
  const walk = (arcs, code) => {
    for (const a of arcs) Array.isArray(a) ? walk(a, code) : arcUsers[a < 0 ? ~a : a].push(code);
  };
  for (const g of topo.objects.countries.geometries) if (g.arcs) walk(g.arcs, g.id);
})();
// kind: 'b' = border between two different codes, 'c' = coastline (one user), null = seam inside a merged country
const arcKind = arcUsers.map((u) => (u.length === 1 ? 'c' : new Set(u).size === 2 ? 'b' : null));

const ends = new Map();
arcsQ.forEach((arc, i) => {
  for (const p of [arc[0], arc[arc.length - 1]]) {
    const k = p[0] + ',' + p[1];
    if (!ends.has(k)) ends.set(k, { q: p, arcs: new Set() });
    ends.get(k).arcs.add(i);
  }
});

const drops = [];
let cands = [];
for (const { q, arcs } of ends.values()) {
  const codes = new Set();
  let coastal = false;
  for (const i of arcs) {
    if (arcKind[i] !== 'b') coastal = true;
    for (const c of arcUsers[i]) codes.add(c);
  }
  if (codes.size !== 3) continue;
  const [lon, lat] = unq(q);
  const c = { lon: +lon.toFixed(5), lat: +lat.toFixed(5), codes: [...codes].sort() };
  if (coastal) { drops.push([c, 'touches coastline']); continue; }
  cands.push(c);
}
const rawCount = cands.length;

// ---------- 2. Sanity filters ----------
const km = (a, b) => geoDistance([a.lon, a.lat], [b.lon, b.lat]) * R;
const lakes = json('ne_10m_lakes.geojson').features;
const lakeBoxes = lakes.map((f) => bboxOf(f.geometry));

function bboxOf(g) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < x0) x0 = c[0];
      if (c[0] > x1) x1 = c[0];
      if (c[1] < y0) y0 = c[1];
      if (c[1] > y1) y1 = c[1];
    } else for (const d of c) visit(d);
  };
  visit(g.coordinates);
  return [x0, y0, x1, y1];
}

/** Area (km²) of the polygon part of `code` whose boundary passes through the point. */
function partArea(code, p) {
  let best = 0;
  for (const poly of featBy.get(code).geometry.coordinates) {
    const hit = poly.some((ring) => ring.some(([x, y]) => Math.abs(x - p.lon) < 2e-3 && Math.abs(y - p.lat) < 2e-3));
    if (hit) best = Math.max(best, geoArea({ type: 'Polygon', coordinates: poly }) * R * R);
  }
  return best;
}

cands = cands.filter((c) => {
  const missing = c.codes.filter((k) => !cinfo.has(k));
  if (missing.length) return drops.push([c, `not in countries.json: ${missing}`]), false;
  const pt = [c.lon, c.lat];
  for (let i = 0; i < lakes.length; i++) {
    const b = lakeBoxes[i];
    if (pt[0] < b[0] - 0.01 || pt[0] > b[2] + 0.01 || pt[1] < b[1] - 0.01 || pt[1] > b[3] + 0.01) continue;
    if (geoContains(lakes[i], pt)) return drops.push([c, `inside lake ${lakes[i].properties.name}`]), false;
  }
  const areas = c.codes.map((k) => partArea(k, c));
  c.partArea = Math.min(...areas);
  if (c.partArea < 50) return drops.push([c, `tiny land part (${c.partArea.toFixed(1)} km²)`]), false;
  return true;
});

// Deduplicate points closer than DEDUP_KM. Near-quadripoints (different code sets that close) are ambiguous: drop all.
{
  const keep = [];
  for (const c of cands) {
    const near = cands.filter((o) => o !== c && km(o, c) < DEDUP_KM);
    if (near.some((o) => o.codes.join() !== c.codes.join())) { drops.push([c, 'near-quadripoint']); continue; }
    if (keep.some((o) => km(o, c) < DEDUP_KM)) { drops.push([c, 'duplicate']); continue; }
    keep.push(c);
  }
  cands = keep;
}

// ---------- 3. Names from Wikidata (optional) ----------
const WD_CACHE = new URL('wikidata-tripoints.json', RAW);
async function wikidata() {
  if (existsSync(WD_CACHE)) return JSON.parse(readFileSync(WD_CACHE));
  const query = `SELECT ?item ?coord ?en ?tr (GROUP_CONCAT(DISTINCT ?iso; separator=",") AS ?isos) WHERE {
    ?item wdt:P31/wdt:P279* wd:Q316655; wdt:P625 ?coord.
    OPTIONAL { ?item rdfs:label ?en FILTER(lang(?en) = "en") }
    OPTIONAL { ?item rdfs:label ?tr FILTER(lang(?tr) = "tr") }
    OPTIONAL { ?item wdt:P17 ?ctry. ?ctry wdt:P297 ?iso }
  } GROUP BY ?item ?coord ?en ?tr`;
  try {
    const res = await fetch('https://query.wikidata.org/sparql?query=' + encodeURIComponent(query), {
      headers: { Accept: 'application/sparql-results+json', 'User-Agent': 'MeridianTripointBuild/0.1 (offline build of a static geography puzzle; one query per build)' },
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const rows = (await res.json()).results.bindings
      .map((b) => {
        const m = /Point\(([-\d.eE]+) ([-\d.eE]+)\)/.exec(b.coord.value);
        return m && { id: b.item.value.split('/').pop(), lon: +m[1], lat: +m[2], en: b.en?.value ?? null, tr: b.tr?.value ?? null, iso: b.isos?.value ? b.isos.value.split(',') : [] };
      })
      .filter(Boolean);
    writeFileSync(WD_CACHE, JSON.stringify(rows));
    return rows;
  } catch (e) {
    console.warn('Wikidata unavailable, building without names:', e.message);
    return [];
  }
}
const wd = await wikidata();
// Only distinctive names ("Triple Frontier", "Mont Dolent"); generic "A–B–C tripoint" labels add nothing to the reveal.
const distinctive = (w) => w.en && !/^Q\d+$/.test(w.en) && !/tripoint/i.test(w.en) && !/[–—]/.test(w.en);
for (const c of cands) {
  let best = null, bestScore = Infinity;
  for (const w of wd) {
    if (!distinctive(w)) continue;
    // If Wikidata lists countries, at least two must match (filters out sub-national tripoints nearby).
    if (w.iso.length && w.iso.filter((i) => c.codes.includes(i)).length < 2) continue;
    const d = km(c, w);
    if (d > 5) continue;
    const score = d - (w.tr ? 0.5 : 0); // prefer items that also have a Turkish label
    if (score < bestScore) { best = w; bestScore = score; }
  }
  if (best) c.name = { en: best.en, tr: best.tr || best.en, wd: best.id };
}

// One puzzle per country triple: keep the named / most inland one.
{
  const by = new Map();
  for (const c of cands) {
    const k = c.codes.join();
    const o = by.get(k);
    const score = (x) => (x.name ? 1e9 : 0) + x.partArea;
    if (!o) by.set(k, c);
    else {
      const [win, lose] = score(c) > score(o) ? [c, o] : [o, c];
      by.set(k, win);
      drops.push([lose, 'same three countries as another tripoint']);
    }
  }
  cands = [...by.values()];
}

// ---------- 4. Difficulty and order ----------
// Heuristic: big, populous countries are easier; a named (well-known) tripoint is a bit easier.
for (const c of cands) {
  const fame = c.codes.map((k) => Math.log10(Math.max(1e4, cinfo.get(k).pop)) + 0.4 * Math.log10(Math.max(100, cinfo.get(k).area)));
  const mean = fame.reduce((a, b) => a + b, 0) / 3;
  const min = Math.min(...fame);
  const euro = c.codes.filter((k) => cinfo.get(k).cont === 'Europe').length / 3; // familiar to most players
  const famous = FAMOUS.has(c.codes.join('-')) ? 1 : 0;
  c.ease = +(0.6 * mean + 0.4 * min + (c.name ? 0.4 : 0) + 0.6 * euro + famous).toFixed(3);
}
const sortedEase = [...cands].sort((a, b) => b.ease - a.ease);
sortedEase.forEach((c, i) => (c.difficulty = 1 + Math.floor((3 * i) / sortedEase.length))); // 1 easy .. 3 hard

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
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
// Stable input order first so the shuffle only depends on the data.
sortedEase.sort((a, b) => b.ease - a.ease || a.codes.join().localeCompare(b.codes.join()));
const order = [...shuffle(sortedEase.slice(0, FIRST_EASY)), ...shuffle(sortedEase.slice(FIRST_EASY))];

// ---------- 5. Geometry per puzzle ----------
const rivers = json('ne_10m_rivers_lake_centerlines.geojson').features.filter((f) => f.geometry);
const riverBoxes = rivers.map((f) => bboxOf(f.geometry));
const arcBoxes = arcsLL.map((a) => bboxOf({ coordinates: a }));
const polyBoxes = new Map(feats.map((f) => [f.code, f.geometry.coordinates.map((p) => bboxOf({ coordinates: p[0] }))]));

function windowFor(c) {
  const dLat = CLIP_KM / 111.2 + 0.3;
  const dLon = dLat / Math.cos((Math.min(85, Math.abs(c.lat) + dLat) * Math.PI) / 180);
  return [c.lon - dLon, c.lat - dLat, c.lon + dLon, c.lat + dLat];
}
const hits = (b, w) => !(b[2] < w[0] || b[0] > w[2] || b[3] < w[1] || b[1] > w[3]);

/** Project + clip a geometry around the point; returns arrays of [x, y] km (y down, north up). */
function project(proj, geometry) {
  const out = [];
  let cur = null;
  const sink = {
    point(x, y) { cur.push([x, y]); },
    lineStart() { cur = []; },
    lineEnd() { if (cur.length > 1) out.push(cur); cur = null; },
    polygonStart() {},
    polygonEnd() {},
    sphere() {},
  };
  geoStream(geometry, proj.stream(sink));
  return out;
}

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = dx * dx + dy * dy;
  let t = L ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
/** Douglas-Peucker with a tolerance that grows away from the centre. */
function simplify(pts, tolAt) {
  const n = pts.length;
  if (n <= 2) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = 1, idx = -1;
    for (let i = a + 1; i < b; i++) {
      const r = segDist(pts[i], pts[a], pts[b]) / tolAt(pts[i]);
      if (r > worst) { worst = r; idx = i; }
    }
    if (idx >= 0) { keep[idx] = 1; stack.push([a, idx], [idx, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const tolLine = (p) => (Math.hypot(p[0], p[1]) < NEAR_KM ? TOL_NEAR : TOL_FAR);
const tolFill = () => TOL_FILL;

/** Integer-quantise and delta-encode: [x0, y0, dx1, dy1, ...] in UNIT km. */
function encode(lines, tolAt, { ring = false, minExtent = 0 } = {}) {
  const out = [];
  for (const line of lines) {
    const s = simplify(line, tolAt);
    const flat = [];
    let px = 0, py = 0, n = 0;
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const [x, y] of s) {
      const qx = Math.round(x / UNIT), qy = Math.round(y / UNIT);
      if (n && qx === px && qy === py) continue;
      flat.push(qx - px, qy - py);
      px = qx; py = qy; n++;
      x0 = Math.min(x0, qx); x1 = Math.max(x1, qx); y0 = Math.min(y0, qy); y1 = Math.max(y1, qy);
    }
    if (n < (ring ? 3 : 2)) continue;
    if (Math.max(x1 - x0, y1 - y0) * UNIT < minExtent) continue;
    out.push(flat);
  }
  return out;
}

rmSync(new URL('p/', OUT), { recursive: true, force: true });
mkdirSync(new URL('p/', OUT), { recursive: true });

const r1 = (v) => +v.toFixed(4);
let total = 0, totalGz = 0, maxFile = 0;
const sizes = [];
order.forEach((c, n) => {
  const proj = geoAzimuthalEquidistant()
    .rotate([-c.lon, -c.lat])
    .scale(R)
    .translate([0, 0])
    .clipAngle((CLIP_KM / R) * (180 / Math.PI))
    .precision(0.2);
  const w = windowFor(c);
  const borderLines = [], coastLines = [];
  arcsLL.forEach((a, i) => {
    if (!arcKind[i] || !hits(arcBoxes[i], w)) return;
    (arcKind[i] === 'b' ? borderLines : coastLines).push(a);
  });
  const b = project(proj, { type: 'MultiLineString', coordinates: borderLines });
  const co = project(proj, { type: 'MultiLineString', coordinates: coastLines });
  const lk = lakes.flatMap((f, i) => (hits(lakeBoxes[i], w) ? project(proj, f.geometry) : []));
  const rv = rivers.flatMap((f, i) => (hits(riverBoxes[i], w) ? project(proj, f.geometry) : []));
  const fills = {};
  for (const code of c.codes) {
    const polys = featBy.get(code).geometry.coordinates.filter((_, i) => hits(polyBoxes.get(code)[i], w));
    fills[code] = encode(project(proj, { type: 'MultiPolygon', coordinates: polys }), tolFill, { ring: true, minExtent: 1.5 });
  }
  const puzzle = {
    n,
    lat: r1(c.lat),
    lon: r1(c.lon),
    codes: c.codes,
    name: c.name ? { en: c.name.en, tr: c.name.tr } : null,
    difficulty: c.difficulty,
    unit: UNIT,
    radius: CLIP_KM,
    b: encode(b, tolLine),
    c: encode(co, tolLine, { minExtent: 0.5 }),
    l: encode(lk, tolLine, { ring: true, minExtent: 0.8 }),
    r: encode(rv, tolLine),
    f: fills,
  };
  const s = JSON.stringify(puzzle);
  writeFileSync(new URL(`p/${n}.json`, OUT), s);
  const gz = gzipSync(s).length;
  total += s.length; totalGz += gz; maxFile = Math.max(maxFile, s.length);
  sizes.push([n, c.codes.join('-'), s.length, gz]);
});

const index = {
  count: order.length,
  unit: UNIT,
  attribution: 'Natural Earth (public domain); names: Wikidata (CC0)',
  // Codes are listed for tests and tooling; the game only reads p/<n>.json.
  puzzles: order.map((c, n) => ({ n, codes: c.codes, lat: r1(c.lat), lon: r1(c.lon), d: c.difficulty, name: c.name?.en ?? null })),
};
writeFileSync(new URL('index.json', OUT), JSON.stringify(index));

// ---------- 6. Summary ----------
const reasons = {};
for (const [, r] of drops) {
  const k = r.replace(/ [^ ]*\(.*\)$/, '').replace(/^inside lake .*/, 'inside lake');
  reasons[k] = (reasons[k] || 0) + 1;
}
console.log(`raw land junctions with 3 codes: ${rawCount}`);
console.log('dropped:', reasons);
for (const [c, r] of drops) if (r !== 'duplicate') console.log(`  - ${c.codes.join('-')} @ ${c.lat},${c.lon}: ${r}`);
for (const c of order) {
  const [a, b, d] = c.codes.map((k) => cinfo.get(k));
  const miss = [[a, b], [a, d], [b, d]].filter(([x, y]) => !x.nb.includes(y.c)).map(([x, y]) => `${x.c}/${y.c}`);
  if (miss.length) console.warn(`  ! ${c.codes.join('-')}: not neighbours in countries.json: ${miss}`);
}
console.log(`tripoints: ${order.length} (named ${order.filter((c) => c.name).length})`);
console.log('first 30 days:', order.slice(0, FIRST_EASY).map((c) => c.codes.join('-')).join(' '));
console.log(`data: ${(total / 1024).toFixed(0)} KB raw, ${(totalGz / 1024).toFixed(0)} KB gzip, largest file ${(maxFile / 1024).toFixed(0)} KB`);
sizes.sort((a, b) => b[2] - a[2]);
console.log('largest:', sizes.slice(0, 5).map(([n, k, s, g]) => `#${n} ${k} ${(s / 1024).toFixed(0)}K/${(g / 1024).toFixed(0)}Kgz`).join(', '));
