// Downloads raw open datasets into data-raw/ (git-ignored). Run once: npm run data:fetch
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const RAW = new URL('../data-raw/', import.meta.url);
const NE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/';
const SOURCES = [
  ['ne_10m_admin_0_countries.geojson', NE + 'ne_10m_admin_0_countries.geojson'],
  ['ne_50m_admin_0_countries.geojson', NE + 'ne_50m_admin_0_countries.geojson'],
  ['ne_10m_rivers_lake_centerlines.geojson', NE + 'ne_10m_rivers_lake_centerlines.geojson'],
  ['ne_10m_lakes.geojson', NE + 'ne_10m_lakes.geojson'],
  ['cities500.zip', 'https://download.geonames.org/export/dump/cities500.zip'],
  ['countryInfo.txt', 'https://download.geonames.org/export/dump/countryInfo.txt'],
  ['admin1CodesASCII.txt', 'https://download.geonames.org/export/dump/admin1CodesASCII.txt'],
];

await mkdir(RAW, { recursive: true });
for (const [name, url] of SOURCES) {
  const dest = new URL(name, RAW);
  try { await stat(dest); console.log('have', name); continue; } catch {}
  process.stdout.write(`fetch ${name} ... `);
  const res = await fetch(url, { headers: { 'User-Agent': 'geo-daily-build/0.1' } });
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  console.log('ok');
}
try { await stat(new URL('cities500.txt', RAW)); } catch {
  execFileSync('unzip', ['-o', '-q', 'cities500.zip'], { cwd: RAW });
}
console.log('done');
