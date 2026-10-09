// Builds public/data/countries.json (names, label points, area, neighbours)
// and public/data/world.json (simplified TopoJSON for display).
import { writeFileSync, mkdirSync } from 'node:fs';
import { topology } from 'topojson-server';
import { presimplify, simplify, quantile } from 'topojson-simplify';
import { neighbors } from 'topojson-client';
import { geoArea } from 'd3-geo';
import { loadFeatures, mergeByCode } from './lib/countries-src.mjs';

const OUT = new URL('../public/data/', import.meta.url);
mkdirSync(OUT, { recursive: true });

// Turkish names that Natural Earth leaves empty or awkward.
const TR_FIX = { CN: 'Çin', AQ: 'Antarktika', XK: 'Kosova', PS: 'Filistin', TW: 'Tayvan', EH: 'Batı Sahra', CY: 'Kıbrıs', SO: 'Somali', US: 'Amerika Birleşik Devletleri', GB: 'Birleşik Krallık', CZ: 'Çekya', MK: 'Kuzey Makedonya', CD: 'Kongo Demokratik Cumhuriyeti', CG: 'Kongo Cumhuriyeti', CI: 'Fildişi Sahili', SZ: 'Esvatini', MM: 'Myanmar', TL: 'Doğu Timor', CV: 'Yeşil Burun Adaları' };
const EN_FIX = { CN: 'China', PS: 'Palestine', AQ: 'Antarctica', CY: 'Cyprus', SO: 'Somalia', US: 'United States', GB: 'United Kingdom', CZ: 'Czechia', SZ: 'Eswatini', CI: "Côte d'Ivoire", TR: 'Türkiye', CD: 'DR Congo', CG: 'Republic of the Congo', MK: 'North Macedonia', TL: 'Timor-Leste', CV: 'Cape Verde', FM: 'Micronesia', KR: 'South Korea', KP: 'North Korea', LA: 'Laos', VA: 'Vatican City', BS: 'Bahamas', GM: 'Gambia' };
// Extra search aliases (lowercase, accent-free).
const ALIAS = { US: ['usa', 'america', 'abd', 'amerika'], GB: ['uk', 'britain', 'england', 'ingiltere', 'great britain'], AE: ['uae', 'bae'], CD: ['drc', 'kongo dc', 'zaire'], KR: ['korea', 'kore'], RU: ['russia', 'rusya'], NL: ['holland', 'hollanda'], CZ: ['czech republic', 'cek cumhuriyeti'], MM: ['burma', 'burma'], TR: ['turkey', 'turkiye'], CI: ['ivory coast'], SZ: ['swaziland', 'svaziland'], CV: ['cabo verde'], VA: ['holy see'], TL: ['east timor'], MK: ['macedonia', 'makedonya'], BA: ['bosnia', 'bosna'] };

const feats = mergeByCode(loadFeatures('50m'));
const topo = topology(Object.fromEntries([['countries', { type: 'FeatureCollection', features: feats.map(f => ({ type: 'Feature', id: f.code, properties: {}, geometry: f.geometry })) }]]), 1e5);

// Neighbours from shared arcs (on the 50m topology: good enough and consistent with display).
const geoms = topo.objects.countries.geometries;
const nb = neighbors(geoms);

const countries = feats.map((f, i) => {
  const p = f.props;
  return {
    c: f.code,
    en: EN_FIX[f.code] || p.NAME_EN || p.ADMIN,
    tr: TR_FIX[f.code] || p.NAME_TR || p.NAME_EN,
    lat: +(+p.LABEL_Y).toFixed(3),
    lon: +(+p.LABEL_X).toFixed(3),
    cont: p.CONTINENT,
    sov: p.TYPE === 'Sovereign country' || p.TYPE === 'Country' || p.TYPE === 'Sovereignty' || p.TYPE === 'Disputed',
    area: Math.round(geoArea({ type: 'Feature', geometry: f.geometry }) * 6371.0088 ** 2),
    pop: p.POP_EST || 0,
    nb: nb[i].map(j => geoms[j].id).sort(),
    al: ALIAS[f.code] || [],
  };
}).sort((a, b) => a.en.localeCompare(b.en));

writeFileSync(new URL('countries.json', OUT), JSON.stringify(countries));

// Display map: simplify hard so the whole world is ~150 KB.
const pre = presimplify(topo);
const simp = simplify(pre, quantile(pre, 0.05));
writeFileSync(new URL('world.json', OUT), JSON.stringify(simp));
console.log('countries', countries.length, 'world.json bytes', JSON.stringify(simp).length);
const tr = countries.find(c => c.c === 'TR');
console.log(tr);
