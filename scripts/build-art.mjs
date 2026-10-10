// Generates vector card art from our own data:
// - public/img/card-mental.svg: Europe as a purple "constellation" (country shapes, label points
//   as stars, and a few connecting lines);
// - public/img/card-tripoint.svg: three tinted countries and their real borders meeting at a
//   tripoint, over a satellite base (run scripts/build-images.mjs first; needs data-raw/).
import { readFileSync, writeFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';
import { topology } from 'topojson-server';
import { geoAzimuthalEqualArea, geoIdentity, geoPath } from 'd3-geo';
import { loadFeatures, mergeByCode } from './lib/countries-src.mjs';
import { TRIPOINT, TRIPOINT_BBOX, TRIPOINT_COUNTRIES } from './lib/tripoint-card.mjs';

const world = JSON.parse(readFileSync(new URL('../public/data/world.json', import.meta.url)));
const countries = JSON.parse(readFileSync(new URL('../public/data/countries.json', import.meta.url)));
const W = 800, H = 500;
const proj = geoAzimuthalEqualArea().rotate([-13, -51]).scale(800).translate([W / 2, H / 2 + 10]).clipExtent([[0, 0], [W, H]]);
const path = geoPath(proj);
const land = feature(world, world.objects.countries);
const borders = mesh(world, world.objects.countries, (a, b) => a !== b);
const round = (d) => d.replace(/(\d+\.\d)\d+/g, '$1');

const stars = ['IS', 'IE', 'GB', 'NO', 'SE', 'FI', 'PT', 'ES', 'FR', 'DE', 'PL', 'IT', 'GR', 'TR', 'UA', 'RO', 'AT', 'CZ', 'BY', 'LT', 'HU', 'RS', 'BG', 'DK', 'NL']
  .map((c) => countries.find((x) => x.c === c))
  .filter(Boolean)
  .map((c) => ({ c: c.c, p: proj([c.lon, c.lat]) }))
  .filter((s) => s.p && s.p[0] > 10 && s.p[0] < W - 10 && s.p[1] > 10 && s.p[1] < H - 10);
const at = (c) => stars.find((s) => s.c === c)?.p;
const links = [['PT', 'ES'], ['ES', 'FR'], ['FR', 'GB'], ['GB', 'IE'], ['FR', 'DE'], ['DE', 'DK'], ['DK', 'NO'], ['NO', 'SE'], ['SE', 'FI'], ['DE', 'PL'], ['PL', 'LT'], ['PL', 'UA'], ['UA', 'RO'], ['RO', 'BG'], ['BG', 'TR'], ['BG', 'GR'], ['GR', 'IT'], ['IT', 'FR'], ['IT', 'AT'], ['AT', 'CZ'], ['CZ', 'DE'], ['HU', 'RS'], ['AT', 'HU'], ['GB', 'NO'], ['IS', 'NO'], ['NL', 'DE'], ['BY', 'LT']]
  .map(([a, b]) => [at(a), at(b)])
  .filter(([a, b]) => a && b);

const f = (n) => n.toFixed(1);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs>
<radialGradient id="bg" cx="55%" cy="45%" r="75%"><stop offset="0" stop-color="#4b2a8f"/><stop offset=".6" stop-color="#2a1660"/><stop offset="1" stop-color="#150a33"/></radialGradient>
<linearGradient id="land" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8f6ef0"/><stop offset="1" stop-color="#5a3dbd"/></linearGradient>
<radialGradient id="glow"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".35" stop-color="#d9c9ff" stop-opacity=".55"/><stop offset="1" stop-color="#b79bff" stop-opacity="0"/></radialGradient>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<path d="${round(path(land) ?? '')}" fill="url(#land)" fill-opacity=".55"/>
<path d="${round(path(borders) ?? '')}" fill="none" stroke="#d8ccff" stroke-opacity=".35" stroke-width=".8"/>
<g stroke="#efe8ff" stroke-opacity=".7" stroke-width="1.3">${links.map(([a, b]) => `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}"/>`).join('')}</g>
<g>${stars.map((s) => `<circle cx="${f(s.p[0])}" cy="${f(s.p[1])}" r="11" fill="url(#glow)"/><circle cx="${f(s.p[0])}" cy="${f(s.p[1])}" r="3.2" fill="#fff"/>`).join('')}</g>
</svg>`;
writeFileSync(new URL('../public/img/card-mental.svg', import.meta.url), svg);
console.log('card-mental.svg', svg.length, 'bytes,', stars.length, 'stars,', links.length, 'links');

// ---------------------------------------------------------------- card-tripoint.svg
{
  const [west, south, east, north] = TRIPOINT_BBOX;
  // The base image is a plain lon/lat crop, so the frame maps linearly onto the card.
  const px = ([lon, lat]) => [((lon - west) / (east - west)) * W, ((north - lat) / (north - south)) * H];
  const near = (ring) => ring.some(([lon, lat]) => lon > west - 1 && lon < east + 1 && lat > south - 1 && lat < north + 1);
  const feats = mergeByCode(loadFeatures('10m'))
    .map((f) => ({ type: 'Feature', properties: { code: f.code }, geometry: { type: 'MultiPolygon', coordinates: f.geometry.coordinates.filter((poly) => near(poly[0])).map((poly) => poly.map((ring) => ring.map(px))) } }))
    .filter((f) => f.geometry.coordinates.length);
  const topo = topology({ c: { type: 'FeatureCollection', features: feats } }, 1e6);
  const clip = geoPath(geoIdentity().clipExtent([[-4, -4], [W + 4, H + 4]])).digits(1);
  const main = (g) => TRIPOINT_COUNTRIES.includes(g.properties.code);
  const shape = (code) => clip(feats.find((x) => x.properties.code === code)) ?? '';
  const minor = clip(mesh(topo, topo.objects.c, (a, b) => a !== b && !(main(a) && main(b)))) ?? '';
  const major = clip(mesh(topo, topo.objects.c, (a, b) => a !== b && main(a) && main(b))) ?? '';
  const [tx, ty] = px(TRIPOINT).map(f);
  const base = readFileSync(new URL('../data-raw/img/card-tripoint.base.jpg', import.meta.url)).toString('base64');
  const tints = ['#2373f4', '#ffb020', '#ef476f'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">
<defs><filter id="relief" x="0" y="0" width="1" height="1" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values=".15"/><feComponentTransfer><feFuncR type="linear" slope="1.7" intercept=".06"/><feFuncG type="linear" slope="1.7" intercept=".06"/><feFuncB type="linear" slope="1.7" intercept=".06"/></feComponentTransfer></filter></defs>
<image href="data:image/jpeg;base64,${base}" width="${W}" height="${H}" preserveAspectRatio="none" filter="url(#relief)"/>
<rect width="${W}" height="${H}" fill="#0e1d35" fill-opacity=".22"/>
${TRIPOINT_COUNTRIES.map((c, i) => `<path d="${shape(c)}" fill="${tints[i]}" fill-opacity=".44"/>`).join('\n')}
<g fill="none" stroke="#fff" stroke-linejoin="round" stroke-linecap="round"><path d="${minor}" stroke-opacity=".75" stroke-width="1.4"/><path d="${major}" stroke-width="3.4"/></g>
<circle cx="${tx}" cy="${ty}" r="34" fill="#fff" fill-opacity=".14" stroke="#fff" stroke-opacity=".9" stroke-width="2.4"/>
<circle cx="${tx}" cy="${ty}" r="12" fill="#fff"/><circle cx="${tx}" cy="${ty}" r="5.5" fill="#0e1d35"/>
</svg>`;
  writeFileSync(new URL('../public/img/card-tripoint.svg', import.meta.url), svg);
  console.log('card-tripoint.svg', Math.round(svg.length / 1024), 'KB,', feats.map((x) => x.properties.code).join(' '));
}
