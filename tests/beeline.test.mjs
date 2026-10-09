import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreRow, isSolved, solvedPrefix, windName, pad3, emojiRow } from '../src/modes/beeline/logic.ts';

const puzzles = JSON.parse(readFileSync(new URL('../public/data/beeline/puzzles.json', import.meta.url)));
const countries = new Set(JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url))).map((c) => c.c));

test('scoreRow gives Wordle-style tiles', () => {
  const ans = ['IT', 'GR', 'LB', 'SY', 'IQ'];
  assert.deepEqual(scoreRow(['FR', 'IT', 'GR', 'TR', 'CY'], ans), ['bad', 'near', 'near', 'bad', 'bad']);
  assert.deepEqual(scoreRow(ans, ans), ['good', 'good', 'good', 'good', 'good']);
});

test('solvedPrefix counts slots solved in any row', () => {
  const ans = ['A', 'B', 'C', 'D', 'E'];
  assert.equal(solvedPrefix([], ans), 0);
  assert.equal(solvedPrefix([['A', 'X', 'C', 'Y', 'Z'], ['Q', 'B', 'W', 'Y', 'Z']], ans), 3);
  assert.ok(isSolved([['A', 'B', 'C', 'D', 'E']], ans));
});

test('compass helpers', () => {
  assert.equal(windName(90, 'en'), 'E');
  assert.equal(windName(337.5, 'tr'), 'KKB');
  assert.equal(windName(359, 'en'), 'N');
  assert.equal(pad3(5), '005');
  assert.equal(emojiRow(['good', 'near', 'bad']), '🟩🟨⬛');
});

test('generated puzzles are valid', () => {
  assert.ok(puzzles.length >= 365, `only ${puzzles.length} puzzles`);
  for (const p of puzzles) {
    assert.equal(p.hits.length, 5);
    const codes = p.hits.map((h) => h.c);
    assert.equal(new Set(codes).size, 5, 'distinct countries');
    assert.ok(!codes.includes(p.cc), 'start country excluded');
    for (const c of [...codes, p.cc]) assert.ok(countries.has(c), `unknown ${c}`);
    for (let i = 1; i < 5; i++) assert.ok(p.hits[i].km > p.hits[i - 1].km, 'ordered by distance');
    assert.ok(p.hits[4].km <= 9000);
    assert.ok(p.path.length >= 2);
  }
});

test('no start country on consecutive days', () => {
  let same = 0;
  for (let i = 1; i < puzzles.length; i++) if (puzzles[i].cc === puzzles[i - 1].cc) same++;
  assert.ok(same <= 3, `${same} repeats`);
});
