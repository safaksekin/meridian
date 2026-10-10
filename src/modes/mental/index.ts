import './style.css';
import type { ModeContext, ModeModule } from '../types';
import { h, keepOnScreen, resultPanel, svgEl } from '../../core/ui';
import { lang, makeT } from '../../core/i18n';
import { loadJSON } from '../../core/data';
import { puzzleIndex } from '../../core/daily';
import { loadGame, recordResult, saveGame } from '../../core/storage';
import { country, countryName } from '../../core/countries';
import { flag, formatKm } from '../../core/geo';
import { drawWorld, loadWorld } from '../../core/map';
import { applySim, band, compass, evaluate, invertSim, type Evaluation, type Pt } from './fit';
import { projectAll, setProjection } from './project';
import { makePieces, RING } from './pieces';

const MODE = 'mental';
const SIZE = 1000; // canvas units (viewBox) on each side
const BUCKETS = ['90+', '75+', '60+', '40+', '<40'];
const SQUARES = ['🟩', '🟨', '🟧', '🟥'];
const BAND_CLASS = ['b0', 'b1', 'b2', 'b3'];

interface PuzzleSet {
  region: string;
  codes: string[];
}
interface State {
  pos: Record<string, Pt>;
  done: boolean;
}

const t = makeT({
  en: {
    modeName: 'Mental Map',
    r_world: 'Whole world',
    r_europe: 'Europe',
    r_africa: 'Africa',
    r_asia: 'East & South Asia',
    r_mideast: 'Middle East & Central Asia',
    r_americas: 'The Americas',
    r_oceania: 'Oceania & Southeast Asia',
    placed: 'Placed {n}/7',
    submit: 'Submit map',
    submitN: 'Place all 7 to submit',
    hintEmpty: 'Pick a country, then drop its shape here',
    hintPlace: 'Tap the canvas to place it',
    hintMove: 'Tap the canvas to move it',
    hintPick: 'Pick a country above',
    hintDone: 'All placed. Drag the countries to fine-tune, then submit.',
    canvasLabel: 'Blank canvas. Place the countries where you think they are.',
    score: 'Score',
    h90: 'Cartographer brain!',
    h75: 'Sharp mental map',
    h60: 'Solid mental map',
    h40: 'A bit warped',
    h0: 'Here be dragons',
    tiltNone: 'North stays north: you tilted the world less than 3°.',
    tiltCw: 'You turned the world {deg}° clockwise.',
    tiltCcw: 'You turned the world {deg}° anticlockwise.',
    nsOk: 'Your north–south vs east–west proportions are spot on (within 5%).',
    nsSquash: 'You squash the world north–south by {pct}% compared with east–west.',
    nsStretch: 'You stretch the world north–south by {pct}% compared with east–west.',
    worst: 'Furthest off: {name}, {km} too far {dir}.',
    d0: 'north',
    d1: 'north-east',
    d2: 'east',
    d3: 'south-east',
    d4: 'south',
    d5: 'south-west',
    d6: 'west',
    d7: 'north-west',
    legend: 'Dashed outlines: where you put each country. Green dots: the true positions, after rotating and scaling the real map to fit yours best.',
    shareScore: 'Score',
    shareTilt: 'tilt',
    shareNS: 'N–S',
    attrib: 'Map: Natural Earth (public domain).',
    how1: 'Place the shapes of seven countries on a blank canvas from memory. No map, no grid. All shapes are drawn at the same scale, north up.',
    how2: 'Pick a name: the country\'s shape follows your pointer. Tap the canvas to drop it, drag it to adjust. When all seven are placed, submit.',
    how3: 'Only the shape of your map matters: we slide, scale and rotate the real map until it fits yours best, then measure how far each country is off in km.',
    howEx: 'Example: Spain, Finland and Greece. Put Spain bottom-left, Finland top-right, Greece bottom-right. Even if your whole map is tilted 10° and fills the canvas, only the leftover errors count. Afterwards you learn your bias, e.g. “you turn the world 9° clockwise and squash it north–south by 18%”.',
  },
  tr: {
    modeName: 'Zihin Haritası',
    r_world: 'Tüm dünya',
    r_europe: 'Avrupa',
    r_africa: 'Afrika',
    r_asia: 'Doğu ve Güney Asya',
    r_mideast: 'Orta Doğu ve Orta Asya',
    r_americas: 'Amerika kıtası',
    r_oceania: 'Okyanusya ve Güneydoğu Asya',
    placed: 'Yerleşen {n}/7',
    submit: 'Haritayı gönder',
    submitN: 'Göndermek için 7 ülkeyi de yerleştir',
    hintEmpty: 'Bir ülke seç, sonra şeklini buraya bırak',
    hintPlace: 'Yerleştirmek için tuvale dokun',
    hintMove: 'Taşımak için tuvale dokun',
    hintPick: 'Yukarıdan bir ülke seç',
    hintDone: 'Hepsi yerleşti. Ülkeleri sürükleyip ince ayar yap, sonra gönder.',
    canvasLabel: 'Boş tuval. Ülkeleri olduklarını düşündüğün yere koy.',
    score: 'Puan',
    h90: 'Kartograf beyni!',
    h75: 'Keskin bir zihin haritası',
    h60: 'Sağlam bir zihin haritası',
    h40: 'Biraz eğri büğrü',
    h0: 'Burada ejderhalar var',
    tiltNone: 'Kuzey yerinde: dünyayı 3°’den az eğdin.',
    tiltCw: 'Dünyayı saat yönünde {deg}° döndürdün.',
    tiltCcw: 'Dünyayı saat yönünün tersine {deg}° döndürdün.',
    nsOk: 'Kuzey–güney ve doğu–batı oranların yerinde (%5 içinde).',
    nsSquash: 'Dünyayı doğu–batıya göre kuzey–güney yönünde %{pct} basıklaştırıyorsun.',
    nsStretch: 'Dünyayı doğu–batıya göre kuzey–güney yönünde %{pct} uzatıyorsun.',
    worst: 'En çok şaşan: {name}, {km} fazla {dir} yönüne kaymış.',
    d0: 'kuzey',
    d1: 'kuzeydoğu',
    d2: 'doğu',
    d3: 'güneydoğu',
    d4: 'güney',
    d5: 'güneybatı',
    d6: 'batı',
    d7: 'kuzeybatı',
    legend: 'Kesikli çizgiler: ülkeleri koyduğun yerler. Yeşil noktalar: gerçek harita seninkine en iyi oturacak şekilde döndürülüp ölçeklendikten sonraki gerçek konumlar.',
    shareScore: 'Puan',
    shareTilt: 'eğim',
    shareNS: 'K–G',
    attrib: 'Harita: Natural Earth (kamu malı).',
    how1: 'Yedi ülkenin şeklini boş bir tuvale ezberden yerleştir. Harita yok, ızgara yok. Bütün şekiller aynı ölçekte ve kuzey yukarıda.',
    how2: 'Bir ülke adı seç: ülkenin şekli imlecinle birlikte hareket eder. Bırakmak için tuvale dokun, ayarlamak için sürükle. Yedisi de yerleşince gönder.',
    how3: 'Yalnızca haritanın şekli önemli: gerçek haritayı seninkine en iyi oturana dek kaydırır, ölçekler ve döndürürüz; sonra her ülkenin kaç km şaştığını ölçeriz.',
    howEx: 'Örnek: İspanya, Finlandiya ve Yunanistan. İspanya’yı sol alta, Finlandiya’yı sağ üste, Yunanistan’ı sağ alta koy. Haritan 10° eğik olsa ve tüm tuvali kaplasa bile yalnızca kalan hatalar sayılır. Sonunda eğilimini öğrenirsin, ör. “dünyayı saat yönünde 9° döndürüp kuzey–güney yönünde %18 basıklaştırıyorsun”.',
  },
});

/** Short marker labels for long names; anything else is cut by CSS. */
const SHORT: Record<'en' | 'tr', Record<string, string>> = {
  en: { US: 'USA', GB: 'UK', AE: 'UAE', CF: 'C. African Rep.', BA: 'Bosnia', DO: 'Dominican Rep.', PG: 'Papua N. G.', CD: 'DR Congo', CG: 'Congo', SA: 'Saudi Arabia', TT: 'Trinidad', GQ: 'Eq. Guinea', MK: 'N. Macedonia' },
  tr: { US: 'ABD', GB: 'Birleşik Krallık', AE: 'BAE', CF: 'Orta Afrika C.', BA: 'Bosna-Hersek', DO: 'Dominik C.', PG: 'Papua Y. G.', CD: 'Kongo DC', CG: 'Kongo', SA: 'S. Arabistan', TT: 'Trinidad', GQ: 'Ekv. Ginesi', MK: 'K. Makedonya', CZ: 'Çekya' },
};
const shortName = (code: string) => SHORT[lang][code] ?? countryName(code);

const clamp = (v: number) => Math.max(0, Math.min(SIZE, v));

let cleanup: (() => void) | null = null;

async function mount(ctx: ModeContext) {
  const [sets, world] = await Promise.all([loadJSON<PuzzleSet[]>('mental/sets.json'), loadWorld()]);
  const set = sets[puzzleIndex(ctx.day, sets.length)];
  const codes = set.codes;
  const pieces = makePieces(codes, codes.map((c) => country(c)), set.region === 'world', world.countries, SIZE);
  const saved = loadGame<State>(MODE, ctx.day);
  const state: State = {
    pos: saved?.pos && typeof saved.pos === 'object' ? { ...saved.pos } : {},
    done: !!saved?.done,
  };
  for (const k of Object.keys(state.pos)) if (!codes.includes(k)) delete state.pos[k];
  if (state.done && codes.some((c) => !state.pos[c])) state.done = false;
  let selected: string | null = state.done ? null : (codes.find((c) => !state.pos[c]) ?? null);
  const save = () => saveGame(MODE, ctx.day, state);

  // ---------- DOM ----------
  const counter = h('span', { class: 'mm-counter', 'aria-live': 'polite' });
  const head = h('div', { class: 'mm-head' }, h('span', { class: 'mm-theme' }, t(`r_${set.region}`)), counter);
  const chipEls = new Map<string, HTMLButtonElement>();
  const chips = h('div', { class: 'mm-chips', role: 'group' });
  for (const code of codes) {
    const b = h('button', { class: 'mm-chip', type: 'button', onclick: () => select(code) }, h('span', { class: 'mm-flag', 'aria-hidden': 'true' }, flag(code)), h('span', {}, countryName(code)));
    chipEls.set(code, b);
    chips.append(b);
  }
  // Shapes live in the svg (canvas units); their name tags are HTML on top so the text stays crisp.
  const shapes = svgEl('g', { class: 'mm-pieces' });
  const ghost = svgEl('g', { class: 'mm-ghost' });
  const svg = svgEl('svg', { viewBox: `0 0 ${SIZE} ${SIZE}`, class: 'mm-svg', 'aria-hidden': 'true' });
  svg.append(shapes, ghost);
  const nameTag = (code: string) => h('span', { class: 'mm-label' }, h('span', { class: 'mm-flag', 'aria-hidden': 'true' }, flag(code)), h('span', { class: 'mm-name' }, shortName(code)));
  const ghostTag = h('div', { class: 'mm-marker ghost', hidden: '' });
  const markers = h('div', { class: 'mm-markers' }, ghostTag);
  const hint = h('div', { class: 'mm-hint' });
  const board = h('div', { class: 'mm-board', role: 'application', 'aria-label': t('canvasLabel') }, svg, hint, markers);
  const status = h('p', { class: 'mm-status' });
  const submit = h('button', { class: 'btn primary wide mm-submit', type: 'button', onclick: () => finish() }, t('submit'));
  const after = h('div', { class: 'mm-after' });
  board.classList.add('split-visual');
  ctx.root.append(h('div', { class: 'mm-game split' }, h('div', { class: 'mm-col split-pre' }, head, chips), board, h('div', { class: 'mm-col split-post' }, status, submit, after)));
  keepOnScreen(board, () => submit);

  const shapeEls = new Map<string, SVGGElement>();
  const tagEls = new Map<string, HTMLElement>();
  let dragging = false; // a placed piece is being moved: the piece in hand stays out of the way

  function boardPoint(e: PointerEvent | MouseEvent): Pt {
    const r = board.getBoundingClientRect();
    return [clamp(((e.clientX - r.left) / r.width) * SIZE), clamp(((e.clientY - r.top) / r.height) * SIZE)];
  }

  /** The scored point of a piece held at `pt` (pieces are held by their middle, which stays on the canvas). */
  function fromHold(code: string, pt: Pt): Pt {
    const hold = pieces.get(code)!.hold;
    return [Math.round(clamp(pt[0]) - hold[0]), Math.round(clamp(pt[1]) - hold[1])];
  }

  function shapeParts(code: string): SVGElement[] {
    const pc = pieces.get(code)!;
    const parts: SVGElement[] = [];
    if (pc.tiny) parts.push(svgEl('circle', { cx: pc.hold[0], cy: pc.hold[1], r: RING, class: 'mm-ring' }));
    parts.push(pc.d ? svgEl('path', { d: pc.d }) : svgEl('circle', { r: 5, class: 'mm-speck' }));
    return parts;
  }

  /**
   * The name tag sits inside a shape that has room for it, otherwise just above or below it:
   * above unless that is off the canvas or on top of another tag.
   */
  function placeTag(el: HTMLElement, code: string, p: Pt) {
    const { box } = pieces.get(code)!;
    const frame = board.getBoundingClientRect();
    const px = frame.width / SIZE; // screen px per canvas unit
    const label = el.firstElementChild as HTMLElement;
    const w = label.offsetWidth;
    const ht = label.offsetHeight;
    const roomy = (box[2] - box[0]) * px >= w * 0.9 && (box[3] - box[1]) * px >= ht * 1.7;
    const x = clamp(p[0] + (box[0] + box[2]) / 2);
    const left = x * px - (x / SIZE) * w;
    const others = [...tagEls.values()].filter((o) => o !== el).map((o) => (o.firstElementChild as HTMLElement).getBoundingClientRect());
    const clear = (top: number) => !others.some((o) => o.left - frame.left < left + w && o.right - frame.left > left && o.top - frame.top < top + ht && o.bottom - frame.top > top);
    const above = clamp(p[1] + box[1] - 8);
    const under = clamp(p[1] + box[3] + 8);
    const below = !roomy && (p[1] + box[1] < 110 ? clear(under * px) || !clear(above * px - ht) : !clear(above * px - ht) && clear(under * px));
    const y = roomy ? clamp(p[1] + (box[1] + box[3]) / 2) : below ? under : above;
    el.style.left = `${x / 10}%`;
    el.style.top = `${y / 10}%`;
    el.style.setProperty('--fx', String(x / SIZE));
    el.classList.toggle('mid', roomy);
    el.classList.toggle('below', below);
  }

  function position(code: string) {
    const p = state.pos[code];
    shapeEls.get(code)!.setAttribute('transform', `translate(${p[0]} ${p[1]})`);
    placeTag(tagEls.get(code)!, code, p);
  }

  /** Dragging the shape or its name tag moves the piece; a plain tap selects it. */
  function grab(el: HTMLElement | SVGElement, code: string) {
    let drag: { id: number; off: Pt; sx: number; sy: number; moved: boolean } | null = null;
    const on = (type: string, fn: (e: PointerEvent) => void) => el.addEventListener(type, fn as EventListener);
    on('pointerdown', (e) => {
      if (state.done || e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      el.setPointerCapture(e.pointerId);
      const p = boardPoint(e);
      const cur = state.pos[code];
      drag = { id: e.pointerId, off: [cur[0] - p[0], cur[1] - p[1]], sx: e.clientX, sy: e.clientY, moved: false };
    });
    on('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return;
      if (!drag.moved) {
        drag.moved = dragging = true;
        hideGhost();
        shapeEls.get(code)!.classList.add('dragging');
        tagEls.get(code)!.classList.add('dragging');
      }
      const p = boardPoint(e);
      const hold = pieces.get(code)!.hold;
      state.pos[code] = fromHold(code, [p[0] + drag.off[0] + hold[0], p[1] + drag.off[1] + hold[1]]);
      position(code);
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      dragging = false;
      shapeEls.get(code)!.classList.remove('dragging');
      tagEls.get(code)!.classList.remove('dragging');
      if (moved) {
        rest(e);
        save();
        update();
      } else if (e.type === 'pointerup' && selected && selected !== code && !state.pos[selected]) {
        // a country is waiting to be placed: a tap on a shape that is in the way drops it there
        placeSelected(boardPoint(e));
        rest(e);
      } else if (e.type === 'pointerup') {
        select(code);
      }
    };
    on('pointerup', end);
    on('pointercancel', end);
  }

  function makePiece(code: string) {
    const shape = svgEl('g', { class: 'mm-piece', 'data-code': code });
    shape.append(...shapeParts(code));
    const tag = h('div', { class: 'mm-marker', tabindex: '0', 'data-code': code, title: countryName(code), 'aria-label': countryName(code) }, nameTag(code));
    tag.addEventListener('keydown', (e) => {
      if (state.done) return;
      const step = e.shiftKey ? 40 : 10;
      const d: Record<string, Pt> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      const v = d[e.key];
      if (!v) return;
      e.preventDefault();
      const cur = state.pos[code];
      const hold = pieces.get(code)!.hold;
      state.pos[code] = fromHold(code, [cur[0] + v[0] + hold[0], cur[1] + v[1] + hold[1]]);
      position(code);
      save();
    });
    grab(shape, code);
    grab(tag, code);
    shapeEls.set(code, shape);
    tagEls.set(code, tag);
    markers.append(tag);
    // small pieces on top, so a big one never buries them
    const order = [...shapeEls.keys()].sort((a, b) => pieces.get(b)!.size - pieces.get(a)!.size);
    shapes.replaceChildren(...order.map((c) => shapeEls.get(c)!));
  }

  // ----- the piece in hand: the selected country's shape follows the pointer -----
  let ghostCode: string | null = null;
  let restAt: { x: number; y: number } | null = null; // after a drop the next piece waits until the pointer moves on

  function showGhost(pt: Pt) {
    if (!selected || state.done) return hideGhost();
    if (ghostCode !== selected) {
      ghostCode = selected;
      ghost.replaceChildren(...shapeParts(selected));
      ghostTag.replaceChildren(nameTag(selected));
    }
    const p = fromHold(selected, pt);
    ghost.setAttribute('transform', `translate(${p[0]} ${p[1]})`);
    ghost.style.display = '';
    ghostTag.hidden = false;
    placeTag(ghostTag, selected, p);
  }
  function hideGhost() {
    ghost.style.display = 'none';
    ghostTag.hidden = true;
  }
  function rest(e: PointerEvent) {
    restAt = { x: e.clientX, y: e.clientY };
    hideGhost();
  }
  hideGhost();

  let placing: number | null = null;
  board.addEventListener('pointerdown', (e) => {
    if (state.done || !selected || e.button > 0) return;
    e.preventDefault();
    placing = e.pointerId;
    board.setPointerCapture(e.pointerId);
    restAt = null;
    showGhost(boardPoint(e));
  });
  board.addEventListener('pointermove', (e) => {
    if (dragging || (placing === null ? e.pointerType === 'touch' : e.pointerId !== placing)) return;
    if (restAt && Math.hypot(e.clientX - restAt.x, e.clientY - restAt.y) < 14) return;
    restAt = null;
    showGhost(boardPoint(e));
  });
  board.addEventListener('pointerup', (e) => {
    if (e.pointerId !== placing) return;
    placing = null;
    placeSelected(boardPoint(e));
    rest(e);
  });
  board.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== placing) return;
    placing = null;
    hideGhost();
  });
  board.addEventListener('pointerleave', () => {
    if (placing === null) hideGhost();
  });

  function select(code: string) {
    if (state.done) return;
    selected = selected === code && state.pos[code] ? null : code;
    hideGhost();
    update();
  }

  function placeSelected(pt: Pt) {
    if (!selected) return;
    const code = selected;
    state.pos[code] = fromHold(code, pt);
    if (!shapeEls.has(code)) makePiece(code);
    position(code);
    const el = shapeEls.get(code)!;
    el.classList.remove('pop');
    void el.getBoundingClientRect(); // restart the drop animation
    el.classList.add('pop');
    selected = codes.find((c) => !state.pos[c]) ?? null;
    save();
    update();
  }

  function update() {
    const n = codes.filter((c) => state.pos[c]).length;
    counter.textContent = t('placed', { n });
    counter.classList.toggle('full', n === 7);
    for (const [code, b] of chipEls) {
      b.classList.toggle('sel', code === selected);
      b.classList.toggle('placed', !!state.pos[code]);
      b.setAttribute('aria-pressed', String(code === selected));
      b.disabled = state.done;
    }
    for (const [code, el] of shapeEls) el.classList.toggle('sel', code === selected);
    for (const [code, el] of tagEls) el.classList.toggle('sel', code === selected);
    board.classList.toggle('armed', !!selected && !state.done);
    hint.textContent = n === 0 ? t('hintEmpty') : '';
    hint.hidden = n > 0;
    status.textContent = state.done ? '' : selected ? t(state.pos[selected] ? 'hintMove' : 'hintPlace') : n === 7 ? t('hintDone') : t('hintPick');
    submit.hidden = state.done;
    submit.disabled = n < 7;
    submit.textContent = n < 7 ? t('submitN') : t('submit');
  }

  for (const code of codes) {
    if (!state.pos[code]) continue;
    makePiece(code);
    position(code);
  }
  update();
  // Whether a tag fits inside its shape depends on the canvas size on screen.
  const tagFit = new ResizeObserver(() => {
    for (const [code, el] of tagEls) placeTag(el, code, state.pos[code]);
  });
  tagFit.observe(board);

  // ---------- scoring & reveal ----------
  function evaluateNow() {
    const places = codes.map((c) => country(c));
    const proj = setProjection(places, set.region === 'world');
    const truth = projectAll(proj, places);
    const ev = evaluate(codes.map((c) => state.pos[c]), truth);
    return { proj, truth, ev };
  }

  function finish() {
    if (state.done || codes.some((c) => !state.pos[c])) return;
    state.done = true;
    selected = null;
    save();
    const { ev } = evaluateNow();
    recordResult(MODE, ctx.day, ev.score >= 60, bucketFor(ev.score), `${ev.score}/100`);
    update();
    void reveal(true);
  }

  async function reveal(animate: boolean) {
    const { proj, truth, ev } = evaluateNow();
    const inv = invertSim(ev.sim); // true km → canvas
    board.classList.add('revealed');
    if (animate) board.classList.add('animate');
    for (const m of tagEls.values()) m.removeAttribute('tabindex');
    hideGhost();

    // Real-world layers in the player's frame.
    const worldSvg = svgEl('svg', { x: 0, y: 0, width: SIZE, height: SIZE, class: 'mm-world' });
    const lines = svgEl('g', { class: 'mm-lines' });
    svg.replaceChildren(worldSvg, shapes, lines);
    codes.forEach((code, i) => {
      const tp = applySim(inv, truth[i]);
      const pp = state.pos[code];
      const cls = BAND_CLASS[band(ev.errs[i], ev.spread)];
      lines.append(svgEl('line', { x1: tp[0], y1: tp[1], x2: pp[0], y2: pp[1], class: `mm-err ${cls}`, pathLength: 1 }));
      lines.append(svgEl('circle', { cx: tp[0], cy: tp[1], r: 9, class: 'mm-true' }));
      shapeEls.get(code)?.classList.add(cls);
      tagEls.get(code)?.classList.add(cls);
    });
    renderResult(ev);
    try {
      const world = await loadWorld();
      const inSet = new Set(codes);
      drawWorld(worldSvg, proj, world, (c) => (inSet.has(c) ? 'var(--mm-set-land)' : null));
      const cs = inv.s * Math.cos(inv.theta);
      const sn = inv.s * Math.sin(inv.theta);
      const m = `matrix(${cs} ${sn} ${-sn} ${cs} ${inv.tx} ${inv.ty})`;
      for (const g of Array.from(worldSvg.children)) g.setAttribute('transform', m);
    } catch (err) {
      console.error(err);
    }
  }

  function renderResult(ev: Evaluation) {
    const score = ev.score;
    const headline = score >= 90 ? t('h90') : score >= 75 ? t('h75') : score >= 60 ? t('h60') : score >= 40 ? t('h40') : t('h0');
    const tiltDeg = Math.round(Math.abs(ev.tilt));
    const lines: string[] = [];
    lines.push(Math.abs(ev.tilt) < 3 ? t('tiltNone') : t(ev.tilt > 0 ? 'tiltCw' : 'tiltCcw', { deg: tiltDeg }));
    if (ev.ns != null && set.region !== 'world') {
      const pct = Math.round(Math.abs(ev.ns));
      lines.push(Math.abs(ev.ns) < 5 ? t('nsOk') : t(ev.ns < 0 ? 'nsSquash' : 'nsStretch', { pct }));
    }
    const w = ev.worst;
    const wv = ev.vecs[w];
    const worstLine = t('worst', { name: `${flag(codes[w])} ${countryName(codes[w])}`, km: formatKm(ev.errs[w]), dir: t(`d${compass(wv[0], wv[1])}`) });

    const order = codes.map((_, i) => i).sort((a, b) => ev.errs[a] - ev.errs[b]);
    const detail = h(
      'div',
      { class: 'mm-detail' },
      h('div', { class: 'mm-score' }, h('strong', {}, String(score)), h('span', {}, `/100 · ${t('score')}`)),
      h('ul', { class: 'mm-bias' }, ...lines.map((l) => h('li', {}, l)), h('li', { class: 'mm-worst' }, worstLine)),
      h(
        'ol',
        { class: 'mm-errs' },
        ...order.map((i) =>
          h(
            'li',
            {},
            h('span', { class: 'mm-sq', 'aria-hidden': 'true' }, SQUARES[band(ev.errs[i], ev.spread)]),
            h('span', { class: 'mm-ename' }, `${flag(codes[i])} ${countryName(codes[i])}`),
            h('span', { class: 'mm-km' }, formatKm(ev.errs[i])),
          ),
        ),
      ),
      h('p', { class: 'mm-legend' }, t('legend')),
      h('p', { class: 'mm-attrib' }, t('attrib')),
    );

    const sign = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '');
    const tiltTxt = tiltDeg === 0 ? '0°' : `${tiltDeg}°${ev.tilt > 0 ? '↻' : '↺'}`;
    const ns = ev.ns == null || set.region === 'world' ? null : Math.round(ev.ns);
    const share = [
      `Meridian Mental Map #${ctx.day}`,
      codes.map((_, i) => SQUARES[band(ev.errs[i], ev.spread)]).join(''),
      `🧠 ${t('shareScore')} ${score} · ${t('shareTilt')} ${tiltTxt}${ns == null ? '' : ` · ${t('shareNS')} ${sign(ns)}${Math.abs(ns)}%`}`,
      'https://meridian.example/#/mental',
    ].join('\n');
    after.replaceChildren(resultPanel({ won: score >= 60, headline, detail, share, mode: MODE, buckets: BUCKETS, label: `${score}/100` }));
  }

  if (state.done) void reveal(false);

  cleanup = () => {
    tagFit.disconnect();
    shapeEls.clear();
    tagEls.clear();
  };
}

function bucketFor(score: number): string {
  return score >= 90 ? '90+' : score >= 75 ? '75+' : score >= 60 ? '60+' : score >= 40 ? '40+' : '<40';
}

const mode: ModeModule = {
  mount,
  unmount() {
    cleanup?.();
    cleanup = null;
  },
  howTo: () =>
    h(
      'div',
      { class: 'mm-howto' },
      h('p', {}, t('how1')),
      h('p', {}, t('how2')),
      h('p', {}, t('how3')),
      h('p', { class: 'howto-example' }, t('howEx')),
    ),
};
export default mode;
