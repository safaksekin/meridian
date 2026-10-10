import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// src/ uses extensionless (bundler-style) imports and imports CSS: map both for Node.
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
const mem = new Map();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
});

const { compareLabels, encodeChallenge, decodeChallenge, challengeUrl, sanitizeName } = await import('../src/core/challenge.ts');

test('compareLabels: guess modes', () => {
  assert.equal(compareLabels('beeline', '2/6', '3/6'), 1);
  assert.equal(compareLabels('beeline', '4/6', '3/6'), -1);
  assert.equal(compareLabels('streets', '3/6', '3/6'), 0);
  assert.equal(compareLabels('hinterland', '6/6', 'X/6'), 1); // a solve beats a miss
  assert.equal(compareLabels('tripoint', 'X/4', '4/4'), -1);
  assert.equal(compareLabels('tripoint', 'X/4', 'X/4'), 0);
});

test('compareLabels: score modes', () => {
  assert.equal(compareLabels('mental', '74/100', '61/100'), 1);
  assert.equal(compareLabels('mental', '59/100', '61/100'), -1);
  assert.equal(compareLabels('mental', '80/100', '80/100'), 0);
  assert.equal(compareLabels('headcount', '98', '100'), -1);
  assert.equal(compareLabels('headcount', '100', '9'), 1); // numeric, not string order
  assert.equal(compareLabels('headcount', '42', '42'), 0);
});

test('compareLabels: malformed labels lose', () => {
  assert.equal(compareLabels('beeline', '2/6', 'junk'), 1);
  assert.equal(compareLabels('mental', 'junk', '10/100'), -1);
  assert.equal(compareLabels('mental', 'a', 'b'), 0);
});

test('sanitizeName', () => {
  assert.equal(sanitizeName('  Piri   Reis  '), 'Piri Reis');
  assert.equal(sanitizeName('<img src=x onerror=alert(1)>'), 'img srcx onerroraler'); // also capped at 20
  assert.equal(sanitizeName('Çağrı_ş-1.0'), 'Çağrı_ş-1.0');
  assert.equal(sanitizeName('x'.repeat(40)).length, 20);
  assert.equal(sanitizeName('🙂🙂'), '');
  assert.equal(sanitizeName(42), '');
});

test('token round-trip, unicode names, URL-safe', () => {
  const c = { m: 'beeline', d: 12, n: 'Gülşen Ö.', l: '3/6', w: true };
  const tok = encodeChallenge(c);
  assert.match(tok, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeChallenge(tok), { v: 1, ...c });
  const url = challengeUrl(c, 'https://x.test/app/');
  assert.equal(url, `https://x.test/app/?day=12&ch=${tok}#/beeline`);
  const back = new URL(url).searchParams.get('ch');
  assert.deepEqual(decodeChallenge(back), { v: 1, ...c });
});

test('decodeChallenge rejects malformed or hostile tokens', () => {
  const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
  const ok = { v: 1, m: 'mental', d: 3, n: 'Ana', l: '74/100', w: true };
  assert.ok(decodeChallenge(b64(ok)));
  for (const bad of [
    null, '', '!!!', 'a'.repeat(500), b64('not json'), b64('[1,2]'), b64('null'),
    b64({ ...ok, v: 2 }), b64({ ...ok, m: 'nope' }), b64({ ...ok, d: 0 }), b64({ ...ok, d: 1.5 }), b64({ ...ok, d: '3' }),
    b64({ ...ok, n: '' }), b64({ ...ok, n: '🙂' }), b64({ ...ok, l: '<b>' }), b64({ ...ok, m: 'beeline', l: '74/100' }),
    b64({ ...ok, w: 'yes' }), b64({ ...ok, l: 42 }),
  ]) {
    assert.equal(decodeChallenge(bad), null, String(bad));
  }
  // names are re-sanitized on decode
  assert.equal(decodeChallenge(b64({ ...ok, n: '<script>Ana</script>' })).n, 'scriptAnascript');
});
