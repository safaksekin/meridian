import './style.css';
import { geoCircle, geoInterpolate, geoOrthographic, geoPath, type GeoProjection } from 'd3-geo';
import type { ModeContext, ModeModule } from '../types';
import { h, keepOnScreen, modal, resultPanel, svgEl, toast, copyShare } from '../../core/ui';
import { lang, makeT } from '../../core/i18n';
import { loadJSON } from '../../core/data';
import { loadGame, recordResult, saveGame } from '../../core/storage';
import { countryName } from '../../core/countries';
import { drawWorld, loadWorld } from '../../core/map';
import { globeControls, zoomButtons } from '../../core/globe';
import { flag } from '../../core/geo';
import * as L from './logic';
import { coastClue, flagClue, namesClue, popClue, streetsClue, sunClue } from './clues';

const MODE = 'expedition';
/** saveGame slot of the endless (practice) run; daily runs use their day number. */
const FREE_SLOT = 0;

const t = makeT({
  en: {
    leg: 'Leg {n}',
    legsDone: '{n} reached',
    fuel: 'Fuel',
    tabClue: 'Clue',
    tabMap: 'Map',
    kind_coast: 'Coastline',
    kind_pop: 'Population density',
    kind_names: 'Road signs',
    kind_streets: 'Street pattern',
    win_coast: '{w} km across · the destination is under the cross',
    win_pop: '{w} km across · darker = more people',
    win_names: 'Places within 45 km of the destination',
    win_streets3: '3 × 3 km around the destination',
    win_streets2: '10 × 10 km, main roads',
    from: 'You are in {place}',
    askClue: 'Where is this? Find it on the map and fly there.',
    askMap: 'Tap the map where you think the destination is.',
    toMap: '🌍 Pick on the map',
    fly: 'Fly',
    tapFirst: 'Tap the map first',
    outOfRange: 'Out of range',
    miss: 'Not there. The destination is {arrow} {dir}, {band}.',
    hopN: 'Flight {n}',
    arrived: 'Landed: {place}',
    arrivedSub: '{hops} · +{fuel} km fuel',
    hops1: 'first flight',
    hopsN: '{n} flights',
    next: 'Next leg →',
    extraSun: '☀️ Sun',
    extraFlag: '🏳️ Flag',
    extraSunTitle: 'Sun clock: sunrise and sunset at the destination (UTC)',
    extraFlagTitle: 'The flag of the destination’s country',
    extraCost: '−{km} km',
    sunTitle: 'Daylight at the destination, {date} (UTC)',
    sunLine: 'Sunrise {rise}, sunset {set} UTC · day {len} h.',
    sunNoon: 'Solar noon {noon} UTC.',
    sunPolarDay: 'The sun does not set there today.',
    sunPolarNight: 'The sun does not rise there today.',
    flagTitle: 'Flag of the destination’s country',
    quit: 'End the run',
    quitTitle: 'End this run?',
    quitText: 'Your score is the legs you have reached so far.',
    quitYes: 'End it',
    quitNo: 'Keep flying',
    endFuel: 'Out of fuel',
    endQuit: 'Run ended',
    endComplete: 'Every leg flown!',
    resultLegs: '{n} legs',
    resultLeg: '1 leg',
    lastTarget: 'The last destination was {place}',
    freeTag: 'Free run · practice, no stats',
    freeStart: '✈️ Start a free run',
    freeResume: '✈️ Continue your free run',
    freeNew: '✈️ New free run',
    backDaily: 'Back to today’s run',
    attribution: 'Data: GeoNames (CC BY 4.0), Natural Earth, GHSL (CC BY 4.0), © OpenStreetMap contributors (ODbL).',
    mapLabel: 'Globe: drag to turn, tap to choose where to fly',
    dir0: 'north',
    dir1: 'north-east',
    dir2: 'east',
    dir3: 'south-east',
    dir4: 'south',
    dir5: 'south-west',
    dir6: 'west',
    dir7: 'north-west',
    band0: 'under 750 km away',
    band1: '750–1,500 km away',
    band2: '1,500–3,000 km away',
    band3: '3,000–6,000 km away',
    band4: 'over 6,000 km away',
    shareFree: 'Share',
    h1: 'A round-the-world flight on a tank of fuel. Each leg shows the next destination only through a window: a coastline, a population map, road signs or a street pattern. Find it on the globe, tap, and fly.',
    h2: 'Land within 300 km and you refuel (more if it took one flight). Miss, and you are now wherever you landed: you get the direction and a distance band, and fly again from there. Every flight costs its length plus 250 km for take-off. The dashed ring shows how far your fuel reaches.',
    h3: 'Stuck? Buy a sun clock (sunrise and sunset there, in UTC) or the country’s flag with fuel. The run ends when the fuel cannot reach the destination any more. Your score is the number of legs you reached.',
    ex: 'Example: the window shows a long boot-shaped peninsula under the cross. You tap southern Italy from Paris: 1,300 km, landed. +5,600 km fuel.',
  },
  tr: {
    leg: '{n}. ayak',
    legsDone: '{n} varış',
    fuel: 'Yakıt',
    tabClue: 'İpucu',
    tabMap: 'Harita',
    kind_coast: 'Kıyı çizgisi',
    kind_pop: 'Nüfus yoğunluğu',
    kind_names: 'Yol tabelaları',
    kind_streets: 'Sokak dokusu',
    win_coast: '{w} km genişlik · hedef artının altında',
    win_pop: '{w} km genişlik · koyu = kalabalık',
    win_names: 'Hedefe 45 km’den yakın yerleşimler',
    win_streets3: 'Hedefin çevresinde 3 × 3 km',
    win_streets2: '10 × 10 km, ana yollar',
    from: 'Bulunduğun yer: {place}',
    askClue: 'Burası neresi? Haritada bul ve oraya uç.',
    askMap: 'Hedefin olduğunu düşündüğün yere dokun.',
    toMap: '🌍 Haritada seç',
    fly: 'Uç',
    tapFirst: 'Önce haritaya dokun',
    outOfRange: 'Menzil dışı',
    miss: 'Orası değil. Hedef {arrow} {dir} yönünde, {band}.',
    hopN: '{n}. uçuş',
    arrived: 'Vardın: {place}',
    arrivedSub: '{hops} · +{fuel} km yakıt',
    hops1: 'ilk uçuşta',
    hopsN: '{n} uçuşta',
    next: 'Sonraki ayak →',
    extraSun: '☀️ Güneş',
    extraFlag: '🏳️ Bayrak',
    extraSunTitle: 'Güneş saati: hedefte gün doğumu ve batımı (UTC)',
    extraFlagTitle: 'Hedefin bulunduğu ülkenin bayrağı',
    extraCost: '−{km} km',
    sunTitle: 'Hedefte gün ışığı, {date} (UTC)',
    sunLine: 'Gün doğumu {rise}, gün batımı {set} UTC · gün {len} saat.',
    sunNoon: 'Güneş öğlesi {noon} UTC.',
    sunPolarDay: 'Orada bugün güneş batmıyor.',
    sunPolarNight: 'Orada bugün güneş doğmuyor.',
    flagTitle: 'Hedefin bulunduğu ülkenin bayrağı',
    quit: 'Seferi bitir',
    quitTitle: 'Sefer bitsin mi?',
    quitText: 'Puanın şimdiye kadar vardığın ayak sayısı olur.',
    quitYes: 'Bitir',
    quitNo: 'Uçmaya devam',
    endFuel: 'Yakıt bitti',
    endQuit: 'Sefer bitti',
    endComplete: 'Bütün ayaklar tamam!',
    resultLegs: '{n} ayak',
    resultLeg: '1 ayak',
    lastTarget: 'Son hedef: {place}',
    freeTag: 'Serbest sefer · antrenman, istatistiğe yazılmaz',
    freeStart: '✈️ Serbest sefere çık',
    freeResume: '✈️ Serbest seferine devam et',
    freeNew: '✈️ Yeni serbest sefer',
    backDaily: 'Günün seferine dön',
    attribution: 'Veri: GeoNames (CC BY 4.0), Natural Earth, GHSL (CC BY 4.0), © OpenStreetMap katkıcıları (ODbL).',
    mapLabel: 'Küre: döndürmek için sürükle, uçacağın yeri seçmek için dokun',
    dir0: 'kuzey',
    dir1: 'kuzeydoğu',
    dir2: 'doğu',
    dir3: 'güneydoğu',
    dir4: 'güney',
    dir5: 'güneybatı',
    dir6: 'batı',
    dir7: 'kuzeybatı',
    band0: '750 km’den yakın',
    band1: '750–1.500 km uzakta',
    band2: '1.500–3.000 km uzakta',
    band3: '3.000–6.000 km uzakta',
    band4: '6.000 km’den uzak',
    shareFree: 'Paylaş',
    h1: 'Bir depo yakıtla dünya turu. Her ayakta bir sonraki hedefi yalnızca bir pencereden görürsün: bir kıyı çizgisi, bir nüfus haritası, yol tabelaları ya da bir sokak dokusu. Küre üzerinde bul, dokun ve uç.',
    h2: 'Hedefe 300 km’den yakın inersen yakıt alırsın (tek uçuşta bulursan daha çok). Iskalarsan indiğin yerde kalırsın: yön ve mesafe aralığı öğrenir, oradan yeniden uçarsın. Her uçuş, uzunluğu artı 250 km kalkış yakıtı yer. Kesikli halka yakıtının nereye yettiğini gösterir.',
    h3: 'Takıldın mı? Yakıtla güneş saati (orada gün doğumu ve batımı, UTC) ya da ülkenin bayrağını alabilirsin. Yakıt hedefe yetmez olunca sefer biter. Puanın, vardığın ayak sayısıdır.',
    ex: 'Örnek: pencerede artının altında uzun, çizme biçiminde bir yarımada var. Paris’ten Güney İtalya’ya dokunursun: 1.300 km, vardın. +5.600 km yakıt.',
  },
});

const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];
const fmt = (n: number) => Math.round(n).toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-US');
const placeName = (p: L.Place) => `${(lang === 'tr' && p.tr) || p.n}, ${countryName(p.c)} ${flag(p.c)}`;
/** Calendar date of a daily run (Day #1 = 2026-10-10); the sun clock uses it. */
const dateOfDay = (day: number) => new Date(Date.UTC(2026, 9, 9 + day, 12));

interface Pool {
  pool: L.Place[];
}

function validState(s: unknown): s is L.RunState {
  const r = s as L.RunState;
  return !!r && typeof r.seed === 'number' && typeof r.fuel === 'number' && Array.isArray(r.pos) && Array.isArray(r.log) && r.log.length > 0;
}

let cleanup: (() => void) | null = null;

const mode: ModeModule = {
  async mount(ctx: ModeContext) {
    const [doc, world] = await Promise.all([loadJSON<Pool>('expedition/pool.json'), loadWorld()]);
    const start = (free: boolean) => {
      cleanup?.();
      ctx.root.replaceChildren();
      cleanup = play(ctx, doc.pool, world, free, start);
    };
    start(false);
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  },
  howTo() {
    return h('div', {}, h('p', {}, t('h1')), h('p', {}, t('h2')), h('p', {}, t('h3')), h('p', { class: 'howto-example' }, t('ex')));
  },
};
export default mode;

type World = Awaited<ReturnType<typeof loadWorld>>;

function play(ctx: ModeContext, pool: L.Place[], world: World, free: boolean, restart: (free: boolean) => void): () => void {
  const slot = free ? FREE_SLOT : ctx.day;
  const saved = loadGame<L.RunState>(MODE, slot);
  const seed = validState(saved) ? saved.seed : free ? 1 + Math.floor(Math.random() * 2 ** 30) : ctx.day;
  const run = L.planRun(pool, seed);
  const st: L.RunState = validState(saved) ? saved : L.newRun(run, seed);
  const save = () => saveGame(MODE, slot, st);
  save();
  const runDate = free ? new Date() : dateOfDay(ctx.day);

  let view: 'clue' | 'map' = st.done || st.log[st.log.length - 1].hops.length ? 'map' : 'clue';
  let pending: [number, number] | null = null; // [lat, lon] of the tapped spot
  let arrival: { leg: number; hops: number; refuel: number } | null = null;
  let busy = false;
  let raf = 0;
  const offs: (() => void)[] = [];

  // ---------------------------------------------------------------- globe
  const SIZE = 400;
  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, role: 'img', 'aria-label': t('mapLabel') });
  const proj: GeoProjection = geoOrthographic().scale(SIZE / 2 - 4).translate([SIZE / 2, SIZE / 2]).clipAngle(90).precision(0.3);
  const centerOn = (lat: number, lon: number) => proj.rotate([-lon, -lat * 0.8, 0]);
  centerOn(st.pos[0], st.pos[1]);
  /** Flight in progress: drawn by the animation instead of the route (leg/hop identify it in the log). */
  let anim: { from: [number, number]; to: [number, number]; f: number; leg: number; hop: number } | null = null;
  const drawGlobe = () => drawMap();
  const controls = globeControls(svg, proj, drawGlobe);

  // Tap (not a drag) chooses the destination.
  let down: { x: number; y: number; id: number; time: number } | null = null;
  let touches = 0;
  svg.addEventListener('pointerdown', (e) => {
    touches++;
    down = touches === 1 ? { x: e.clientX, y: e.clientY, id: e.pointerId, time: e.timeStamp } : null;
  });
  const lift = (e: PointerEvent) => {
    touches = Math.max(0, touches - 1);
    const d = down;
    if (!d || d.id !== e.pointerId || e.type === 'pointercancel') return void (down = null);
    down = null;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7 || e.timeStamp - d.time > 600) return;
    tap(e.clientX, e.clientY);
  };
  svg.addEventListener('pointerup', lift);
  svg.addEventListener('pointercancel', lift);

  function tap(cx: number, cy: number) {
    if (busy || st.done || arrival) return;
    const box = svg.getBoundingClientRect();
    const s = Math.min(box.width, box.height) / SIZE;
    const x = (cx - box.left - (box.width - SIZE * s) / 2) / s;
    const y = (cy - box.top - (box.height - SIZE * s) / 2) / s;
    const [tx, ty] = proj.translate();
    if (Math.hypot(x - tx, y - ty) > proj.scale()) return; // off the globe
    const ll = proj.invert?.([x, y]);
    if (!ll || !Number.isFinite(ll[0])) return;
    pending = [ll[1], ll[0]];
    renderControls();
    drawMap();
  }

  function visible(lat: number, lon: number): boolean {
    const [rl, rp] = proj.rotate();
    const r = Math.PI / 180;
    return Math.sin(lat * r) * Math.sin(-rp * r) + Math.cos(lat * r) * Math.cos(-rp * r) * Math.cos((lon + rl) * r) > 0;
  }

  function marker(lat: number, lon: number, cls: string, r = 5): void {
    if (!visible(lat, lon)) return;
    const p = proj([lon, lat]);
    if (p) layer.append(svgEl('circle', { cx: p[0], cy: p[1], r, class: cls }));
  }

  let layer: SVGGElement = svgEl('g');
  function drawMap() {
    ({ layer } = drawWorld(svg, proj, world));
    const path = geoPath(proj);
    const line = (a: [number, number], b: [number, number], cls: string) =>
      layer.append(svgEl('path', { d: path({ type: 'LineString', coordinates: [[a[1], a[0]], [b[1], b[0]]] }) ?? '', class: cls }));

    if (!st.done && !anim) {
      const deg = L.rangeKm(st.fuel) / 111.195;
      if (deg < 179) layer.append(svgEl('path', { d: path(geoCircle().center([st.pos[1], st.pos[0]]).radius(deg)()) ?? '', class: 'ex-range' }));
    }
    // The route so far: earlier legs muted, the current leg in colour.
    let cur: [number, number] = [run.start.a, run.start.o];
    st.log.forEach((leg, i) => {
      const now = i === st.log.length - 1 && !st.done;
      const flying = anim?.leg === i;
      leg.hops.forEach((hop, j) => {
        if (!(flying && anim?.hop === j)) line(cur, hop, now ? 'ex-trail now' : 'ex-trail');
        cur = hop;
      });
      if (leg.arrived) {
        const tg = run.legs[i];
        if (!flying) line(cur, [tg.a, tg.o], 'ex-snap');
        cur = [tg.a, tg.o];
      }
    });
    if (anim) {
      const ip = geoInterpolate([anim.from[1], anim.from[0]], [anim.to[1], anim.to[0]]);
      const pts: [number, number][] = [];
      for (let k = 0; k <= 24; k++) pts.push(ip((k / 24) * anim.f));
      layer.append(svgEl('path', { d: path({ type: 'LineString', coordinates: pts }) ?? '', class: 'ex-trail now' }));
    }
    // Arrivals, start, the unreached destination at the end.
    marker(run.start.a, run.start.o, 'ex-start', 5);
    st.log.forEach((leg, i) => leg.arrived && marker(run.legs[i].a, run.legs[i].o, 'ex-hit', 4.5));
    if (st.done && !anim) {
      const tg = run.legs[L.currentLeg(st)];
      if (tg && !st.log[st.log.length - 1].arrived) marker(tg.a, tg.o, 'ex-missed', 6);
    }
    // Pending choice: dashed great circle from here.
    if (pending && !anim) {
      line(st.pos, pending, 'ex-plan');
      marker(pending[0], pending[1], 'ex-pending', 6);
    }
    // The plane.
    const at = anim ? (() => { const p = geoInterpolate([anim.from[1], anim.from[0]], [anim.to[1], anim.to[0]])(anim.f); return [p[1], p[0]] as [number, number]; })() : st.pos;
    marker(at[0], at[1], 'ex-me', 6.5);
  }

  // ---------------------------------------------------------------- layout
  const fuelFill = h('i');
  const fuelText = h('strong', { class: 'ex-fuel-km' });
  const legEl = h('strong', { class: 'ex-leg' });
  const doneEl = h('span', { class: 'ex-done' });
  const hud = h(
    'div',
    { class: 'ex-hud' },
    legEl,
    h('div', { class: 'ex-fuel', title: t('fuel') }, h('span', { class: 'ex-fuel-icon', 'aria-hidden': 'true' }, '⛽'), h('div', { class: 'ex-fuel-bar' }, fuelFill), fuelText),
    doneEl,
  );

  const tabClue = h('button', { class: 'ex-tab', type: 'button', onclick: () => setView('clue') }, t('tabClue'));
  const tabMap = h('button', { class: 'ex-tab', type: 'button', onclick: () => setView('map') }, t('tabMap'));
  const tabs = h('div', { class: 'ex-tabs', role: 'tablist' }, tabClue, tabMap);

  const globeBox = h('div', { class: 'mapbox ex-globe' }, svg, zoomButtons(controls.zoomBy));
  const clueHead = h('div', { class: 'ex-clue-head' });
  const clueWin = h('div', { class: 'ex-winwrap' });
  const clueExtras = h('div', { class: 'ex-extras' });
  const clueBox = h('div', { class: 'ex-clue' }, clueHead, clueWin, clueExtras);
  const stage = h('div', { class: 'ex-stage' }, globeBox, clueBox, tabs);

  const msg = h('div', { class: 'ex-msg', 'aria-live': 'polite' });
  const extrasRow = h('div', { class: 'ex-buy' });
  const mainBtn = h('button', { class: 'btn primary ex-main', type: 'button' });
  const quitBtn = h('button', { class: 'link-btn small ex-quit', type: 'button', onclick: askQuit }, t('quit'));
  const actions = h('div', { class: 'ex-actions' }, extrasRow, mainBtn);
  const resultSlot = h('div', { class: 'ex-result' });
  const freeBar = free
    ? h('div', { class: 'ex-freebar' }, h('span', {}, t('freeTag')), h('button', { class: 'link-btn small', type: 'button', onclick: () => restart(false) }, t('backDaily')))
    : null;

  const game = h('div', { class: 'ex' }, hud, stage, msg, actions, h('div', { class: 'ex-foot' }, quitBtn));
  if (freeBar) ctx.root.append(freeBar);
  ctx.root.append(game, resultSlot);
  keepOnScreen(stage, () => actions, { minSize: 240 });

  mainBtn.addEventListener('click', () => {
    if (busy) return;
    if (arrival) return nextLeg();
    if (view === 'clue' && matchMedia('(max-width: 899px)').matches) return setView('map');
    flyNow();
  });

  function setView(v: 'clue' | 'map') {
    view = v;
    renderControls();
  }

  // ---------------------------------------------------------------- clue
  let clueFor = -1;
  let clueToken = 0;
  async function renderClue() {
    const i = L.currentLeg(st);
    const p = run.legs[i];
    if (!p) return;
    if (clueFor !== i) {
      clueFor = i;
      const token = ++clueToken;
      const w =
        p.k === 'coast' ? t('win_coast', { w: fmt(2 * L.WINDOW_KM.coast[p.t - 1]) })
        : p.k === 'pop' ? t('win_pop', { w: fmt(2 * L.WINDOW_KM.pop[p.t - 1]) })
        : p.k === 'names' ? t('win_names')
        : t(p.t <= 2 ? 'win_streets2' : 'win_streets3');
      clueHead.replaceChildren(h('strong', {}, t(`kind_${p.k}`)), h('span', { class: 'muted' }, w));
      clueWin.replaceChildren(h('div', { class: 'ex-win ex-loading' }));
      try {
        const el = p.k === 'coast' ? await coastClue(p, fmt) : p.k === 'pop' ? await popClue(p, fmt) : p.k === 'names' ? namesClue(p) : await streetsClue(p);
        if (token === clueToken) clueWin.replaceChildren(el);
      } catch (err) {
        console.error(err);
        if (token === clueToken) clueWin.replaceChildren(h('div', { class: 'ex-win ex-loading' }, t('loadError')));
      }
    }
    const leg = st.log[i];
    clueExtras.replaceChildren(
      ...leg.extras.map((e) => (e === 'sun' ? sunClue(p, runDate, t) : flagClue(p, t))),
    );
  }

  // ---------------------------------------------------------------- actions
  function flyNow() {
    if (!pending) return toast(t('tapFirst'));
    if (!L.canFly(st, pending[0], pending[1])) return toast(t('outOfRange'));
    const from = st.pos;
    const to = pending;
    const legIdx = L.currentLeg(st);
    const res = L.fly(st, run, to[0], to[1]);
    const hop = st.log[legIdx].hops.length - 1;
    pending = null;
    if (res.arrived) arrival = { leg: legIdx, hops: st.log[legIdx].hops.length, refuel: res.refuel ?? 0 };
    save();
    if (st.done) finish();
    animate(from, to, legIdx, hop, () => {
      if (st.done) showRoute();
      render();
    });
    renderControls();
  }

  function animate(from: [number, number], to: [number, number], leg: number, hop: number, done: () => void) {
    const km = L.distKm(from[0], from[1], to[0], to[1]);
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || km < 1) {
      centerOn(to[0], to[1]);
      done();
      return;
    }
    busy = true;
    const dur = Math.min(2200, 700 + km * 0.15);
    const r0 = proj.rotate();
    const ip = geoInterpolate([from[1], from[0]], [to[1], to[0]]);
    const t0 = performance.now();
    const step = (now: number) => {
      const f = Math.min(1, (now - t0) / dur);
      const e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
      anim = { from, to, f: e, leg, hop };
      // The camera eases from where it was onto the plane, then follows it.
      const p = ip(e);
      const k = Math.min(1, f * 3);
      const target: [number, number] = [-p[0], -p[1] * 0.8];
      let dl = target[0] - r0[0];
      dl = ((((dl + 180) % 360) + 360) % 360) - 180;
      proj.rotate([r0[0] + dl * k, r0[1] + (target[1] - r0[1]) * k, 0]);
      drawMap();
      if (f < 1) raf = requestAnimationFrame(step);
      else {
        anim = null;
        busy = false;
        done();
      }
    };
    raf = requestAnimationFrame(step);
  }

  /** At the end: the globe, zoomed out, on the last position, so the route and the missed destination show. */
  function showRoute() {
    view = 'map';
    controls.reset();
    centerOn(st.pos[0], st.pos[1]);
  }

  function nextLeg() {
    arrival = null;
    view = 'clue';
    centerOn(st.pos[0], st.pos[1]);
    render();
  }

  function buy(e: L.Extra) {
    if (busy || arrival) return;
    if (!L.buyExtra(st, run, e)) return toast(t('outOfRange'));
    save();
    if (st.done) {
      finish();
      showRoute();
    } else view = 'clue';
    render();
  }

  function askQuit() {
    if (st.done || busy) return;
    const close = modal(
      t('quitTitle'),
      h(
        'div',
        {},
        h('p', {}, t('quitText')),
        h(
          'div',
          { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => close() }, t('quitNo')),
          h(
            'button',
            {
              class: 'btn primary',
              type: 'button',
              onclick: () => {
                close();
                L.quit(st);
                arrival = null;
                save();
                finish();
                showRoute();
                render();
              },
            },
            t('quitYes'),
          ),
        ),
      ),
    );
  }

  /** Daily runs go into the stats once, when they end. */
  function finish() {
    if (free) return;
    const legs = L.legsDone(st);
    recordResult(MODE, ctx.day, legs >= L.WIN_LEGS, L.bucketFor(legs), String(legs));
  }

  // ---------------------------------------------------------------- render
  function renderHud() {
    const leg = L.currentLeg(st);
    legEl.textContent = t('leg', { n: leg + 1 });
    const ref = Math.max(L.START_FUEL, st.fuel);
    fuelFill.style.width = `${Math.max(0, Math.min(100, (100 * st.fuel) / ref))}%`;
    fuelFill.classList.toggle('low', st.fuel < 2500);
    fuelText.textContent = `${fmt(st.fuel)} km`;
    doneEl.textContent = `✓ ${t('legsDone', { n: L.legsDone(st) })}`;
  }

  function hopLine(i: number, hop: [number, number], target: L.Place): HTMLElement {
    const dir = L.compass8(L.bearing(hop[0], hop[1], target.a, target.o));
    const band = L.bandFor(L.distKm(hop[0], hop[1], target.a, target.o));
    return h('li', {}, h('span', { class: 'ex-hop-n' }, t('hopN', { n: i + 1 })), h('span', { class: 'ex-arrow', 'aria-hidden': 'true' }, ARROWS[dir]), h('span', {}, `${t(`dir${dir}`)} · ${t(`band${band}`)}`));
  }

  function renderControls() {
    const wide = matchMedia('(min-width: 900px)').matches;
    stage.dataset.view = view;
    tabClue.classList.toggle('active', view === 'clue');
    tabMap.classList.toggle('active', view === 'map');
    const leg = L.currentLeg(st);
    const target = run.legs[leg];
    const log = st.log[leg];

    // message
    if (st.done) msg.replaceChildren();
    else if (arrival) {
      const p = run.legs[arrival.leg];
      msg.replaceChildren(
        h(
          'div',
          { class: 'ex-arrival' },
          h('strong', {}, `✓ ${t('arrived', { place: placeName(p) })}`),
          h('span', { class: 'muted' }, t('arrivedSub', { hops: arrival.hops === 1 ? t('hops1') : t('hopsN', { n: arrival.hops }), fuel: fmt(arrival.refuel) })),
        ),
      );
    } else if (log.hops.length) {
      const last = log.hops[log.hops.length - 1];
      const dir = L.compass8(L.bearing(last[0], last[1], target.a, target.o));
      const band = L.bandFor(L.distKm(last[0], last[1], target.a, target.o));
      msg.replaceChildren(h('p', { class: 'ex-miss' }, t('miss', { arrow: ARROWS[dir], dir: t(`dir${dir}`), band: t(`band${band}`) })));
      if (log.hops.length > 1) msg.append(h('ol', { class: 'ex-hops' }, ...log.hops.slice(0, -1).map((hp, i) => hopLine(i, hp, target))));
    } else {
      const here = leg === 0 ? t('from', { place: placeName(run.start) }) : t('from', { place: placeName(run.legs[leg - 1]) });
      msg.replaceChildren(h('p', { class: 'ex-ask' }, h('span', { class: 'muted ex-here' }, `📍 ${here}`), view === 'map' && !wide ? t('askMap') : t('askClue')));
    }

    // extras
    extrasRow.replaceChildren(
      ...(['sun', 'flag'] as L.Extra[]).map((e) =>
        h(
          'button',
          {
            class: `btn ex-extra-btn${log?.extras.includes(e) ? ' owned' : ''}`,
            type: 'button',
            disabled: st.done || !!arrival || busy || log?.extras.includes(e) || st.fuel < L.EXTRA_COST[e],
            title: t(e === 'sun' ? 'extraSunTitle' : 'extraFlagTitle'),
            onclick: () => buy(e),
          },
          h('span', {}, t(e === 'sun' ? 'extraSun' : 'extraFlag')),
          h('small', {}, log?.extras.includes(e) ? '✓' : t('extraCost', { km: fmt(L.EXTRA_COST[e]) })),
        ),
      ),
    );

    // main button
    mainBtn.disabled = false;
    if (arrival) mainBtn.textContent = t('next');
    else if (view === 'clue' && !wide) mainBtn.textContent = t('toMap');
    else if (pending) {
      const cost = L.flightCost(L.distKm(st.pos[0], st.pos[1], pending[0], pending[1]));
      const ok = cost <= st.fuel;
      mainBtn.textContent = ok ? `✈ ${t('fly')} · ${fmt(cost)} km` : t('outOfRange');
      mainBtn.disabled = !ok;
    } else {
      mainBtn.textContent = `✈ ${t('tapFirst')}`;
      mainBtn.disabled = true;
    }
    if (busy) mainBtn.disabled = true;
    game.classList.toggle('is-done', st.done);
    quitBtn.hidden = st.done;
  }

  function renderResult() {
    if (!st.done) return resultSlot.replaceChildren();
    const legs = L.legsDone(st);
    const head = `${t(st.end === 'fuel' ? 'endFuel' : st.end === 'complete' ? 'endComplete' : 'endQuit')} · ${legs === 1 ? t('resultLeg') : t('resultLegs', { n: legs })}`;
    const last = run.legs[L.currentLeg(st)];
    const freeSaved = loadGame<L.RunState>(MODE, FREE_SLOT);
    const freeBtn = h(
      'button',
      {
        class: 'btn wide ex-free-btn',
        type: 'button',
        onclick: () => {
          if (free) saveGame(MODE, FREE_SLOT, null);
          restart(true);
        },
      },
      free ? t('freeNew') : validState(freeSaved) && !freeSaved.done ? t('freeResume') : t('freeStart'),
    );
    const detail = h(
      'div',
      {},
      h(
        'ol',
        { class: 'ex-route' },
        ...st.log
          .map((l, i) => (l.arrived ? h('li', {}, h('span', {}, placeName(run.legs[i])), h('span', {}, L.legEmoji(l))) : null))
          .filter((x): x is HTMLLIElement => !!x),
      ),
      last && !st.log[st.log.length - 1].arrived ? h('p', { class: 'ex-last' }, `💥 ${t('lastTarget', { place: placeName(last) })}`) : null,
      free ? null : freeBtn,
      h('p', { class: 'muted ex-attr' }, t('attribution')),
    );
    if (!free) {
      if (!(validState(freeSaved) && !freeSaved.done)) saveGame(MODE, FREE_SLOT, null);
      resultSlot.replaceChildren(
        resultPanel({ won: legs >= L.WIN_LEGS, headline: head, detail, share: L.shareText(ctx.day, st), mode: MODE, buckets: L.BUCKETS, label: String(legs) }),
      );
    } else {
      const share = L.shareText(0, st).replace(' #0', '').split('https://meridian.example/').join(`${location.origin}${location.pathname}`);
      resultSlot.replaceChildren(
        h(
          'section',
          { class: `result ${legs >= L.WIN_LEGS ? 'won' : 'lost'}` },
          h('h2', {}, head),
          detail,
          h('pre', { class: 'share-preview' }, share),
          h('button', { class: 'btn primary wide', type: 'button', onclick: () => copyShare(share) }, t('shareFree')),
        ),
        freeBtn,
      );
    }
  }

  function render() {
    renderHud();
    void renderClue();
    renderControls();
    drawMap();
    renderResult();
  }

  const onResize = () => renderControls();
  window.addEventListener('resize', onResize);
  offs.push(() => window.removeEventListener('resize', onResize));
  render();

  return () => {
    cancelAnimationFrame(raf);
    offs.forEach((f) => f());
  };
}
