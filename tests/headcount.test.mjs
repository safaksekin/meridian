import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { feature } from 'topojson-client';
import {
  RADII, BUCKETS, encodeGrid, decodeGrid, gridTotal, popInCircle, score, bucketFor, niceTarget, formatPop, shareText,
} from '../src/modes/headcount/pop.js';
import { makeLocator, regionOk } from '../src/modes/headcount/region.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

test('score is 100 at the target, 0 at half or double, symmetric on a log scale', () => {
  assert.equal(score(25e6, 25e6), 100);
  assert.equal(score(50e6, 25e6), 0);
  assert.equal(score(12.5e6, 25e6), 0);
  assert.equal(score(100e6, 25e6), 0);
  assert.equal(score(0, 25e6), 0);
  assert.equal(score(25e6 * 2 ** 0.1, 25e6), 90);
  assert.equal(score(25e6 / 2 ** 0.1, 25e6), 90);
  assert.equal(score(26.3e6, 25e6), 93);
  assert.equal(score(39.4e6, 25e6), 34);
});

test('buckets', () => {
  assert.deepEqual(BUCKETS, ['95+', '90+', '75+', '50+', '<50']);
  assert.deepEqual([100, 95, 94, 90, 89, 75, 74, 50, 49, 0].map(bucketFor), ['95+', '95+', '90+', '90+', '75+', '75+', '50+', '50+', '<50', '<50']);
  for (const s of [0, 37, 50, 90, 100]) assert.ok(BUCKETS.includes(bucketFor(s)));
});

test('formatPop and niceTarget', () => {
  assert.equal(formatPop(38.4e6), '38.4M');
  assert.equal(formatPop(2.454e6), '2.45M');
  assert.equal(formatPop(820e3), '820K');
  assert.equal(formatPop(999.7e3), '1.00M');
  assert.equal(formatPop(1.214e9), '1.21B');
  assert.equal(formatPop(512), '512');
  assert.equal(formatPop(38.4e6, true), '38,4Mn');
  assert.equal(niceTarget(24_612_345), 25_000_000);
  assert.equal(niceTarget(3_849_000), 3_800_000);
});

test('share text has the header, the populations and no coordinates', () => {
  const s = shareText(12, [38.4e6, 31.2e6, 24.6e6], 98, true);
  assert.equal(s, 'Meridian Headcount #12\n👥 38.4M ➡ 31.2M ➡ 24.6M 🎯 98\nhttps://meridian.example/#/headcount');
  assert.match(shareText(3, [1e6], 20, false), /❌ 20/);
});

function syntheticGrid(fill) {
  const w = 1440, h = 720, cell = 0.25;
  const v = new Float64Array(w * h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) v[r * w + c] = fill(90 - (r + 0.5) * cell, -180 + (c + 0.5) * cell);
  return { v, g: decodeGrid(encodeGrid(v, w, h, -180, 90, cell, 200)) };
}

test('grid encoding round-trips within the quantisation error', () => {
  const { v, g } = syntheticGrid((lat, lon) => (Math.abs(lat) < 60 && (lon * 7 + lat * 3) % 5 > 1 ? Math.exp(((lat + lon) % 13) + 1) : 0));
  let total = 0;
  for (let i = 0; i < v.length; i++) {
    total += v[i];
    if (v[i] > 1) assert.ok(Math.abs(g.vals[i] / v[i] - 1) < 0.003);
    else if (v[i] === 0) assert.equal(g.vals[i], 0);
  }
  assert.ok(Math.abs(gridTotal(g) / total - 1) < 0.001);
});

test('popInCircle: uniform density gives ≈ density × area, wraps the antimeridian', () => {
  // One person per km² everywhere (cell area shrinks with cos(lat)).
  const km = (0.25 * Math.PI / 180) * 6371.0088;
  const { g } = syntheticGrid((lat) => km * km * Math.cos((lat * Math.PI) / 180));
  for (const r of RADII) {
    const area = 2 * Math.PI * 6371.0088 ** 2 * (1 - Math.cos(r / 6371.0088));
    for (const [lat, lon] of [[0, 0], [45, 10], [-30, 179.9], [60, -179.95]]) {
      const p = popInCircle(g, lat, lon, r);
      assert.ok(Math.abs(p / area - 1) < 0.03, `r=${r} at ${lat},${lon}: ${p} vs ${area}`);
    }
  }
  // Same circle either side of the antimeridian.
  const a = popInCircle(g, 10, 179.9, 300);
  const b = popInCircle(g, 10, -180.1, 300);
  assert.ok(Math.abs(a / b - 1) < 1e-9);
});

test('regionOk', () => {
  assert.equal(regionOk(null, null), true);
  assert.equal(regionOk({ in: 'Africa' }, 'Africa'), true);
  assert.equal(regionOk({ in: 'Africa' }, 'Asia'), false);
  assert.equal(regionOk({ in: 'Africa' }, null), false);
  assert.equal(regionOk({ out: 'Asia' }, 'Europe'), true);
  assert.equal(regionOk({ out: 'Asia' }, 'Asia'), false);
  assert.equal(regionOk({ out: 'Asia' }, null), false);
});

// ---------------------------------------------------------------- generated data
const grid = decodeGrid(new Uint8Array(gunzipSync(read('public/data/headcount/grid.bin'))));
const doc = JSON.parse(read('public/data/headcount/puzzles.json'));

test('grid: 0.25° world, global total ≈ 8.1 billion, small file', () => {
  assert.equal(grid.w, 1440);
  assert.equal(grid.h, 720);
  const total = gridTotal(grid);
  assert.ok(total > 7.8e9 && total < 8.5e9, `total ${total}`);
  assert.ok(Math.abs(doc.total / total - 1) < 1e-6);
  assert.ok(statSync(new URL('public/data/headcount/grid.bin', root)).size < 300 * 1024);
  // A few sanity points (people within 100 km).
  const p = (lat, lon) => popInCircle(grid, lat, lon, 100);
  assert.ok(p(35.68, 139.69) > 30e6, 'Tokyo');
  assert.ok(p(23.81, 90.41) > 40e6, 'Dhaka');
  assert.ok(p(-25, 130) < 50e3, 'central Australia');
  assert.equal(p(-40, -140), 0, 'South Pacific');
});

test('puzzles: ≥ 365, valid fields, ~25 % region days', () => {
  const P = doc.puzzles;
  assert.ok(P.length >= 365);
  const keys = new Set();
  for (const pz of P) {
    assert.ok(RADII.includes(pz.r));
    assert.ok(pz.t >= 1e6 && Number.isInteger(pz.t));
    assert.equal(niceTarget(pz.t), pz.t);
    assert.ok(pz.p.length >= 1 && pz.p.length <= 3);
    for (const c of pz.p) assert.ok(c.city && /^[A-Z]{2}$/.test(c.cc));
    keys.add(`${pz.r}|${pz.t}|${JSON.stringify(pz.reg ?? null)}`);
  }
  assert.equal(keys.size, P.length, 'no duplicate puzzles');
  const reg = P.filter((p) => p.reg).length / P.length;
  assert.ok(reg > 0.15 && reg < 0.35, `region share ${reg}`);
  for (const r of RADII) assert.ok(P.filter((p) => p.r === r).length >= 50);
  // Neighbouring days (including the wrap-around) never share a radius.
  for (let i = 0; i < P.length; i++) assert.notEqual(P[i].r, P[(i + 1) % P.length].r);
});

test('perfect circles agree with the browser computation (within 2 %) and satisfy the region', () => {
  const world = JSON.parse(read('public/data/world.json'));
  const cont = new Map(JSON.parse(read('public/data/countries.json')).map((c) => [c.c, c.cont]));
  const locate = makeLocator(feature(world, world.objects.countries).features);
  for (const pz of doc.puzzles) {
    for (const c of pz.p) {
      const pop = popInCircle(grid, c.lat, c.lon, pz.r);
      assert.ok(Math.abs(pop / pz.t - 1) <= 0.02, `${pz.r} ${pz.t}: ${pop}`);
      assert.ok(Math.abs(pop - c.pop) <= 1);
      assert.ok(score(pop, pz.t) >= 97);
      if (pz.reg) {
        const code = locate(c.lon, c.lat);
        assert.ok(regionOk(pz.reg, code ? cont.get(code) : null), `${JSON.stringify(pz.reg)} ${c.city}`);
      }
    }
  }
});
