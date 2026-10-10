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
import { globeControls, zoomButtons } from '../../core/globe';
import { flag, formatKm } from '../../core/geo';
import { scoreRow, isSolved, solvedPrefix, windName, pad3, emojiRow, MAX_ROWS } from './logic';

interface Hit { c: string; km: number; lat: number; lon: number }
interface Puzzle { city: string; cc: string; lat: number; lon: number; b: number; hits: Hit[]; path: [number, number][]; surprise: boolean; rhumb: string[] | null }
interface State { rows: string[][]; draft: (string | null)[]; done: boolean }

const MODE = 'beeline';
const BUCKETS = ['1', '2', '3', '4', '5', '6', 'X'];
const t = makeT({
  en: {
    ask: 'Go dead straight. First 5 countries you enter, in order?',
    submit: 'Submit',
    nth: 'Type country {n}…',
    ready: 'Row full: submit',
    remove: 'Remove {c}',
    fill: 'Fill all 5 slots',
    full: 'Row full. Tap a slot to change it.',
    dupe: 'Each country only once per row',
    rhumb: 'With a constant compass heading instead (a rhumb line) you would have entered: {list}. Straight lines on a globe curve on a flat map.',
    solvedIn: 'Solved in {n}/6',
    lostTitle: 'The line went through',
    dragHint: 'Drag the globe to look around, scroll or pinch to zoom',
    howIntro: 'Start at today\'s city and walk in a perfectly straight line (a great circle) in the given compass direction. Name the first five countries you enter, in order. The start country does not count.',
    howTiles: '🟩 right country, right position. 🟨 the line enters this country, but at another position. ⬛ not among the five.',
    howHint: 'After each guess the line on the globe grows up to the first country you have not found yet.',
    howEx: 'Example: Madrid, due east (090°). The straight line clips Sardinia (Italy), crosses Greece, and makes landfall in Lebanon. Not Turkey!',
    howCurve: 'Tip: on a globe, "due east" slowly bends towards the equator.',
  },
  tr: {
    ask: 'Dümdüz git. Sırayla girdiğin ilk 5 ülke?',
    submit: 'Gönder',
    nth: '{n}. ülkeyi yaz…',
    ready: 'Satır dolu: gönder',
    remove: '{c} ülkesini çıkar',
    fill: '5 kutunun hepsini doldur',
    full: 'Satır dolu. Değiştirmek için bir kutuya dokun.',
    dupe: 'Bir satırda her ülke bir kez',
    rhumb: 'Pusulayı hep aynı açıda tutsaydın (loksodrom) şu ülkelere girerdin: {list}. Kürede düz çizgiler düz haritada eğri görünür.',
    solvedIn: '{n}/6 tahminde bildin',
    lostTitle: 'Çizginin geçtiği ülkeler',
    dragHint: 'Etrafa bakmak için küreyi sürükle, yakınlaşmak için kaydır veya iki parmakla aç',
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
      h('div', { class: 'bl-route' }, h('strong', {}, `${p.city} ${flag(p.cc)}`), h('span', { class: 'bl-bearing' }, needle, `${pad3(p.b)}° ${windName(p.b, lang)}`)),
      h('div', { class: 'bl-ask muted' }, t('ask')),
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
      const head = arrowHead(proj, coords);
      if (head) layer.append(svgEl('path', { d: head, class: 'bl-arrow' }));
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
    const controls = globeControls(svg, proj, drawGlobe);
    const globe = h('div', { class: 'mapbox bl-globe', title: t('dragHint') }, svg, zoomButtons(controls.zoomBy));

    // ----- board -----
    const board = h('div', { class: 'board', 'aria-live': 'polite' });
    const resultSlot = h('div', { class: 'bl-result' });

    const ac = autocomplete({
      items: () => countryItems((c) => c.c !== p.cc && !state.draft.includes(c.c)),
      placeholder: t('typeCountry'),
      bare: true,
      onEmptySubmit: () => submit(),
      onPick: (item) => {
        const i = state.draft.indexOf(null);
        if (i < 0) return toast(t('full'));
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
      // Phones: drop the keyboard so the globe and the new row are visible. Desktop: keep typing.
      if (matchMedia('(pointer: coarse)').matches) (document.activeElement as HTMLElement | null)?.blur();
      else if (!state.done) ac.focus();
    }

    // Input and submit share one row right under the board, so they are always on screen.
    const submitBtn = h('button', { class: 'btn primary bl-submit', type: 'button', onclick: submit });
    const compose = h('div', { class: 'bl-compose' }, ac.el, submitBtn);

    function render() {
      const rows = state.rows.map((r) => h('div', { class: 'bl-row past' }, ...scoreRow(r, answer).map((tile, i) => cell(r[i], tile))));
      if (!state.done) {
        const next = state.draft.indexOf(null);
        rows.push(
          h(
            'div',
            { class: 'bl-row' },
            ...state.draft.map((d, i) => {
              const el = cell(d, `slot ${d ? 'filled' : ''} ${i === next ? 'cur' : ''}`, i);
              if (d) el.title = t('remove', { c: countryName(d) });
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
        ac.setPlaceholder(next < 0 ? t('ready') : t('nth', { n: next + 1 }));
        submitBtn.textContent = `${t('submit')} ${state.rows.length + 1}/${MAX_ROWS}`;
        submitBtn.disabled = next >= 0;
      }
      board.replaceChildren(...rows);
      compose.hidden = state.done;
      ctx.root.classList.toggle('bl-fit', !state.done);
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
        controls.reset();
        drawGlobe();
      }
    }

    // While playing, the mode is capped to the space left under the header so the globe shrinks
    // instead of pushing the input off screen (see style.css).
    const fit = () => ctx.root.style.setProperty('--bl-top', `${Math.round(ctx.root.getBoundingClientRect().top + window.scrollY)}px`);
    ctx.root.append(h('div', { class: 'bl-side' }, prompt, board, compose), globe, resultSlot);
    render();
    fit();
    window.addEventListener('resize', fit);
    cleanup = () => window.removeEventListener('resize', fit);
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

/** Arrowhead at the end of the line, pointing the way it travels (null when the tip is behind the globe). */
function arrowHead(proj: GeoProjection, coords: [number, number][], size = 15): string | null {
  if (coords.length < 2) return null;
  const end = coords[coords.length - 1];
  if (!visible(proj, end[0], end[1])) return null;
  const a = proj(coords[coords.length - 2]);
  const b = proj(end);
  if (!a || !b) return null;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5) return null; // seen end-on at the rim: no direction to show
  const ux = (b[0] - a[0]) / len;
  const uy = (b[1] - a[1]) / len;
  const w = size * 0.42;
  const pt = (along: number, across: number) => `${(b[0] + ux * along - uy * across).toFixed(1)},${(b[1] + uy * along + ux * across).toFixed(1)}`;
  return `M${pt(size, 0)}L${pt(-size * 0.25, w)}L${pt(0, 0)}L${pt(-size * 0.25, -w)}Z`;
}

function visible(proj: GeoProjection, lon: number, lat: number): boolean {
  const [rl, rp] = proj.rotate();
  const c = [-rl, -rp];
  const r = Math.PI / 180;
  const cos = Math.sin(lat * r) * Math.sin(c[1] * r) + Math.cos(lat * r) * Math.cos(c[1] * r) * Math.cos((lon - c[0]) * r);
  return cos > 0;
}
