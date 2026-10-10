import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// src/ uses extensionless (bundler-style) imports: let Node resolve them to .ts files.
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    } catch (err) {
      if (spec.startsWith('.') && !/\.\w+$/.test(spec)) return next(`${spec}.ts`, ctx);
      throw err;
    }
  },
  load(url, ctx, next) {
    if (url.endsWith('.css')) return { format: 'module', source: '', shortCircuit: true };
    return next(url, ctx);
  },
});

// In-memory localStorage so storage.ts works under Node.
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
});

const P = await import('../src/core/progress.ts');
const { xpFor, levelFor, levelStartXp, levelTitle, computeProgress, parseLabel, MODE_IDS } = P;

test('xpFor: guess modes', () => {
  assert.equal(xpFor('beeline', true, '1/6'), 150); // 40+60+50
  assert.equal(xpFor('beeline', true, '2/6'), 140);
  assert.equal(xpFor('beeline', true, '6/6'), 100);
  assert.equal(xpFor('beeline', false, 'X/6'), 40);
  assert.equal(xpFor('tripoint', true, '1/4'), 130);
  assert.equal(xpFor('streets', true, '3/6'), 130);
  assert.equal(xpFor('hinterland', false, 'X/6'), 40);
});

test('xpFor: score modes and cap', () => {
  assert.equal(xpFor('mental', true, '74/100'), 137);
  assert.equal(xpFor('mental', false, '41/100'), 60);
  assert.equal(xpFor('mental', true, '100/100'), 150);
  assert.equal(xpFor('headcount', true, '98'), 149);
  assert.equal(xpFor('headcount', false, '0'), 40);
  assert.equal(xpFor('headcount', true, '100'), 150);
});

test('xpFor: malformed labels only earn base + win', () => {
  assert.equal(xpFor('beeline', true, 'banana'), 100);
  assert.equal(xpFor('mental', false, ''), 40);
  assert.equal(parseLabel('beeline', '7/6'), null);
});

test('levels and titles', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8].map(levelStartXp), [0, 300, 800, 1600, 3000, 5000, 7500, 10000]);
  assert.equal(levelFor(0), 1);
  assert.equal(levelFor(299), 1);
  assert.equal(levelFor(300), 2);
  assert.equal(levelFor(1599), 3);
  assert.equal(levelFor(5000), 6);
  assert.equal(levelFor(7499), 6);
  assert.equal(levelFor(7500), 7);
  assert.equal(levelTitle(1, 'en'), 'Apprentice Mapper');
  assert.equal(levelTitle(1, 'tr'), 'Çırak Haritacı');
  assert.equal(levelTitle(4, 'tr'), 'Kartograf');
  assert.equal(levelTitle(6, 'en'), 'Meridian Master');
  assert.equal(levelTitle(7, 'tr'), 'Meridyen Ustası II');
});

const win = (label) => ({ won: true, label });

test('computeProgress: empty', () => {
  const s = computeProgress({}, 10, 2, 'en');
  assert.equal(s.xp, 0);
  assert.equal(s.level, 1);
  assert.equal(s.levelTitle, 'Apprentice Mapper');
  assert.equal(s.levelStartXp, 0);
  assert.equal(s.nextLevelXp, 300);
  assert.equal(s.streak, 0);
  assert.equal(s.bestStreak, 0);
  assert.equal(s.todayDone, 0);
  assert.equal(s.week.length, 7);
  assert.deepEqual(s.week.map((d) => d.label), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  assert.deepEqual(s.week.map((d) => d.today), [false, false, true, false, false, false, false]);
  assert.deepEqual(s.week.map((d) => d.future), [false, false, false, true, true, true, true]);
});

test('computeProgress: xp, today, streaks, week', () => {
  // today = day 20 on a Thursday (index 3): week covers days 17..23
  const histories = {
    beeline: { 20: win('2/6'), 19: win('1/6'), 18: { won: false, label: 'X/6' }, 10: win('3/6') },
    mental: { 20: win('74/100'), 11: win('80/100'), 12: win('60/100') },
    headcount: { 9: win('98'), 25: win('90') /* future day: ignored */ },
  };
  const s = computeProgress(histories, 20, 3, 'tr');
  assert.equal(s.todayDone, 2);
  assert.equal(s.todayXp, 140 + 137);
  const expected = 140 + 150 + 40 + 130 + 137 + 140 + 130 + 149;
  assert.equal(s.xp, expected);
  assert.equal(s.level, levelFor(expected));
  assert.equal(s.streak, 3); // 18, 19, 20
  assert.equal(s.bestStreak, 4); // 9, 10, 11, 12
  assert.deepEqual(s.week.map((d) => d.label), ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz']);
  assert.deepEqual(s.week.map((d) => d.played), [false, true, true, true, false, false, false]);
  assert.equal(s.week[3].today, true);
});

test('computeProgress: streak survives until the end of the next day', () => {
  const h = { streets: { 5: win('1/6'), 6: win('2/6') } };
  assert.equal(computeProgress(h, 7, 0).streak, 2); // nothing yet today: yesterday still counts
  assert.equal(computeProgress(h, 8, 0).streak, 0); // a missed day breaks it
  assert.equal(computeProgress(h, 8, 0).bestStreak, 2);
});

test('mode ids match the registry', async () => {
  const { MODES } = await import('../src/modes/registry.ts');
  assert.deepEqual([...MODE_IDS].sort(), MODES.map((m) => m.id).sort());
});

test('progressSummary reads real daily results from storage, ignores practice rounds', async () => {
  const { recordResult } = await import('../src/core/storage.ts');
  const { todayNumber } = await import('../src/core/daily.ts');
  const today = todayNumber();
  mem.clear();
  recordResult('beeline', today, true, '2', '2/6');
  recordResult('beeline', today, true, '1', '1/6'); // second record of the same day is ignored
  recordResult('mental', today + 3, true, '75+', '80/100'); // practice round: not today
  recordResult('headcount', today, false, '<60', '42');
  const s = P.progressSummary();
  assert.equal(s.todayDone, 2);
  assert.equal(s.todayXp, 140 + 61);
  assert.equal(s.xp, 201);
  assert.equal(s.streak, 1);
  assert.equal(s.bestStreak, 1);
  assert.equal(s.week.filter((d) => d.today).length, 1);
  assert.ok(s.week.find((d) => d.today).played);
  mem.clear();
});
