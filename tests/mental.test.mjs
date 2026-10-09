import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applySim, band, compass, evaluate, fitAffine, fitSimilarity, invertSim, scoreFrom, spread,
} from '../src/modes/mental/fit.ts';
import { projectAll, setProjection } from '../src/modes/mental/project.ts';

const P = [[120, 80], [900, 140], [450, 520], [210, 760], [820, 880], [600, 300], [50, 400]];
const close = (a, b, eps = 1e-6, msg) => assert.ok(Math.abs(a - b) < eps, msg ?? `${a} ≉ ${b}`);
const sim = (s, deg, tx, ty) => ({ s, theta: (deg * Math.PI) / 180, tx, ty });
const map = (m, pts) => pts.map((p) => applySim(m, p));

test('similarity fit: identity', () => {
  const m = fitSimilarity(P, P);
  close(m.s, 1); close(m.theta, 0); close(m.tx, 0, 1e-6); close(m.ty, 0, 1e-6);
});

test('similarity fit: pure rotation about the origin', () => {
  for (const deg of [10, -35, 90, 170, -179]) {
    const m = fitSimilarity(P, map(sim(1, deg, 0, 0), P));
    close(m.s, 1);
    close(m.theta, (deg * Math.PI) / 180);
    close(m.tx, 0, 1e-6); close(m.ty, 0, 1e-6);
  }
});

test('similarity fit: scale', () => {
  const m = fitSimilarity(P, map(sim(7.5, 0, 0, 0), P));
  close(m.s, 7.5); close(m.theta, 0);
  const m2 = fitSimilarity(P, map(sim(0.01, 0, 0, 0), P));
  close(m2.s, 0.01, 1e-12);
});

test('similarity fit: translation', () => {
  const m = fitSimilarity(P, map(sim(1, 0, -300, 1234), P));
  close(m.s, 1); close(m.theta, 0); close(m.tx, -300); close(m.ty, 1234);
});

test('similarity fit: combined transform recovered, residuals zero', () => {
  const truth = sim(12.3, -27, 4000, -2500);
  const dst = map(truth, P);
  const m = fitSimilarity(P, dst);
  close(m.s, truth.s); close(m.theta, truth.theta); close(m.tx, truth.tx, 1e-5); close(m.ty, truth.ty, 1e-5);
  const ev = evaluate(P, dst);
  for (const e of ev.errs) close(e, 0, 1e-6);
  assert.equal(ev.score, 100);
});

test('similarity fit never reflects', () => {
  const mirrored = P.map(([x, y]) => [-x, y]);
  const m = fitSimilarity(P, mirrored);
  assert.ok(m.s > 0);
  const ev = evaluate(P, mirrored);
  assert.ok(ev.meanErr > 50, 'a mirrored map must leave large residuals');
});

test('similarity fit is least squares (noisy data beats perturbations)', () => {
  const dst = map(sim(2, 15, 10, 20), P).map(([x, y], i) => [x + ((i * 37) % 11) - 5, y + ((i * 53) % 13) - 6]);
  const sse = (m) => P.reduce((a, p, i) => { const q = applySim(m, p); return a + (q[0] - dst[i][0]) ** 2 + (q[1] - dst[i][1]) ** 2; }, 0);
  const m = fitSimilarity(P, dst);
  const base = sse(m);
  for (const [k, d] of [['s', 0.01], ['theta', 0.005], ['tx', 1], ['ty', 1]]) {
    assert.ok(sse({ ...m, [k]: m[k] + d }) > base);
    assert.ok(sse({ ...m, [k]: m[k] - d }) > base);
  }
});

test('invertSim undoes applySim', () => {
  const m = sim(3.2, 40, -50, 75);
  const inv = invertSim(m);
  for (const p of P) {
    const q = applySim(inv, applySim(m, p));
    close(q[0], p[0], 1e-9); close(q[1], p[1], 1e-9);
  }
});

test('affine fit recovers a general affine map; null for collinear points', () => {
  const A = { a: 1.2, b: 0.3, c: -0.4, d: 0.7, tx: 5, ty: -9 };
  const dst = P.map(([x, y]) => [A.a * x + A.b * y + A.tx, A.c * x + A.d * y + A.ty]);
  const f = fitAffine(P, dst);
  for (const k of Object.keys(A)) close(f[k], A[k], 1e-6, k);
  assert.equal(fitAffine([[0, 0], [1, 1], [2, 2], [3, 3]], [[0, 0], [1, 0], [0, 1], [1, 1]]), null);
});

test('bias readout: clockwise tilt and north–south squash', () => {
  // Player draws the world rotated 20° clockwise (y-down frame) and 20% squashed north–south.
  const truth = P.map(([x, y]) => [x * 10, y * 10]);
  const th = (20 * Math.PI) / 180;
  const player = truth.map(([x, y0]) => { const y = y0 * 0.8; return [Math.cos(th) * x - Math.sin(th) * y, Math.sin(th) * x + Math.cos(th) * y]; });
  const ev = evaluate(player, truth);
  close(ev.tilt, 20, 1e-6);
  close(ev.ns, -20, 1e-6);
  const ccw = evaluate(map(sim(0.1, -12, 500, 500), truth), truth);
  close(ccw.tilt, -12, 1e-6);
  close(ccw.ns, 0, 1e-6);
});

test('score function', () => {
  assert.equal(scoreFrom(0, 1000), 100);
  assert.equal(scoreFrom(500, 1000), 0);
  assert.equal(scoreFrom(5000, 1000), 0);
  assert.equal(scoreFrom(250, 1000), 50);
  assert.equal(scoreFrom(100, 1000), 80);
  assert.equal(scoreFrom(100, 0), 0);
  // monotone non-increasing in error
  let prev = 101;
  for (let e = 0; e <= 600; e += 25) { const s = scoreFrom(e, 1000); assert.ok(s <= prev); prev = s; }
});

test('score is invariant to the player map position, size and rotation', () => {
  const truth = P.map(([x, y]) => [x * 7, y * 7]);
  const noisy = truth.map(([x, y], i) => [x + ((i * 97) % 300) - 150, y + ((i * 61) % 300) - 150]);
  const a = evaluate(noisy, truth);
  const b = evaluate(map(sim(0.13, 33, 400, 100), noisy), truth);
  assert.equal(a.score, b.score);
  close(a.meanErr, b.meanErr, 1e-6);
  assert.ok(a.score > 0 && a.score < 100);
});

test('bands and compass', () => {
  assert.equal(band(0, 1000), 0);
  assert.equal(band(150, 1000), 1);
  assert.equal(band(250, 1000), 2);
  assert.equal(band(900, 1000), 3);
  assert.equal(compass(0, -1), 0); // up = north
  assert.equal(compass(1, -1), 1); // north-east
  assert.equal(compass(0, 1), 4); // south
  assert.equal(compass(-1, 0), 6); // west
  close(spread([[0, 0], [2, 0]]), 1);
});

// ---------- generated data ----------
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url), 'utf8'));
const byCode = new Map(countries.map((c) => [c.c, c]));
const sets = JSON.parse(readFileSync(new URL('../public/data/mental/sets.json', import.meta.url), 'utf8'));
const rad = (d) => (d * Math.PI) / 180;
const km = (a, b) => 2 * 6371.0088 * Math.asin(Math.sqrt(Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2));

test('sets.json: enough valid, varied sets', () => {
  assert.ok(sets.length >= 365);
  const regions = new Set(['world', 'europe', 'africa', 'asia', 'mideast', 'americas', 'oceania']);
  let world = 0;
  for (const s of sets) {
    assert.ok(regions.has(s.region), s.region);
    assert.equal(s.codes.length, 7);
    assert.equal(new Set(s.codes).size, 7);
    const cs = s.codes.map((c) => byCode.get(c));
    for (const c of cs) assert.ok(c && c.sov, `unknown/non-sovereign ${s.codes}`);
    const min = s.region === 'world' ? 1500 : 300;
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) assert.ok(km(cs[i], cs[j]) >= min, `${s.codes[i]}-${s.codes[j]} too close`);
    if (s.region === 'world') {
      world++;
      assert.ok(new Set(cs.map((c) => c.cont)).size >= 4, `world set needs 4 continents: ${s.codes}`);
    }
  }
  const share = world / sets.length;
  assert.ok(share > 0.25 && share < 0.4, `world share ${share}`);
});

test('sets.json: no near-duplicates, themes rotate', () => {
  for (let i = 0; i < sets.length; i++) {
    const a = new Set(sets[i].codes);
    for (let j = i + 1; j < sets.length; j++) assert.ok(sets[j].codes.filter((c) => a.has(c)).length < 5, `sets ${i} and ${j}`);
  }
  let same = 0;
  for (let i = 1; i < sets.length; i++) if (sets[i].region === sets[i - 1].region) same++;
  assert.ok(same < sets.length * 0.05);
});

test('every set projects to finite, non-degenerate true points', () => {
  for (const s of sets) {
    const places = s.codes.map((c) => byCode.get(c));
    const pts = projectAll(setProjection(places), places);
    for (const p of pts) assert.ok(Number.isFinite(p[0]) && Number.isFinite(p[1]));
    assert.ok(spread(pts) > 300, `${s.codes} spread ${spread(pts)}`);
    assert.ok(fitAffine(pts, pts), `${s.codes} collinear`);
  }
});
