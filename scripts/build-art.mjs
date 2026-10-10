// Generates vector card art from our own data: public/img/card-mental.svg (Europe as a purple
// "constellation": country shapes, label points as stars, and a few connecting lines).
import { readFileSync, writeFileSync } from 'node:fs';
import { feature, mesh } from 'topojson-client';
import { geoAzimuthalEqualArea, geoPath } from 'd3-geo';

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
