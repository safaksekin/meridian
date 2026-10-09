// Builds public/data/hinterland/: daily "guess the country from its village names" puzzles.
// Source: GeoNames cities500 (CC BY 4.0) + admin1CodesASCII (downloaded on first run).
// Usage: node scripts/build-hinterland.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { geoContains } from 'd3-geo';
import { loadFeatures, mergeByCode } from './lib/countries-src.mjs';

const RAW = new URL('../data-raw/', import.meta.url);
const OUT = new URL('../public/data/hinterland/', import.meta.url);
const SEED = 20261010;
const N_TARGET = 400; // at least 365 puzzles
const MAX_PER_COUNTRY = 8;
const MIN_GAP_DAYS = 30;
const MIN_NAMES = 60;
const CODES = new Set(['PPL', 'PPLA2', 'PPLA3', 'PPLA4']);

// ---------- Language families (main language of the country; for most of Sub-Saharan Africa the
// dominant indigenous language, since that is what the village names are in). ----------
const FAMILY_TABLE = {
  germanic:
    'AX AG AI AU AT BS BB BZ BM VG CA KY CH DE DK FK FO GB GG GD GU GY IE IM IO IS JE JM KN LC LI LU MP MS NF NL NO NZ PN SE SH SG SR SX TC TT US VC VI DM BE',
  romance: 'AD AR AW BL BO BR CL CO CR CU CV CW DO EC ES FR GT HN HT IT MC MD MF MU MX NC NI PA PE PF PM PR PT PY RO SC SM ST SV UY VA VE',
  slavic: 'BA BG BY CZ HR ME MK PL RS RU SI SK UA',
  baltic: 'LT LV',
  hellenic: 'GR CY',
  albanian: 'AL XK',
  armenian: 'AM',
  kartvelian: 'GE',
  uralic: 'EE FI HU',
  turkic: 'AZ KG KZ TM TR UZ',
  mongolic: 'MN',
  iranian: 'AF IR TJ',
  indoaryan: 'BD IN LK MV NP PK',
  sinotibetan: 'BT CN HK MM MO TW',
  taikadai: 'LA TH',
  austroasiatic: 'KH VN',
  japonic: 'JP',
  koreanic: 'KP KR',
  austronesian: 'AS BN CK FJ FM ID KI MG MH MY NR NU PH PW SB TL TO TV VU WF WS',
  papuan: 'PG',
  semitic: 'AE BH DZ EG EH ER ET IL IQ JO KW LB LY MA MR MT OM PS QA SA SD SY TD TN YE',
  cushitic: 'DJ SO',
  chadic: 'NE',
  nilosaharan: 'SS',
  bantu: 'AO BI BW CD CG CM GA GQ KE KM LS MW MZ NA RW SZ TZ UG ZA ZM ZW',
  nigercongo: 'BF BJ CF CI GH GM GN GW LR ML NG SL SN TG',
  eskimoaleut: 'GL',
};
const FAMILY = {};
for (const [fam, list] of Object.entries(FAMILY_TABLE)) {
  for (const c of list.split(/\s+/)) {
    if (!/^[A-Z]{2}$/.test(c)) continue;
    if (FAMILY[c]) throw new Error(`family listed twice: ${c}`);
    FAMILY[c] = fam;
  }
}

// Common English words: a name made only of these is "mostly a generic English word" (Hope, Green River…).
const GENERIC = new Set(
  `the of and a an on in at by upon under over new old north south east west upper lower middle central great little big long high
  low grand mount mountain mountains hill hills valley vale river creek brook lake lakes pond spring springs falls fall bay beach
  harbour harbor port point island isle rock rocks stone ridge view park garden gardens green wood woods forest grove field fields
  meadow meadows farm ranch mill mills bridge ford cross crossing corner corners junction center centre city town village station
  church chapel castle hall house home haven heights plains plain prairie desert canyon glen dale cove cape head end gate gates way
  road street lane market square red white black blue brown gold golden silver iron copper coal salt pine oak oaks elm cedar maple
  birch ash willow willows rose roses lily palm palms sun sunny star moon summit liberty union independence freedom hope faith
  victory peace harmony unity concord charity providence pleasant fair fairview bellevue clear sweet good rich royal victoria
  prospect enterprise progress success eden paradise eureka pleasant summer winter christmas day spring sandy rocky mill landing
  lodge camp fort garrison mission school academy college plantation estate settlement colony hamlet chester orange lemon apple
  cherry plum berry hope wells well water waters bluff bluffs flat flats sand sands bank banks shore shores sea ocean marsh moor
  heath common commons acre acres grange crown king kings queen queens prince princess bishop abbey temple tower towers manor
  court place grace glory dawn evening morning sunrise sunset rainbow welcome friendship harmony patience content comfort
  happy lucky silent quiet lone lonely wild deer bear buffalo eagle hawk crow raven fox wolf beaver otter bull horse cattle sheep
  goat lion tiger elephant crystal diamond pearl ruby marble granite flint chalk clay mud dry wet cold hot warm long short
  broad wide narrow deep shallow round square triangle twin twins three four five seven nine first second third last half`
    .split(/\s+/)
    .filter(Boolean),
);

// ---------- Helpers ----------
const SPECIAL = { ł: 'l', ø: 'o', đ: 'd', ß: 'ss', æ: 'ae', œ: 'oe', ı: 'i', þ: 'th', ð: 'd', ħ: 'h', ŀ: 'l', ŧ: 't' };
function fold(s) {
  return s
    .toLowerCase()
    .replace(/[łøđßæœıþðħŀŧ]/g, (c) => SPECIAL[c])
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
const R = 6371.0088;
const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
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
const rand = mulberry32(SEED);
function shuffle(arr, rnd = rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- Inputs ----------
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url)));
const byCode = new Map(countries.map((c) => [c.c, c]));

const info = new Map();
for (const line of readFileSync(new URL('countryInfo.txt', RAW), 'utf8').split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const f = line.split('\t');
  info.set(f[0], { name: f[4], capital: f[5], langs: f[15] });
}

async function ensureAdmin1() {
  const dest = new URL('admin1CodesASCII.txt', RAW);
  if (existsSync(dest)) return dest;
  try {
    process.stdout.write('fetch admin1CodesASCII.txt ... ');
    const res = await fetch('https://download.geonames.org/export/dump/admin1CodesASCII.txt', {
      headers: { 'User-Agent': 'geo-daily-build/0.1' },
    });
    if (!res.ok) throw new Error(String(res.status));
    writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
    return dest;
  } catch (e) {
    console.log(`failed (${e.message}); building without admin-1 names`);
    return null;
  }
}
const admin1 = new Map();
const admin1File = await ensureAdmin1();
if (admin1File) {
  for (const line of readFileSync(admin1File, 'utf8').split('\n')) {
    if (!line) continue;
    const f = line.split('\t');
    admin1.set(f[0], f[1]);
  }
}

// ---------- 1. Parse GeoNames ----------
const nameCountries = new Map(); // folded name -> Set of GeoNames country codes (any feature, any size)
const rows = [];
for (const line of readFileSync(new URL('cities500.txt', RAW), 'utf8').split('\n')) {
  if (!line) continue;
  const f = line.split('\t');
  const cc = f[8];
  for (const n of [f[1], f[2]]) {
    const k = fold(n);
    if (!k) continue;
    if (!nameCountries.has(k)) nameCountries.set(k, new Set());
    nameCountries.get(k).add(cc);
  }
  const pop = +f[14];
  if (!CODES.has(f[7]) || pop < 500 || pop > 20000 || !byCode.has(cc)) continue;
  rows.push({ n: f[1].trim(), lat: +f[4], lon: +f[5], cc, a1: f[10], pop });
}

// ---------- 2. Eligibility filters ----------
const reasons = {};
const reject = (r) => ((reasons[r] = (reasons[r] || 0) + 1), false);
const blockers = new Map(); // cc -> folded strings that must not appear in a name
for (const c of countries) {
  const i = info.get(c.c);
  const list = [c.en, c.tr, ...(c.al || []), i?.name, i?.capital].filter(Boolean).map(fold).filter((s) => s.length >= 4);
  blockers.set(c.c, [...new Set(list)]);
}
function eligible(r) {
  const n = r.n;
  if (/[0-9()[\]/,]/.test(n)) return reject('digits/punct');
  if ([...n].length > 22) return reject('too long');
  if (!/\p{L}/u.test(n) || /[^\p{Script=Latin}\s'’ʻʼ\-.\u0300-\u036f]/u.test(n)) return reject('non-latin');
  const k = fold(n);
  if (k.length < 3) return reject('too short');
  if ([...nameCountries.get(k)].some((cc) => cc !== r.cc)) return reject('other country');
  const padded = ` ${k} `;
  if (blockers.get(r.cc).some((b) => padded.includes(b))) return reject('country/capital');
  const words = k.split(' ').filter((w) => w.length > 1);
  if (words.length && words.every((w) => GENERIC.has(w))) return reject('generic english');
  return true;
}
const perCountry = new Map(); // cc -> Map(folded -> row with highest pop)
for (const r of rows) {
  if (!eligible(r)) continue;
  if (!perCountry.has(r.cc)) perCountry.set(r.cc, new Map());
  const m = perCountry.get(r.cc);
  const k = fold(r.n);
  if (!m.has(k) || m.get(k).pop < r.pop) m.set(k, r);
}
const classes = [...perCountry.keys()].sort();
const cIndex = new Map(classes.map((c, i) => [c, i]));
const allNames = classes.flatMap((c) => [...perCountry.get(c).values()]);

// ---------- 3. Naive Bayes over character 1–4-grams (leave-one-out scoring) ----------
function grams(name) {
  const s = `^${name.toLowerCase()}$`;
  const out = [];
  for (let n = 1; n <= 4; n++) for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}
const counts = new Map(); // gram -> Map(classIdx -> count)
const totals = new Float64Array(classes.length);
for (const r of allNames) {
  const ci = cIndex.get(r.cc);
  r.grams = grams(r.n);
  for (const g of r.grams) {
    let m = counts.get(g);
    if (!m) counts.set(g, (m = new Map()));
    m.set(ci, (m.get(ci) || 0) + 1);
  }
  totals[ci] += r.grams.length;
}
const V = counts.size;
const ALPHA = 0.1;
const logA = Math.log(ALPHA);
/** Posterior probability of the true class (uniform prior), excluding the name itself from training. */
function posterior(r) {
  const ci = cIndex.get(r.cc);
  const own = new Map();
  for (const g of r.grams) own.set(g, (own.get(g) || 0) + 1);
  const L = r.grams.length;
  const lp = new Float64Array(classes.length);
  for (let c = 0; c < classes.length; c++) {
    const tot = totals[c] - (c === ci ? L : 0);
    lp[c] = L * (logA - Math.log(tot + ALPHA * V));
  }
  for (const [g, k] of own) {
    for (const [c, cnt] of counts.get(g)) {
      const n = c === ci ? cnt - k : cnt;
      if (n > 0) lp[c] += k * (Math.log(n + ALPHA) - logA);
    }
  }
  let max = -Infinity;
  for (const v of lp) if (v > max) max = v;
  let sum = 0;
  for (const v of lp) sum += Math.exp(v - max);
  return Math.exp(lp[ci] - max) / sum;
}

// ---------- 4. Pool ----------
// Hong Kong's GeoNames "villages" are mostly housing estates ("… Court", "… Estate"): not hinterland.
const EXCLUDE = new Set(['HK']);
const pool = classes.filter((c) => perCountry.get(c).size >= MIN_NAMES && FAMILY[c] && !EXCLUDE.has(c));
const missingFam = classes.filter((c) => perCountry.get(c).size >= MIN_NAMES && !FAMILY[c]);
if (missingFam.length) throw new Error(`no language family for ${missingFam.join(' ')}`);
let scored = 0;
const cand = new Map(); // cc -> names sorted by posterior ascending
for (const c of pool) {
  const list = [...perCountry.get(c).values()];
  for (const r of list) {
    r.p = posterior(r);
    scored++;
  }
  list.sort((a, b) => a.p - b.p || a.n.localeCompare(b.n));
  cand.set(c, list);
}

// ---------- 5. Toponym pattern: most common distinctive ending ----------
function endings(name) {
  const w = name.toLowerCase().split(/[\s-]+/).pop() || '';
  const out = [];
  if (GENERIC.has(fold(w))) return out; // "… Village", "… Estate" are not toponym patterns
  for (let n = 3; n <= 5; n++) if ([...w].length > n + 1) out.push([...w].slice(-n).join(''));
  return out;
}
const globalEnd = new Map();
for (const r of allNames) for (const e of new Set(endings(r.n))) globalEnd.set(e, (globalEnd.get(e) || 0) + 1);
const patterns = {};
for (const c of pool) {
  const list = cand.get(c);
  const m = new Map();
  for (const r of list) for (const e of new Set(endings(r.n))) m.set(e, (m.get(e) || 0) + 1);
  let best = null;
  for (const [e, k] of m) {
    const share = k / list.length;
    const lift = share / (globalEnd.get(e) / allNames.length);
    if (share < 0.06 || lift < 4 || !/^\p{L}+$/u.test(e)) continue;
    const score = share * Math.log(lift) * Math.sqrt(e.length);
    if (!best || score > best.score) best = { e, share, score };
  }
  if (best) patterns[c] = { s: best.e, pct: Math.round(best.share * 100) };
}

// ---------- 6. Allocation: more puzzles for populous countries ----------
const weight = (c) => Math.sqrt(Math.max(1, byCode.get(c).pop));
function allocate(K) {
  return new Map(pool.map((c) => [c, Math.max(1, Math.min(MAX_PER_COUNTRY, Math.round(K * weight(c))))]));
}
let lo = 0, hi = 1;
const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
while (total(allocate(hi)) < N_TARGET) hi *= 2;
for (let i = 0; i < 60; i++) {
  const mid = (lo + hi) / 2;
  if (total(allocate(mid)) >= N_TARGET) hi = mid;
  else lo = mid;
}
const alloc = allocate(hi);
// Never ask for more puzzles than a country can fill with unused names.
for (const c of pool) alloc.set(c, Math.min(alloc.get(c), Math.floor(cand.get(c).length / 6)));

// ---------- 7. Name selection ----------
// GeoNames sometimes files places under another country (e.g. Akrotiri, Cyprus, as GB). Only use names
// that lie inside the country's Natural Earth shape (with ~8 km tolerance for coastal places).
const shapes = new Map(mergeByCode(loadFeatures('10m')).map((f) => [f.code, { type: 'Feature', properties: {}, geometry: f.geometry }]));
const insideMemo = new Map();
let outside = 0;
function inCountry(r) {
  if (insideMemo.has(r)) return insideMemo.get(r);
  const f = shapes.get(r.cc);
  const d = 0.08;
  const probes = [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d], [d, -d], [-d, d]];
  const ok = !f || probes.some(([x, y]) => geoContains(f, [r.lon + x, r.lat + y]));
  if (!ok) { outside++; if (process.env.HL_DEBUG) console.log("outside", r.cc, r.n, r.lat, r.lon); }
  insideMemo.set(r, ok);
  return ok;
}
const SLOTS = [0.04, 0.22, 0.42, 0.62, 0.8, 0.96];
function pickSix(c, used) {
  const list = cand.get(c);
  const n = list.length;
  for (const minKm of [30, 20, 12, 6, 3, 0]) {
    const chosen = [];
    for (const q of SLOTS) {
      let pick = null;
      for (let w = 0.07; w <= 0.5 && !pick; w += 0.05) {
        const lo = Math.max(0, Math.floor((q - w) * n));
        const hi = Math.min(n - 1, Math.ceil((q + w) * n));
        const pool = [];
        for (let i = lo; i <= hi; i++) {
          const r = list[i];
          if (used.has(r) || chosen.includes(r) || !inCountry(r)) continue;
          if (chosen.some((o) => km(o, r) < minKm)) continue;
          pool.push(r);
        }
        if (!pool.length) continue;
        // Among a few random candidates, take the one farthest from the names already chosen.
        const sample = shuffle(pool).slice(0, 10);
        let bestD = -1;
        for (const r of sample) {
          const d = chosen.length ? Math.min(...chosen.map((o) => km(o, r))) : 0;
          if (d > bestD) (bestD = d), (pick = r);
        }
      }
      if (!pick) break;
      chosen.push(pick);
    }
    if (chosen.length === 6) {
      for (const r of chosen) used.add(r);
      return { names: chosen.sort((a, b) => a.p - b.p), minKm };
    }
  }
  throw new Error(`could not pick six names for ${c}`);
}

const puzzlesBy = new Map();
const relaxed = [];
for (const c of pool) {
  const used = new Set();
  const list = [];
  for (let i = 0; i < alloc.get(c); i++) {
    const { names, minKm } = pickSix(c, used);
    if (minKm < 30) relaxed.push(`${c}:${minKm}km`);
    list.push({
      country: c,
      names: names.map((r) => {
        const o = { n: r.n, lat: +r.lat.toFixed(3), lon: +r.lon.toFixed(3) };
        const a = admin1.get(`${r.cc}.${r.a1}`)?.replace(/ (Department|Province|Region|Governorate|Prefecture|District)$/, '');
        if (a) o.admin1 = a;
        return o;
      }),
      ...(patterns[c] ? { pat: patterns[c] } : {}),
      _p: names.map((r) => r.p),
    });
  }
  puzzlesBy.set(c, list);
}

// ---------- 8. Schedule: fixed-seed order, no country twice within MIN_GAP_DAYS (cyclic) ----------
function schedule(seed) {
  const rnd = mulberry32(seed);
  const remaining = new Map([...puzzlesBy].map(([c, l]) => [c, l.length]));
  const N = total(remaining);
  const last = new Map();
  const first = new Map();
  const used = new Map();
  const ideal = new Map();
  for (const [c, k] of remaining) {
    const phase = rnd() * (N / k);
    ideal.set(c, Array.from({ length: k }, (_, i) => phase + (i * N) / k + rnd() * 3));
  }
  const order = [];
  for (let day = 0; day < N; day++) {
    const ok = [...remaining].filter(([c, k]) => {
      if (k <= 0) return false;
      if (last.has(c) && day - last.get(c) < MIN_GAP_DAYS) return false;
      // The list is cyclic: the end must also be far enough from the country's first day.
      if (first.has(c) && N - day + first.get(c) < MIN_GAP_DAYS) return false;
      return true;
    });
    if (!ok.length) return null;
    // Earliest-deadline-first over evenly spaced ideal days (random phase per country), so big and
    // small countries are mixed from day 1 and repeats of a country are spread over the year.
    let best = Infinity, pick = ok[0][0];
    for (const [c] of ok) {
      const d = ideal.get(c)[used.get(c) || 0];
      if (d < best) (best = d), (pick = c);
    }
    used.set(pick, (used.get(pick) || 0) + 1);
    order.push(pick);
    remaining.set(pick, remaining.get(pick) - 1);
    last.set(pick, day);
    if (!first.has(pick)) first.set(pick, day);
  }
  return order;
}
let order = null;
let tries = 0;
for (let s = SEED; !order && s < SEED + 5000; s++, tries++) order = schedule(s);
if (!order) throw new Error('could not schedule puzzles');
const queues = new Map([...puzzlesBy].map(([c, l]) => [c, shuffle([...l])]));
const puzzles = order.map((c) => queues.get(c).shift());

// ---------- 9. Write ----------
mkdirSync(OUT, { recursive: true });
const pAvg = (i) => puzzles.reduce((a, p) => a + p._p[i], 0) / puzzles.length;
const firstLast = SLOTS.map((_, i) => pAvg(i).toFixed(3));
for (const p of puzzles) delete p._p;
writeFileSync(new URL('puzzles.json', OUT), JSON.stringify(puzzles));
writeFileSync(new URL('families.json', OUT), JSON.stringify(FAMILY));
const size = (f) => readFileSync(new URL(f, OUT)).length;

// ---------- Summary ----------
const top = [...alloc].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, k]) => `${c}×${k}`).join(' ');
console.log(`rows in size range: ${rows.length}; rejected: ${JSON.stringify(reasons)}`);
console.log(`eligible unique names: ${allNames.length} in ${classes.length} countries; scored ${scored} pool names (${V} n-grams)`);
console.log(`pool: ${pool.length} countries with >= ${MIN_NAMES} names: ${pool.join(' ')}`);
console.log(`puzzles: ${puzzles.length} (most frequent: ${top}); mean P(true country) by clue #1..#6: ${firstLast.join(' ')}`);
console.log(`schedule seed tries: ${tries}; candidates skipped as outside their country's shape: ${outside}`);
console.log(`relaxed spacing: ${relaxed.length ? relaxed.join(' ') : 'none'}`);
console.log(`patterns for ${Object.keys(patterns).length} countries, e.g. ${Object.entries(patterns).slice(0, 6).map(([c, p]) => `${c} -${p.s} ${p.pct}%`).join(', ')}`);
console.log(`wrote puzzles.json ${(size('puzzles.json') / 1024).toFixed(1)} KB, families.json ${(size('families.json') / 1024).toFixed(1)} KB`);
