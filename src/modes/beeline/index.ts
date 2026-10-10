import './style.css';
import { geoOrthographic, geoPath, type GeoProjection } from 'd3-geo';
import type { ModeModule, ModeContext } from '../types';
import { h, svgEl, autocomplete, resultPanel, toast } from '../../core/ui';
import { makeT, lang } from '../../core/i18n';
import { loadJSON } from '../../core/data';
import { puzzleIndex } from '../../core/daily';
import { loadGame, saveGame, recordResult } from '../../core/storage';
import { countryItems, countryName } from '../../core/countries';
import { loadWorld, drawWorld } from '../../core/map';
import { flag, formatKm } from '../../core/geo';
import { scoreRow, isSolved, solvedPrefix, windName, pad3, emojiRow, MAX_ROWS } from './logic';

interface Hit { c: string; km: number; lat: number; lon: number }
interface Puzzle { city: string; cc: string; lat: number; lon: number; b: number; hits: Hit[]; path: [number, number][]; surprise: boolean; rhumb: string[] | null }
interface State { rows: string[][]; draft: (string | null)[]; done: boolean }

const MODE = 'beeline';
const BUCKETS = ['1', '2', '3', '4', '5', '6', 'X'];
const t = makeT({
  en: {
    from: 'From',
    head: 'head',
    straight: 'and keep going in a perfectly straight line on the globe.',
    which: 'Which 5 countries do you enter, in order?',
    submit: 'Submit',
    clear: 'Clear',
    fill: 'Fill all 5 slots',
    dupe: 'Each country only once per row',
    start: 'You start in {c}. It does not count.',
    rhumb: 'With a constant compass heading instead (a rhumb line) you would have entered: {list}. Straight lines on a globe curve on a flat map.',
    solvedIn: 'Solved in {n}/6',
    lostTitle: 'The line went through',
    dragHint: 'Drag the globe to look around',
    howIntro: 'Start at today\'s city and walk in a perfectly straight line (a great circle) in the given compass direction. Name the first five countries you enter, in order. The start country does not count.',
    howTiles: '🟩 right country, right position. 🟨 the line enters this country, but at another position. ⬛ not among the five.',
    howHint: 'After each guess the line on the globe grows up to the first country you have not found yet.',
    howEx: 'Example: Madrid, due east (090°). The straight line clips Sardinia (Italy), crosses Greece, and makes landfall in Lebanon. Not Turkey!',
    howCurve: 'Tip: on a globe, "due east" slowly bends towards the equator.',
  },
  tr: {
    from: 'Başlangıç',
    head: 'yön',
    straight: 've küre üzerinde dümdüz ilerle.',
    which: 'Sırasıyla hangi 5 ülkeye girersin?',
    submit: 'Gönder',
    clear: 'Temizle',
    fill: '5 kutunun hepsini doldur',
    dupe: 'Bir satırda her ülke bir kez',
    start: 'Başlangıç ülken {c}. O sayılmaz.',
    rhumb: 'Pusulayı hep aynı açıda tutsaydın (loksodrom) şu ülkelere girerdin: {list}. Kürede düz çizgiler düz haritada eğri görünür.',
    solvedIn: '{n}/6 tahminde bildin',
    lostTitle: 'Çizginin geçtiği ülkeler',
    dragHint: 'Etrafa bakmak için küreyi sürükle',
    howIntro: 'Günün şehrinden başla ve verilen pusula yönünde küre üzerinde dümdüz (büyük daire boyunca) yürü. Sırasıyla girdiğin ilk beş ülkeyi bul. Başlangıç ülkesi sayılmaz.',
    howTiles: '🟩 doğru ülke, doğru sıra. 🟨 çizgi bu ülkeye giriyor ama başka sırada. ⬛ beş ülke arasında değil.',
    howHint: 'Her tahminden sonra küredeki çizgi, henüz bulamadığın ilk ülkeye kadar uzar.',
    howEx: 'Örnek: Madrid, tam doğu (090°). Düz çizgi Sardunya\'yı (İtalya) sıyırır, Yunanistan\'ı geçer ve Lübnan\'da karaya çıkar. Türkiye\'ye değil!',
    howCurve: 'İpucu: kürede "tam doğu" yavaşça ekvatora doğru kıvrılır.',
  },
});

let cleanup: (() => void) | null = null;

const mode: ModeModule = {
  async mount(ctx: ModeContext) {
    const [puzzles, world] = await Promise.all([loadJSON<Puzzle[]>('beeline/puzzles.json'), loadWorld()]);
    const p = puzzles[puzzleIndex(ctx.day, puzzles.length)];
    const answer = p.hits.map((x) => x.c);
    const state: State = loadGame<State>(MODE, ctx.day) ?? { rows: [], draft: [null, null, null, null, null], done: false };
    const save = () => saveGame(MODE, ctx.day, state);

    // ----- prompt -----
    const needle = svgEl('svg', { viewBox: '-12 -12 24 24', class: 'bl-needle', 'aria-hidden': 'true' });
    const arrow = svgEl('path', { d: 'M0,-10 L5,6 L0,3 L-5,6 Z', fill: 'currentColor', transform: `rotate(${p.b})` });
    needle.append(svgEl('circle', { r: 11, fill: 'none', stroke: 'currentColor', 'stroke-opacity': 0.3 }), arrow);
    const prompt = h(
      'div',
      { class: 'bl-prompt' },
      h('div', {}, `${t('from')} `, h('strong', {}, `${p.city} ${flag(p.cc)}`), `, ${t('head')} `,
        h('span', { class: 'bl-bearing' }, needle, `${pad3(p.b)}° ${windName(p.b, lang)}`)),
      h('div', { class: 'muted' }, t('straight')),
      h('div', {}, h('strong', {}, t('which'))),
    );

    // ----- globe -----
    const size = 380;
    const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, role: 'img', 'aria-label': t('dragHint') });
    const proj: GeoProjection = geoOrthographic().scale(size / 2 - 4).translate([size / 2, size / 2]).clipAngle(90).precision(0.3);
    const centerOn = (lon: number, lat: number) => proj.rotate([-lon, -lat * 0.85]);
    // Aim the view a little along the route so the first leg is visible.
    const lead = p.path[Math.min(3, p.path.length - 1)];
    centerOn((p.lon + lead[0]) / 2, (p.lat + lead[1]) / 2);

    const drawGlobe = () => {
      const k = state.done ? 5 : solvedPrefix(state.rows, answer);
      const highlight = new Map<string, string>();
      if (state.done) answer.forEach((c) => highlight.set(c, 'color-mix(in srgb, var(--danger) 35%, var(--land))'));
      else answer.slice(0, k).forEach((c) => highlight.set(c, 'color-mix(in srgb, var(--good) 45%, var(--land))'));
      highlight.set(p.cc, 'color-mix(in srgb, var(--accent) 30%, var(--land))');
      const { layer } = drawWorld(svg, proj, world, (c) => highlight.get(c) ?? null);
      const path = geoPath(proj);
      // Line: hint stub (~600 km), or up to the entry of the first unsolved country, or all of it.
      const endKm = state.done ? Infinity : k === 0 ? 600 : p.hits[k].km;
      const coords = lineUpTo(p, endKm);
      layer.append(svgEl('path', { d: path({ type: 'LineString', coordinates: coords }) ?? '', class: `bl-path ${state.done ? '' : 'hint'}` }));
      const sp = proj([p.lon, p.lat]);
      if (sp && visible(proj, p.lon, p.lat)) layer.append(svgEl('circle', { cx: sp[0], cy: sp[1], r: 5, class: 'bl-start' }));
      const shown = state.done ? 5 : k;
      p.hits.slice(0, shown).forEach((hit, i) => {
        const q = proj([hit.lon, hit.lat]);
        if (!q || !visible(proj, hit.lon, hit.lat)) return;
        layer.append(svgEl('circle', { cx: q[0], cy: q[1], r: 8, class: 'bl-hit' }));
        const tx = svgEl('text', { x: q[0], y: q[1] + 0.5, class: 'bl-hit-label' });
        tx.textContent = String(i + 1);
        layer.append(tx);
      });
    };
    const globe = h('div', { class: 'mapbox bl-globe' }, svg);
    enableDrag(svg, proj, drawGlobe);

    // ----- board -----
    const board = h('div', { class: 'board', 'aria-live': 'polite' });
    const actions = h('div', { class: 'bl-actions' });
    const inputSlot = h('div');
    const resultSlot = h('div');

    const ac = autocomplete({
      items: () => countryItems((c) => c.c !== p.cc && !state.draft.includes(c.c)),
      placeholder: t('typeCountry'),
      buttonLabel: '+',
      onPick: (item) => {
        const i = state.draft.indexOf(null);
        if (i < 0) return toast(t('fill'));
        state.draft[i] = item.id;
        save();
        render();
        ac.focus();
      },
    });

    function cell(code: string | null, cls: string, idx?: number): HTMLElement {
      return h(
        'div',
        { class: `bl-cell ${cls} ${code && countryName(code).length > 10 ? 'long' : ''}` },
        code ? h('span', {}, h('span', { class: 'fl' }, flag(code)), countryName(code)) : h('span', { class: 'num' }, String((idx ?? 0) + 1)),
      );
    }

    function submit() {
      if (state.draft.some((d) => !d)) return toast(t('fill'));
      const row = state.draft as string[];
      if (new Set(row).size !== row.length) return toast(t('dupe'));
      state.rows.push([...row]);
      const won = isSolved(state.rows, answer);
      if (won || state.rows.length >= MAX_ROWS) {
        state.done = true;
        recordResult(MODE, ctx.day, won, won ? String(state.rows.length) : 'X', won ? `${state.rows.length}/6` : 'X/6');
      } else {
        // carry greens forward, clear the rest
        state.draft = answer.map((a, i) => (state.rows.some((r) => r[i] === a) ? a : null));
      }
      save();
      render();
    }

    function render() {
      const rows = state.rows.map((r) => h('div', { class: 'bl-row' }, ...scoreRow(r, answer).map((tile, i) => cell(r[i], tile))));
      if (!state.done) {
        const next = state.draft.indexOf(null);
        rows.push(
          h(
            'div',
            { class: 'bl-row' },
            ...state.draft.map((d, i) => {
              const el = cell(d, `slot ${d ? 'filled' : ''} ${i === next ? 'next' : ''}`, i);
              el.addEventListener('click', () => {
                if (!state.draft[i]) return;
                state.draft[i] = null;
                save();
                render();
              });
              return el;
            }),
          ),
        );
        for (let i = state.rows.length + 1; i < MAX_ROWS; i++)
          rows.push(h('div', { class: 'bl-row' }, ...[0, 1, 2, 3, 4].map(() => h('div', { class: 'bl-cell', style: { opacity: '0.35' } }))));
      }
      board.replaceChildren(...rows);
      inputSlot.replaceChildren(state.done ? '' : ac.el);
      actions.replaceChildren(
        ...(state.done
          ? []
          : [
              h('button', { class: 'btn', onclick: () => { state.draft = answer.map((a, i) => (state.rows.some((r) => r[i] === a) ? a : null)); save(); render(); } }, t('clear')),
              h('button', { class: 'btn primary', disabled: state.draft.some((d) => !d), onclick: submit }, t('submit')),
            ]),
      );
      drawGlobe();
      if (state.done) {
        const won = isSolved(state.rows, answer);
        const share = [
          `Meridian Beeline #${ctx.day}`,
          `🧭 ${p.city} ${flag(p.cc)} ${pad3(p.b)}°`,
          ...state.rows.map((r) => emojiRow(scoreRow(r, answer))),
          won ? `${state.rows.length}/6` : 'X/6',
          'https://meridian.example/#/beeline',
        ].join('\n');
        const detail = h(
          'div',
          {},
          h('p', { class: 'muted' }, t('lostTitle')),
          h('ol', { class: 'bl-reveal' }, ...p.hits.map((x) => h('li', {}, h('span', {}, `${flag(x.c)} ${countryName(x.c)}`), h('span', { class: 'muted' }, formatKm(x.km))))),
          p.surprise && p.rhumb ? h('p', { class: 'bl-fact' }, t('rhumb', { list: p.rhumb.map(countryName).join(', ') })) : null,
        );
        resultSlot.replaceChildren(
          resultPanel({ won, headline: won ? `${t('solved')} ${t('solvedIn', { n: state.rows.length })}` : t('failed'), detail, share, mode: MODE, buckets: BUCKETS, label: won ? `${state.rows.length}/6` : 'X/6' }),
        );
        // show the whole route
        const mid = p.path[Math.floor(p.path.length / 2)];
        centerOn(mid[0], mid[1]);
        drawGlobe();
      }
    }

    ctx.root.append(
      h('div', { class: 'panel' }, prompt, globe, h('p', { class: 'muted center', style: { fontSize: '0.8rem', margin: '0 0 6px' } }, `${t('start', { c: countryName(p.cc) })} · ${t('dragHint')}`)),
      board,
      inputSlot,
      actions,
      resultSlot,
    );
    render();
    cleanup = () => {};
  },
  unmount() {
    cleanup?.();
    cleanup = null;
  },
  howTo() {
    return h(
      'div',
      {},
      h('p', {}, t('howIntro')),
      h('p', {}, t('howTiles')),
      h('p', {}, t('howHint')),
      h('p', { class: 'howto-example' }, t('howEx')),
      h('p', { class: 'muted' }, t('howCurve')),
    );
  },
};
export default mode;

/** Waypoints of the route up to `km` along it (waypoints are every 500 km). */
function lineUpTo(p: Puzzle, km: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < p.path.length; i++) {
    const at = i * 500;
    if (at <= km) out.push(p.path[i]);
    else {
      // interpolate the last partial segment
      const prev = p.path[i - 1];
      const f = (km - (i - 1) * 500) / 500;
      const cur = p.path[i];
      let dLon = cur[0] - prev[0];
      if (dLon > 180) dLon -= 360;
      if (dLon < -180) dLon += 360;
      out.push([prev[0] + dLon * f, prev[1] + (cur[1] - prev[1]) * f]);
      break;
    }
  }
  return out;
}

function visible(proj: GeoProjection, lon: number, lat: number): boolean {
  const [rl, rp] = proj.rotate();
  const c = [-rl, -rp];
  const r = Math.PI / 180;
  const cos = Math.sin(lat * r) * Math.sin(c[1] * r) + Math.cos(lat * r) * Math.cos(c[1] * r) * Math.cos((lon - c[0]) * r);
  return cos > 0;
}

function enableDrag(svg: SVGSVGElement, proj: GeoProjection, redraw: () => void) {
  let start: { x: number; y: number; rot: [number, number, number] } | null = null;
  let frame = 0;
  svg.addEventListener('pointerdown', (e) => {
    start = { x: e.clientX, y: e.clientY, rot: proj.rotate() as [number, number, number] };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener('pointermove', (e) => {
    if (!start) return;
    const k = 180 / (proj.scale() * Math.PI) * (380 / svg.getBoundingClientRect().width);
    const lon = start.rot[0] + (e.clientX - start.x) * k * 1.0;
    const lat = Math.max(-80, Math.min(80, start.rot[1] - (e.clientY - start.y) * k));
    proj.rotate([lon, lat, 0]);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(redraw);
  });
  const end = () => { start = null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}
