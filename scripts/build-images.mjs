// Downloads the public-domain / CC0 artwork for the home page and crops it to web sizes.
// Sources are listed in IMAGES with their licence. Uses macOS `sips` for cropping/resizing.
// Run: node scripts/build-images.mjs   (writes public/img/*.jpg)
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const RAW = new URL('../data-raw/img/', import.meta.url).pathname;
const OUT = new URL('../public/img/', import.meta.url).pathname;
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const UA = { 'User-Agent': 'meridian-build/0.1 (https://github.com/safaksekin/meridian)' };

// crop: [x0, y0, x1, y1] as fractions of the source image; out: [w, h]
export const IMAGES = [
  {
    id: 'hero-europe', licence: 'Public domain (NASA Blue Marble Next Generation)',
    page: 'https://visibleearth.nasa.gov/images/73751/july-blue-marble-next-generation-w-topography-and-bathymetry',
    src: 'https://eoimages.gsfc.nasa.gov/images/imagerecords/73000/73751/world.topo.bathy.200407.3x21600x10800.jpg',
    // lon -26..52, lat 72..28 on the equirectangular world
    crop: [(180 - 26) / 360, (90 - 72) / 180, (180 + 52) / 360, (90 - 28) / 180], out: [1600, 902], q: 64,
  },
  {
    id: 'card-beeline', licence: 'Public domain (NASA, via Wikimedia Commons)',
    page: 'https://commons.wikimedia.org/wiki/File:Europe_satellite_orthographic.jpg',
    commons: 'File:Europe satellite orthographic.jpg',
    crop: [0, 0.08, 1, 0.86], out: [800, 500], q: 62,
  },
  {
    id: 'card-streets', licence: 'CC0 (Unsplash, via Wikimedia Commons)',
    page: 'https://commons.wikimedia.org/wiki/File:Drone_aerial_view_of_Les_Vans_(Unsplash).jpg',
    commons: 'File:Drone aerial view of Les Vans (Unsplash).jpg',
    crop: [0.02, 0.04, 0.82, 0.94], out: [800, 500], q: 62,
  },
  {
    id: 'card-headcount', licence: 'Public domain (NASA Black Marble, via Wikimedia Commons)',
    page: 'https://commons.wikimedia.org/wiki/File:Black_Marble_-_Africa,_Europe,_and_the_Middle_East_(8247962102).jpg',
    commons: 'File:Black Marble - Africa, Europe, and the Middle East (8247962102).jpg',
    crop: [0.12, 0.1, 0.92, 0.6], out: [800, 500], q: 62,
  },
  {
    id: 'card-hinterland', licence: 'CC0 (Unsplash, via Wikimedia Commons)',
    page: 'https://commons.wikimedia.org/wiki/File:Buildings_on_a_green_slope_(Unsplash).jpg',
    commons: 'File:Buildings on a green slope (Unsplash).jpg',
    crop: [0.12, 0.2, 0.98, 0.74], out: [800, 500], q: 62,
  },
  {
    id: 'card-tripoint', licence: 'Public domain (NASA Earth Observatory, via Wikimedia Commons)',
    page: 'https://commons.wikimedia.org/wiki/File:The_Mountainous_Spine_of_Corsica.jpeg',
    commons: 'File:The Mountainous Spine of Corsica.jpeg',
    crop: [0.18, 0.2, 0.86, 0.46], out: [800, 500], q: 62,
  },
  {
    id: 'photo-barcelona', licence: 'Public domain (NASA, ISS crew photograph, via Wikimedia Commons)',
    page: 'https://commons.wikimedia.org/wiki/File:Barcelona,_Spain%27s_second_most-populous_city,_is_pictured_from_the_International_Space_Station.jpg',
    commonsSearch: 'Barcelona second most-populous city pictured International Space Station',
    crop: [0.3, 0.44, 0.8, 0.86], out: [480, 360], q: 70,
  },
];

async function commonsSearch(q) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', list: 'search', srnamespace: '6', srsearch: q, srlimit: '1' });
  const j = await (await fetch(u, { headers: UA })).json();
  return j.query.search[0].title;
}

async function commonsUrl(title) {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', titles: title, prop: 'imageinfo', iiprop: 'url' });
  const j = await (await fetch(u, { headers: UA })).json();
  return Object.values(j.query.pages)[0].imageinfo[0].url;
}

function size(file) {
  const o = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', file]).toString();
  return [+o.match(/pixelWidth: (\d+)/)[1], +o.match(/pixelHeight: (\d+)/)[1]];
}

for (const im of IMAGES) {
  const raw = `${RAW}${im.id}.src.jpg`;
  if (!existsSync(raw)) {
    const url = im.src ?? (await commonsUrl(im.commons ?? (await commonsSearch(im.commonsSearch))));
    process.stdout.write(`download ${im.id} ... `);
    const res = await fetch(url, { headers: UA });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
    console.log('ok');
  }
  const [W, H] = size(raw);
  const [x0, y0, x1, y1] = im.crop;
  const cw = Math.round((x1 - x0) * W), ch = Math.round((y1 - y0) * H);
  // keep the output aspect ratio: trim the crop box to it
  const want = im.out[0] / im.out[1];
  let w = cw, h = ch;
  if (w / h > want) w = Math.round(h * want); else h = Math.round(w / want);
  const ox = Math.round(x0 * W + (cw - w) / 2), oy = Math.round(y0 * H + (ch - h) / 2);
  const tmp = `${RAW}${im.id}.crop.jpg`;
  execFileSync('sips', ['-s', 'format', 'jpeg', '--cropOffset', String(oy), String(ox), '-c', String(h), String(w), raw, '--out', tmp], { stdio: 'ignore' });
  const out = `${OUT}${im.id}.jpg`;
  execFileSync('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(im.q ?? 72), '-z', String(im.out[1]), String(im.out[0]), tmp, '--out', out], { stdio: 'ignore' });
  console.log(`${im.id}: ${w}x${h} from ${W}x${H} -> ${im.out.join('x')} ${Math.round(statSync(out).size / 1024)} KB`);
}
writeFileSync(`${OUT}CREDITS.json`, JSON.stringify(IMAGES.map(({ id, licence, page }) => ({ id, licence, page })), null, 1));
