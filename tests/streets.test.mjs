import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import {
  BUCKETS, HINTS, MAX_GUESSES, bucketFor, coverScale, decode, emojiLine, linesPath, polyPath, rosePath, scoreLabel,
  shareText, status, unlockedHints,
} from '../src/modes/streets/logic.ts';
import { areaRings, clipLine, coastDecider, densityDecider, fold, inside } from '../scripts/build-streets.mjs';

const DATA = new URL('../public/data/streets/', import.meta.url);
const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

// ---------------------------------------------------------------- game logic
test('status, buckets and labels', () => {
  assert.deepEqual(status([], 'T'), { done: false, won: false, misses: 0 });
  assert.deepEqual(status(['A', 'B', 'T'], 'T'), { done: true, won: true, misses: 2 });
  const six = ['A', 'B', 'C', 'D', 'E', 'F'];
  assert.deepEqual(status(six, 'T'), { done: true, won: false, misses: 6 });
  assert.equal(bucketFor(['T'], 'T'), '1');
  assert.equal(bucketFor(['A', 'B', 'T'], 'T'), '3');
  assert.equal(bucketFor(six, 'T'), 'X');
  assert.equal(scoreLabel(six, 'T'), 'X/6');
  assert.equal(MAX_GUESSES, 6);
  for (const g of [['T'], ['A', 'T'], six]) assert.ok(BUCKETS.includes(bucketFor(g, 'T')));
});

test('hints unlock one per wrong guess, in order, and all at the end', () => {
  assert.deepEqual([...unlockedHints([], 'T')], []);
  assert.deepEqual([...unlockedHints(['A'], 'T')], ['north']);
  assert.deepEqual([...unlockedHints(['A', 'B'], 'T')], ['north', 'water']);
  assert.deepEqual([...unlockedHints(['A', 'B', 'C', 'D', 'E'], 'T')], [...HINTS]);
  assert.deepEqual([...unlockedHints(['T'], 'T')], [...HINTS]);
  assert.deepEqual(HINTS, ['north', 'water', 'rail', 'zoom', 'names']);
});

test('share text', () => {
  assert.equal(emojiLine(['A', 'B', 'T'], 'T'), '🛣️ ⬛⬛🟩 3/6');
  assert.equal(emojiLine(['A', 'B', 'C', 'D', 'E', 'F'], 'T'), '🛣️ ⬛⬛⬛⬛⬛🟥 X/6');
  const s = shareText(12, ['T'], 'T').split('\n');
  assert.equal(s[0], 'Meridian Streetprint #12');
  assert.equal(s[1], '🛣️ 🟩 1/6');
  assert.equal(s[2], 'https://meridian.example/#/streets');
});

test('geometry helpers', () => {
  close(coverScale(0), 1);
  close(coverScale(90), 1);
  close(coverScale(45), Math.SQRT2);
  close(coverScale(-135), Math.SQRT2);
  assert.deepEqual(decode([10, 20, 5, -5, -1, 0]), [[10, 20], [15, 15], [14, 15]]);
  assert.equal(linesPath([[10, 20, 5, -5]]), 'M10 20L15 15');
  assert.equal(linesPath([[1, 2]]), '');
  assert.equal(polyPath([[0, 0, 10, 0, 0, 10]]), 'M0 0L10 0L10 10Z');
  const rose = new Array(36).fill(0);
  rose[0] = 100;
  rose[18] = 100;
  const d = rosePath(rose, 50);
  assert.equal((d.match(/M0 0/g) || []).length, 2);
  // the north petal ends near (±4.4, -49.8)
  assert.ok(d.includes('-49.81'), d);
});

// ---------------------------------------------------------------- build helpers
test('fold matches the app version', () => {
  assert.equal(fold('São Paulo'), 'sao paulo');
  assert.equal(fold('İstanbul'), 'istanbul');
  assert.equal(fold('Kraków'), 'krakow');
  assert.equal(fold("Xi'an"), 'xi an');
});

test('clipLine clips to the square and keeps pieces separate', () => {
  const pieces = clipLine([[-20, 0], [20, 0], [20, 30], [0, 30], [0, 5]], 10);
  assert.equal(pieces.length, 2);
  assert.deepEqual(pieces[0], [[-10, 0], [10, 0]]);
  assert.deepEqual(pieces[1], [[0, 10], [0, 5]]);
});

test('area clipping: lake overlapping the box, decided by street density', () => {
  const h = 100;
  // lake covers the east half (x > 0), extends far outside the box
  const ring = [[0, -500], [500, -500], [500, 500], [0, 500], [0, -500]];
  // streets only in the west half
  const evidence = [];
  for (let x = -95; x < 0; x += 10) for (let y = -95; y < 100; y += 10) evidence.push([x, y, 10]);
  const { rings, partial } = areaRings([ring], h, densityDecider(h, evidence));
  assert.ok(partial);
  assert.ok(inside(rings, 50, 0), 'east is water');
  assert.ok(!inside(rings, -50, 0), 'west is land');
  // same lake split into pieces with reversed direction must give the same answer
  const rev = ring.slice().reverse();
  const r2 = areaRings([rev.slice(0, 3), rev.slice(2)], h, densityDecider(h, evidence)).rings;
  assert.ok(inside(r2, 50, 0) && !inside(r2, -50, 0));
});

test('area clipping: coastline puts water on the right', () => {
  const h = 100;
  // heading north along x = 20 (screen y decreases): right side = east = sea
  const coast = [[20, 300], [20, -300]];
  const { rings } = areaRings([coast], h, coastDecider(h));
  assert.ok(inside(rings, 60, 0), 'east is sea');
  assert.ok(!inside(rings, -60, 0), 'west is land');
  // closed island fully inside the box, counter-clockwise on the map (land on the left): sea around it
  const island = [[-30, -30], [-30, 30], [30, 30], [30, -30], [-30, -30]]; // screen coords: N=up, this runs CCW on a map
  const r2 = areaRings([island], h, coastDecider(h)).rings;
  assert.ok(r2.length >= 1);
  // no pieces cross the border, so the ring itself is returned (island polygon)
  assert.ok(inside(r2, 0, 0) !== inside(r2, 80, 80));
});

// ---------------------------------------------------------------- generated data
const haveData = existsSync(new URL('index.json', DATA));

test('generated data: index, cities and puzzle files', { skip: !haveData && 'run node scripts/build-streets.mjs first' }, () => {
  const index = JSON.parse(readFileSync(new URL('index.json', DATA), 'utf8'));
  const cities = JSON.parse(readFileSync(new URL('cities.json', DATA), 'utf8'));
  const byId = new Map(cities.map((c) => [c.i, c]));
  const countries = new Set(JSON.parse(readFileSync(new URL('../countries.json', DATA), 'utf8')).map((c) => c.c));
  assert.ok(index.length >= 150, `only ${index.length} puzzles`);
  assert.ok(cities.length >= 1000, `only ${cities.length} cities`);
  assert.equal(byId.size, cities.length, 'duplicate city ids');
  for (const c of cities) {
    assert.ok(countries.has(c.c), `unknown country ${c.c} for ${c.n}`);
    assert.ok(Number.isFinite(c.a) && Number.isFinite(c.o));
  }
  let maxBytes = 0;
  index.forEach((p, i) => {
    assert.equal(p.id, i);
    assert.ok(byId.has(p.c), `puzzle ${i}: city ${p.c} missing from cities.json`);
    assert.equal(byId.get(p.c).c, p.cc);
    assert.ok(p.rot >= 30 && p.rot <= 330, `rotation ${p.rot}`);
    if (i > 0) assert.notEqual(p.c, index[i - 1].c, `same city on consecutive days ${i - 1}/${i}`);
    const file = new URL(`p/${i}.json`, DATA);
    maxBytes = Math.max(maxBytes, statSync(file).size);
    const d = JSON.parse(readFileSync(file, 'utf8'));
    assert.equal(d.id, i);
    assert.equal(d.s, 1500);
    assert.equal(d.z.s, 5000);
    assert.equal(d.rose.length, 36);
    assert.ok(Math.max(...d.rose) === 100);
    assert.ok(d.names.length <= 3);
    assert.ok(d.m.length + d.r.length >= 40, `puzzle ${i} has few streets`);
    for (const l of [...d.m, ...d.r, ...d.rl]) {
      for (const [x, y] of decode(l)) assert.ok(Math.abs(x) <= d.s + 1 && Math.abs(y) <= d.s + 1, `puzzle ${i} out of box`);
    }
  });
  assert.ok(maxBytes < 300 * 1024, `largest puzzle file ${maxBytes} bytes`);
});

test('generated data: every puzzle city is findable by its English name', { skip: !haveData }, () => {
  const index = JSON.parse(readFileSync(new URL('index.json', DATA), 'utf8'));
  const cities = JSON.parse(readFileSync(new URL('cities.json', DATA), 'utf8'));
  const byId = new Map(cities.map((c) => [c.i, c]));
  for (const p of index) {
    const c = byId.get(p.c);
    const keys = [fold(c.n), ...(c.t ? [fold(c.t)] : []), ...(c.k ?? [])];
    assert.ok(keys.includes(fold(p.n)), `${p.n} not searchable`);
  }
});
