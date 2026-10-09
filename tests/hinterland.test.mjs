// node --test tests/hinterland.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  BUCKETS,
  bucketFor,
  revealedCount,
  scoreLabel,
  shareText,
  status,
  tileFor,
} from '../src/modes/hinterland/logic.ts';

const DATA = new URL('../public/data/hinterland/', import.meta.url);
const puzzles = JSON.parse(readFileSync(new URL('puzzles.json', DATA)));
const families = JSON.parse(readFileSync(new URL('families.json', DATA)));
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url)));
const codes = new Set(countries.map((c) => c.c));

function km(a, b) {
  const r = (d) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(x)));
}

// ---------- logic ----------
const FAM = { DE: 'germanic', AT: 'germanic', NL: 'germanic', FR: 'romance', PL: 'slavic' };

test('tiles: correct, same family, other', () => {
  assert.equal(tileFor('DE', 'DE', FAM), 'good');
  assert.equal(tileFor('AT', 'DE', FAM), 'near');
  assert.equal(tileFor('FR', 'DE', FAM), 'bad');
  assert.equal(tileFor('AQ', 'DE', FAM), 'bad'); // no family known
  assert.equal(tileFor('AQ', 'XX', FAM), 'bad'); // two unknowns are not "the same family"
});

test('status, reveal count and buckets', () => {
  assert.deepEqual(status([], 'DE'), { done: false, won: false });
  assert.equal(revealedCount([], 'DE'), 1);
  assert.equal(revealedCount(['FR', 'PL'], 'DE'), 3);
  assert.equal(revealedCount(['FR', 'DE'], 'DE'), 6, 'all names shown once solved');
  const lost = ['FR', 'PL', 'AT', 'NL', 'ES', 'IT'];
  assert.deepEqual(status(lost, 'DE'), { done: true, won: false });
  assert.equal(revealedCount(lost, 'DE'), 6);
  assert.equal(bucketFor(['FR', 'AT', 'DE'], 'DE'), '3');
  assert.equal(bucketFor(lost, 'DE'), 'X');
  assert.ok(BUCKETS.includes(bucketFor(lost, 'DE')));
  assert.equal(scoreLabel(lost, 'DE'), 'X/6');
});

test('share text', () => {
  const s = shareText(12, ['FR', 'AT', 'DE'], 'DE', FAM);
  assert.equal(s, 'Meridian Hinterland #12\n🏘️ 🟥🟨🟩 3/6\nhttps://meridian.example/#/hinterland');
  const l = shareText(3, ['FR', 'PL', 'AT', 'NL', 'ES', 'IT'], 'DE', FAM).split('\n');
  assert.equal(l[1], '🏘️ 🟥🟥🟨🟨🟥🟥 X/6');
});

// ---------- generated data ----------
test('at least 365 well-formed puzzles', () => {
  assert.ok(Array.isArray(puzzles) && puzzles.length >= 365, `only ${puzzles.length}`);
  for (const p of puzzles) {
    assert.ok(codes.has(p.country), `unknown country ${p.country}`);
    assert.equal(p.names.length, 6);
    assert.equal(new Set(p.names.map((n) => n.n.toLowerCase())).size, 6, `duplicate name in ${p.country}`);
    for (const n of p.names) {
      assert.equal(typeof n.n, 'string');
      assert.ok(n.n.length <= 22 && !/[0-9()]/.test(n.n), `bad name ${n.n}`);
      assert.ok(Math.abs(n.lat) <= 90 && Math.abs(n.lon) <= 180);
      if (n.admin1 !== undefined) assert.equal(typeof n.admin1, 'string');
    }
    if (p.pat) assert.ok(p.pat.s.length >= 3 && p.pat.pct > 0 && p.pat.pct < 100);
  }
});

test('names are spread out (30 km, relaxed only for tiny countries)', () => {
  let relaxed = 0;
  for (const p of puzzles) {
    let min = Infinity;
    for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) min = Math.min(min, km(p.names[i], p.names[j]));
    assert.ok(min >= 3, `${p.country}: names ${min.toFixed(1)} km apart`);
    if (min < 30) relaxed++;
  }
  assert.ok(relaxed <= puzzles.length * 0.05, `${relaxed} puzzles with close names`);
});

test('no country twice within 30 days (cyclic) and no reused names', () => {
  const N = puzzles.length;
  const pos = new Map();
  puzzles.forEach((p, i) => pos.set(p.country, [...(pos.get(p.country) || []), i]));
  for (const [c, l] of pos) {
    for (let i = 1; i < l.length; i++) assert.ok(l[i] - l[i - 1] >= 30, `${c} at ${l[i - 1]} and ${l[i]}`);
    if (l.length > 1) assert.ok(l[0] + N - l[l.length - 1] >= 30, `${c} wraps too soon`);
  }
  const seen = new Set();
  for (const p of puzzles) for (const n of p.names) {
    const k = `${p.country}:${n.n}`;
    assert.ok(!seen.has(k), `${k} used twice`);
    seen.add(k);
  }
  assert.ok(pos.size >= 60, `only ${pos.size} countries`);
  const most = Math.max(...[...pos.values()].map((l) => l.length));
  assert.ok(most > 1 && most <= 8);
});

test('every puzzle country (and almost every country) has a language family', () => {
  for (const p of puzzles) assert.ok(families[p.country], `no family for ${p.country}`);
  const missing = countries.filter((c) => !families[c.c]).map((c) => c.c);
  assert.ok(missing.length <= 6, `missing families: ${missing.join(' ')}`);
});

test('data stays small', () => {
  const raw = statSync(new URL('puzzles.json', DATA)).size;
  assert.ok(raw < 300 * 1024, `puzzles.json is ${raw} bytes`);
  const gz = gzipSync(readFileSync(new URL('puzzles.json', DATA))).length + gzipSync(readFileSync(new URL('families.json', DATA))).length;
  assert.ok(gz < 1.5 * 1024 * 1024);
});
