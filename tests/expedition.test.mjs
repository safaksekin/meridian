import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import * as L from '../src/modes/expedition/logic.ts';
import { destination } from '../scripts/build-expedition.mjs';

const ROOT = new URL('../', import.meta.url);
const doc = JSON.parse(readFileSync(new URL('public/data/expedition/pool.json', ROOT), 'utf8'));
const pool = doc.pool;

// ---------------------------------------------------------------- data
test('pool: every kind is present, places are valid', () => {
  const countries = new Set(JSON.parse(readFileSync(new URL('public/data/countries.json', ROOT), 'utf8')).map((c) => c.c));
  for (const k of ['coast', 'pop', 'names', 'streets']) assert.ok(pool.filter((p) => p.k === k).length >= 100, `${k}: at least 100 places`);
  for (const p of pool) {
    assert.ok([1, 2, 3].includes(p.t), `${p.n}: tier`);
    assert.ok(Math.abs(p.a) <= 90 && Math.abs(p.o) <= 180, `${p.n}: coordinates`);
    assert.ok(countries.has(p.c), `${p.n}: country ${p.c}`);
    if (p.k === 'names') assert.equal(p.x.length, 6, `${p.n}: six signs`);
    if (p.k === 'streets') assert.ok(existsSync(new URL(`public/data/streets/p/${p.x}.json`, ROOT)), `${p.n}: street crop ${p.x}`);
  }
});

test('pool: small enough to load on a phone', () => {
  const bytes = readFileSync(new URL('public/data/expedition/pool.json', ROOT));
  assert.ok(gzipSync(bytes).length < 60 * 1024, 'pool.json under 60 KB gzip');
  assert.ok(statSync(new URL('public/img/card-expedition.svg', ROOT)).size < 120 * 1024);
});

// ---------------------------------------------------------------- planning
test('planRun: same seed, same run; different seeds differ', () => {
  const a = L.planRun(pool, 7);
  const b = L.planRun(pool, 7);
  const c = L.planRun(pool, 8);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.legs.map((p) => p.n), c.legs.map((p) => p.n));
});

test('planRun: legs follow the rules', () => {
  for (const seed of [1, 2, 3, 50, 365, 1234]) {
    const run = L.planRun(pool, seed);
    assert.equal(run.legs.length, 60);
    assert.equal(new Set([run.start, ...run.legs]).size, 61, 'no place twice');
    let prev = run.start;
    run.legs.forEach((p, i) => {
      assert.notEqual(p.c, prev.c, `seed ${seed} leg ${i}: new country`);
      if (i > 0) assert.notEqual(p.k, run.legs[i - 1].k, `seed ${seed} leg ${i}: new clue kind`);
      if (i < 3) assert.notEqual(p.k, 'streets', 'street crops come later');
      if (i < 2) assert.equal(p.t, 1, 'first legs are easy');
      const d = L.distKm(prev.a, prev.o, p.a, p.o);
      if (i < 20) assert.ok(d >= 800 && d <= 9000, `seed ${seed} leg ${i}: ${Math.round(d)} km`);
      prev = p;
    });
  }
});

// ---------------------------------------------------------------- flying
test('fly: a hit refuels and moves on; a miss leaves you where you landed', () => {
  const run = L.planRun(pool, 11);
  const s = L.newRun(run, 11);
  const t0 = run.legs[0];
  const d0 = L.distKm(run.start.a, run.start.o, t0.a, t0.o);
  const hit = L.fly(s, run, t0.a, t0.o);
  assert.equal(hit.arrived, true);
  assert.equal(s.fuel, L.FUEL.start - L.flightCost(d0) + L.refuelFor(0, 1));
  assert.deepEqual(s.pos, [t0.a, t0.o]);
  assert.equal(L.currentLeg(s), 1);
  assert.equal(L.legsDone(s), 1);

  const t1 = run.legs[1];
  const [ma, mo] = destination(t1.a, t1.o, 90, 1000); // 1000 km east of the destination
  const fuel = s.fuel;
  const miss = L.fly(s, run, ma, mo);
  assert.equal(miss.arrived, false);
  assert.equal(miss.dir, 6, 'the destination is to the west');
  assert.equal(miss.band, 1, '750–1500 km');
  assert.ok(Math.abs(s.fuel - (fuel - miss.cost)) < 1e-6);
  assert.equal(L.currentLeg(s), 1);
  assert.equal(L.fly(s, run, t1.a, t1.o).arrived, true);
  assert.equal(s.log[1].refuel, L.refuelFor(1, 2));
});

test('fly: landing within 300 km counts, the plane snaps to the destination', () => {
  const run = L.planRun(pool, 12);
  const s = L.newRun(run, 12);
  const t0 = run.legs[0];
  const [a, o] = destination(t0.a, t0.o, 45, 290);
  assert.equal(L.fly(s, run, a, o).arrived, true);
  assert.deepEqual(s.pos, [t0.a, t0.o]);
});

test('the run ends when the fuel cannot reach the destination', () => {
  const run = L.planRun(pool, 13);
  const s = L.newRun(run, 13);
  const t0 = run.legs[0];
  // fly far away from the destination until stranded
  let guard = 0;
  while (!s.done && guard++ < 50) {
    const away = destination(t0.a, t0.o, 0, 9000);
    const [a, o] = L.canFly(s, away[0], away[1]) ? away : destination(s.pos[0], s.pos[1], 180, Math.max(1, L.rangeKm(s.fuel) - 10));
    L.fly(s, run, a, o);
  }
  assert.equal(s.done, true);
  assert.equal(s.end, 'fuel');
  assert.equal(L.legsDone(s), 0);
  assert.equal(L.canFly(s, t0.a, t0.o), false);
});

test('extras cost fuel once each', () => {
  const run = L.planRun(pool, 14);
  const s = L.newRun(run, 14);
  assert.equal(L.buyExtra(s, run, 'sun'), true);
  assert.equal(L.buyExtra(s, run, 'sun'), false);
  assert.equal(L.buyExtra(s, run, 'flag'), true);
  assert.equal(s.fuel, L.FUEL.start - L.EXTRA_COST.sun - L.EXTRA_COST.flag);
  assert.deepEqual(s.log[0].extras, ['sun', 'flag']);
});

test('compass, bands, buckets', () => {
  assert.equal(L.compass8(0), 0);
  assert.equal(L.compass8(44), 1);
  assert.equal(L.compass8(359), 0);
  assert.equal(L.compass8(225), 5);
  assert.deepEqual([100, 800, 2000, 4000, 9000].map(L.bandFor), [0, 1, 2, 3, 4]);
  assert.deepEqual([0, 3, 6, 10, 15, 40].map(L.bucketFor), L.BUCKETS.concat(L.BUCKETS[4]));
});

test('share text shows legs and fuel, not places', () => {
  const run = L.planRun(pool, 15);
  const s = L.newRun(run, 15);
  L.fly(s, run, run.legs[0].a, run.legs[0].o);
  L.quit(s);
  const text = L.shareText(4, s);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Meridian Expedition #4');
  assert.match(lines[1], /^✈️ 1 · ⛽ [\d,]+ km$/);
  assert.equal(lines[2], '🟩');
  assert.ok(!text.includes(run.legs[0].n));
});

test('sun clock: equinox at the equator, polar day in June', () => {
  const eq = L.sunDay(0, 0, new Date(Date.UTC(2026, 2, 20, 12)));
  assert.ok(Math.abs(eq.hours - 12.1) < 0.2, `equator day ${eq.hours}`);
  assert.ok(Math.abs(eq.noon - 12.12) < 0.1, `solar noon ${eq.noon}`);
  const tokyo = L.sunDay(35.68, 139.69, new Date(Date.UTC(2026, 5, 21, 12)));
  assert.equal(L.hhmm(tokyo.rise), '19:25'); // 04:25 JST
  assert.ok(Math.abs(tokyo.hours - 14.6) < 0.1);
  assert.equal(L.sunDay(78, 15, new Date(Date.UTC(2026, 5, 21))).hours, 24);
  assert.equal(L.sunDay(78, 15, new Date(Date.UTC(2026, 11, 21))).hours, 0);
});

// ---------------------------------------------------------------- balance
test('fuel economy: weak players get a few legs, strong ones a long run that still ends', () => {
  const rnd = L.mulberry32(99);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
  const median = (sigma) => {
    const res = [];
    for (let seed = 1; seed <= 120; seed++) {
      const run = L.planRun(pool, seed);
      const s = L.newRun(run, seed);
      let guard = 0;
      while (!s.done && guard++ < 400) {
        const leg = L.currentLeg(s);
        const tg = run.legs[leg];
        const sg = sigma * [0.7, 1, 1.4][tg.t - 1] * 0.45 ** s.log[leg].hops.length;
        let [a, o] = destination(tg.a, tg.o, rnd() * 360, Math.abs(gauss()) * sg * 1.2);
        if (!L.canFly(s, a, o)) [a, o] = destination(s.pos[0], s.pos[1], L.bearing(s.pos[0], s.pos[1], a, o), L.rangeKm(s.fuel) - 1);
        L.fly(s, run, a, o);
      }
      assert.equal(s.done, true, 'every run ends');
      res.push(L.legsDone(s));
    }
    res.sort((x, y) => x - y);
    return res[res.length >> 1];
  };
  const casual = median(1400);
  const expert = median(250);
  assert.ok(casual >= 3 && casual <= 8, `casual median ${casual}`);
  assert.ok(expert >= 12 && expert <= 28, `expert median ${expert}`);
});
