// node --test tests/tripoint.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import {
  mark, marks, isWin, misses, hints, found, givenCountry, lockedSlots, shareRow, shareText, bucket, pathOf, niceKm, MAX_GUESSES,
} from '../src/modes/tripoint/logic.ts';

const NB = { CH: ['AT', 'DE', 'FR', 'IT', 'LI'], DE: ['AT', 'CH', 'FR', 'PL', 'NL'], FR: ['CH', 'DE', 'ES', 'IT'], AT: ['CH', 'DE', 'IT'], PT: ['ES'], ES: ['FR', 'PT'], PL: ['DE'], IT: ['AT', 'CH', 'FR'], JP: [] };
const nb = (c) => NB[c] ?? [];
const POP = { DE: 83, FR: 68, CH: 9 };
const pop = (c) => POP[c] ?? 0;
const ANS = ['CH', 'DE', 'FR'];

test('feedback marks', () => {
  assert.deepEqual(marks(['DE', 'AT', 'PT'], ANS, nb), ['good', 'near', 'bad']);
  assert.equal(mark('ES', ANS, nb), 'near'); // borders France
  assert.equal(mark('JP', ANS, nb), 'bad');
  assert.equal(mark('FR', ANS, nb), 'good');
});

test('win, misses and hint layers', () => {
  assert.ok(isWin(['FR', 'CH', 'DE'], ANS), 'order does not matter');
  assert.ok(!isWin(['FR', 'CH', 'IT'], ANS));
  const g = [['DE', 'AT', 'PT'], ['DE', 'IT', 'ES']];
  assert.equal(misses(g, ANS), 2);
  assert.deepEqual(hints(0), { water: false, wide: false, give: false });
  assert.deepEqual(hints(1), { water: true, wide: false, give: false });
  assert.deepEqual(hints(2), { water: true, wide: true, give: false });
  assert.deepEqual(hints(3), { water: true, wide: true, give: true });
});

test('given country only after 3 misses and only while two are missing', () => {
  const two = [['DE', 'AT', 'PT'], ['DE', 'IT', 'ES'], ['DE', 'PL', 'JP']];
  assert.equal(givenCountry(two.slice(0, 2), ANS, pop), null);
  assert.equal(givenCountry(two, ANS, pop), 'FR'); // most populous missing
  const one = [['DE', 'CH', 'PT'], ['DE', 'CH', 'ES'], ['DE', 'CH', 'JP']];
  assert.equal(givenCountry(one, ANS, pop), null);
});

test('locked slots keep found countries in place', () => {
  const g = [['AT', 'DE', 'PT'], ['FR', 'DE', 'IT']];
  assert.deepEqual(found(g, ANS), ['DE', 'FR']);
  assert.deepEqual(lockedSlots(g, ANS, null), ['FR', 'DE', null]);
  assert.deepEqual(lockedSlots([['AT', 'DE', 'PT']], ANS, 'FR'), ['FR', 'DE', null]);
  // Two found countries guessed in the same slot position: second goes to a free slot.
  assert.deepEqual(lockedSlots([['DE', 'AT', 'PT'], ['FR', 'IT', 'ES']], ANS, null), ['DE', 'FR', null]);
});

test('share text', () => {
  assert.equal(shareRow(['bad', 'near', 'good']), '🟩🟨⬛');
  const s = shareText(7, [['bad', 'good', 'near'], ['good', 'good', 'good']], true);
  assert.equal(s, 'Meridian Tripoint #7\n🟩🟨⬛\n🟩🟩🟩\n📍 2/4\nhttps://meridian.example/#/tripoint');
  const l = shareText(8, Array(4).fill(['bad', 'bad', 'good']), false).split('\n');
  assert.equal(l[0], 'Meridian Tripoint #8');
  assert.equal(l[5], '📍 X/4');
  assert.equal(bucket(true, 3), '3');
  assert.equal(bucket(false, 4), 'X');
  assert.equal(MAX_GUESSES, 4);
});

test('path decoding and scale bar', () => {
  assert.equal(pathOf([[10, 20, 1, -2, 3, 0]]), 'M10 20L11 18L14 18');
  assert.equal(pathOf([[0, 0, 5, 0, 0, 5]], true), 'M0 0L5 0L5 5Z');
  assert.equal(niceKm(57), 50);
  assert.equal(niceKm(190), 100);
  assert.equal(niceKm(200), 200);
});

// ---------- generated data ----------
const DATA = new URL('../public/data/tripoint/', import.meta.url);
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url)));
const byCode = new Map(countries.map((c) => [c.c, c]));

test('generated data is complete and consistent', { skip: !existsSync(new URL('index.json', DATA)) && 'run scripts/build-tripoint.mjs first' }, () => {
  const index = JSON.parse(readFileSync(new URL('index.json', DATA)));
  assert.ok(index.count >= 120 && index.count <= 200, `count ${index.count}`);
  assert.equal(index.puzzles.length, index.count);
  const seen = new Set();
  let gz = 0;
  for (let n = 0; n < index.count; n++) {
    const file = new URL(`p/${n}.json`, DATA);
    const size = statSync(file).size;
    assert.ok(size < 300 * 1024, `p/${n}.json is ${size} bytes`);
    const raw = readFileSync(file);
    gz += gzipSync(raw).length;
    const p = JSON.parse(raw);
    assert.equal(p.n, n);
    assert.equal(p.codes.length, 3);
    assert.equal(new Set(p.codes).size, 3);
    const key = p.codes.join('-');
    assert.ok(!seen.has(key), `duplicate triple ${key}`);
    seen.add(key);
    for (const c of p.codes) {
      assert.ok(byCode.has(c), `${c} missing from countries.json`);
      assert.ok(p.f[c]?.length > 0, `${key}: no fill for ${c}`);
    }
    // The three must be mutual neighbours in countries.json, otherwise 🟨 feedback would be inconsistent.
    const [a, b, d] = p.codes.map((c) => byCode.get(c));
    assert.ok(a.nb.includes(b.c) && a.nb.includes(d.c) && b.nb.includes(d.c), `${key} not mutual neighbours`);
    assert.ok(Math.abs(p.lat) < 75 && Math.abs(p.lon) <= 180);
    // Border lines must actually meet at the centre: several border vertices within 0.5 km of (0, 0).
    let atCentre = 0, nearView = 0;
    for (const l of p.b) {
      let x = 0, y = 0;
      for (let i = 0; i < l.length; i += 2) {
        x += l[i]; y += l[i + 1];
        const km = Math.hypot(x, y) * p.unit;
        if (km < 0.5) atCentre++;
        if (km < 150) nearView++;
      }
    }
    assert.ok(atCentre >= 2, `${key}: ${atCentre} border vertices at the centre`);
    assert.ok(nearView >= 3, `${key}: no border lines in the opening view`);
    assert.ok(p.c && p.l && p.r, 'hint layers present');
  }
  assert.ok(gz < 1.5 * 1024 * 1024, `total gzip ${gz}`);
  // Shuffled: early days are not alphabetical, and the first month is easier on average.
  const d = index.puzzles.map((p) => p.d);
  const avg = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(avg(d.slice(0, 30)) < avg(d.slice(30)), 'first 30 days should be easier');
});
