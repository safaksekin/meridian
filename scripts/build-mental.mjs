// Builds public/data/mental/sets.json: daily sets of 7 countries for the Mental Map mode.
// Re-runnable and deterministic (fixed seed). Reads only public/data/countries.json.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const COUNTRIES = new URL('../public/data/countries.json', import.meta.url);
const OUT = new URL('../public/data/mental/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const all = JSON.parse(readFileSync(COUNTRIES, 'utf8'));
const byCode = new Map(all.map((c) => [c.c, c]));

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
const rand = mulberry32(20261010);

const rad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Sovereign, populated, not a micro-state. Non-sovereign-but-flagged entries are dropped explicitly.
const EXCLUDE = new Set(['AX', 'GG', 'JE', 'IM', 'HK', 'MO', 'AW', 'CW', 'SX', 'GL', 'FK', 'IO', 'VA', 'MC', 'SM', 'LI', 'AD', 'ST']);
const EXTRA = new Set(['VU', 'WS', 'TO', 'BH', 'MT', 'SG']); // small but well known in their region
function eligible(c) {
  if (!c || !c.sov || EXCLUDE.has(c.c)) return false;
  return EXTRA.has(c.c) || (c.pop >= 300_000 && c.area >= 1000);
}
/** How familiar a country is likely to be: soft in population and area. */
function fame(c) {
  return Math.pow(Math.max(c.pop, 1e5) / 1e6, 0.35) * Math.pow(Math.max(c.area, 300) / 1e5, 0.15);
}
const codes = (s) => s.split(' ');
const ofCont = (...conts) => all.filter((c) => conts.includes(c.cont)).map((c) => c.c);

const REGIONS = {
  europe: { codes: [...ofCont('Europe'), 'CY', 'TR'], minKm: 300 },
  africa: { codes: ofCont('Africa'), minKm: 300 },
  asia: { codes: codes('CN JP KR KP MN TW IN PK BD NP LK BT AF MM TH VN LA KH PH KZ'), minKm: 300 },
  mideast: { codes: codes('TR CY SY LB IL JO IQ IR SA YE OM AE QA KW BH EG AF PK KZ UZ TM KG TJ GE AM AZ'), minKm: 300 },
  americas: { codes: ofCont('North America', 'South America'), minKm: 300 },
  oceania: { codes: codes('AU NZ PG FJ SB VU WS TO ID MY PH TH VN KH LA MM SG BN TL'), minKm: 300 },
};
for (const r of Object.values(REGIONS)) r.pool = [...new Set(r.codes)].map((c) => byCode.get(c)).filter(eligible);

// World pool: hand-picked, widely known countries only.
const CONT = (c) => c.cont;
const worldPool = codes(
  'GB FR DE ES IT PT NL BE CH AT PL CZ SE NO FI DK IE IS GR UA RU RO HU ' +
    'EG MA DZ TN LY NG GH SN ET KE TZ ZA MG CD AO SD SO NA ZW ' +
    'TR CN JP KR KP MN IN PK BD NP LK AF IR IQ SA AE IL SY KZ UZ TH VN PH ID MY MM KH ' +
    'US CA MX CU GT PA JM CR BR AR CL PE CO VE BO EC UY PY AU NZ PG FJ',
).map((c) => byCode.get(c)).filter(eligible);

const PER_REGION = 46;
const WORLD = 125;
const uses = new Map();
const accepted = [];

function weightedPick(pool, region) {
  const w = pool.map((c) => fame(c) / (1 + 0.6 * (uses.get(region + c.c) || 0)));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r <= 0) return pool[i];
  }
  return pool[pool.length - 1];
}

function tryBuild(pool, region, minKm) {
  const set = [];
  for (let guard = 0; set.length < 7 && guard < 400; guard++) {
    const c = weightedPick(pool, region);
    if (set.includes(c)) continue;
    if (set.some((s) => km(s, c) < minKm)) continue;
    set.push(c);
  }
  return set.length === 7 ? set : null;
}

function nearDuplicate(set) {
  const s = new Set(set.map((c) => c.c));
  return accepted.some((a) => a.codes.filter((c) => s.has(c)).length >= 5);
}

function generate(region, n, pool, minKm, extraOk = () => true) {
  let made = 0;
  for (let attempt = 0; made < n && attempt < 20000; attempt++) {
    const set = tryBuild(pool, region, minKm);
    if (!set || !extraOk(set) || nearDuplicate(set)) continue;
    for (const c of set) uses.set(region + c.c, (uses.get(region + c.c) || 0) + 1);
    accepted.push({ region, codes: set.map((c) => c.c) });
    made++;
  }
  if (made < n) throw new Error(`${region}: only ${made}/${n} sets`);
}

generate('world', WORLD, worldPool, 1500, (set) => new Set(set.map(CONT)).size >= 4);
for (const [region, r] of Object.entries(REGIONS)) generate(region, PER_REGION, r.pool, r.minKm);

// Shuffle (Fisher-Yates), then avoid the same theme on consecutive days where possible.
for (let i = accepted.length - 1; i > 0; i--) {
  const j = Math.floor(rand() * (i + 1));
  [accepted[i], accepted[j]] = [accepted[j], accepted[i]];
}
for (let i = 1; i < accepted.length; i++) {
  if (accepted[i].region !== accepted[i - 1].region) continue;
  const j = accepted.findIndex((s, k) => k > i && s.region !== accepted[i - 1].region && (k + 1 >= accepted.length || accepted[k + 1].region !== accepted[i].region) && accepted[k - 1].region !== accepted[i].region);
  if (j > 0) [accepted[i], accepted[j]] = [accepted[j], accepted[i]];
}
// Chip order inside a set is shuffled too, so the biggest country is not always first.
for (const s of accepted) {
  for (let i = s.codes.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [s.codes[i], s.codes[j]] = [s.codes[j], s.codes[i]];
  }
}

const json = JSON.stringify(accepted);
writeFileSync(new URL('sets.json', OUT), json);

// Summary
const regionCount = {};
for (const s of accepted) regionCount[s.region] = (regionCount[s.region] || 0) + 1;
let consecutive = 0;
for (let i = 1; i < accepted.length; i++) if (accepted[i].region === accepted[i - 1].region) consecutive++;
const used = new Map();
for (const s of accepted) for (const c of s.codes) used.set(c, (used.get(c) || 0) + 1);
const top = [...used].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c}:${n}`).join(' ');
console.log(`mental: ${accepted.length} sets, ${json.length} bytes`);
console.log('  by theme:', Object.entries(regionCount).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  pools:', Object.entries(REGIONS).map(([k, r]) => `${k} ${r.pool.length}`).join(', '), `world ${worldPool.length}`);
console.log(`  distinct countries used: ${used.size}; most used: ${top}`);
console.log(`  same theme on consecutive days: ${consecutive}`);
console.log('  day 1:', accepted[0].region, accepted[0].codes.join(' '));
