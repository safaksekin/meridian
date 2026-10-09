import './style.css';
import type { ModeModule } from '../types';
import { h, resultPanel, toast } from '../../core/ui';
import { loadJSON } from '../../core/data';
import { loadGame, recordResult, saveGame } from '../../core/storage';
import { puzzleIndex } from '../../core/daily';
import { country, countryName } from '../../core/countries';
import { loadWorld } from '../../core/map';
import { lang } from '../../core/i18n';
import { HeadcountMap } from './map';
import { BUCKETS, MAX_ATTEMPTS, WIN_SCORE, bucketFor, decodeGrid, formatPop, popInCircle, score, shareText, type Grid } from './pop.js';
import { makeLocator, regionOk, type Region } from './region.js';
import { t } from './strings';

const ID = 'headcount';

interface Perfect {
  lat: number;
  lon: number;
  pop: number;
  city: string;
  cc: string;
  km: number;
}
export interface Puzzle {
  /** Circle radius, km. */
  r: number;
  /** Target population. */
  t: number;
  reg?: Region;
  /** Number of candidate centres within 2 % (difficulty hint, not shown). */
  n: number;
  p: Perfect[];
}
interface Doc {
  source: string;
  cell: number;
  total: number;
  puzzles: Puzzle[];
}
interface Attempt {
  lat: number;
  lon: number;
  pop: number;
}
interface State {
  a: Attempt[];
  done: boolean;
}

let gridP: Promise<Grid> | null = null;
/** grid.bin is gzip; some hosts already decode it in transit, so sniff the magic bytes. */
function loadGrid(): Promise<Grid> {
  gridP ??= (async () => {
    const res = await fetch(new URL('data/headcount/grid.bin', document.baseURI).toString());
    if (!res.ok) throw new Error(`grid.bin: ${res.status}`);
    let bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return decodeGrid(bytes);
  })();
  gridP.catch(() => (gridP = null));
  return gridP;
}

const tr = () => lang === 'tr';
const fmtPop = (n: number) => formatPop(n, tr());
const fmtInt = (n: number) => Math.round(n).toLocaleString(tr() ? 'tr-TR' : 'en-US');
const contName = (c: string) => t(`cont:${c}`);

/** Template with {name} placeholders -> nodes, placeholders rendered as <strong>. */
function rich(tpl: string, vars: Record<string, string>): (Node | string)[] {
  return tpl.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? h('strong', {}, vars[m[1]]) : part;
  });
}

function regionText(reg: Region): string {
  return reg.in ? t('regionIn', { cont: contName(reg.in) }) : t('regionOut', { cont: contName(reg.out!) });
}

function verdict(pop: number, target: number, s: number): string {
  if (s === 100) return t('spot');
  return pop > target ? t('tooMany') : t('tooFew');
}

function scoreCls(s: number): string {
  return s >= WIN_SCORE ? 'good' : s >= 50 ? 'near' : 'bad';
}

let map: HeadcountMap | null = null;

const mode: ModeModule = {
  async mount(ctx) {
    const [doc, grid, world] = await Promise.all([loadJSON<Doc>('headcount/puzzles.json'), loadGrid(), loadWorld()]);
    const pz = doc.puzzles[puzzleIndex(ctx.day, doc.puzzles.length)];
    const locate = makeLocator(world.countries);
    const contAt = (lon: number, lat: number): string | null => {
      const code = locate(lon, lat);
      try {
        return code ? country(code).cont : null;
      } catch {
        return null;
      }
    };
    const saved = loadGame<State>(ID, ctx.day);
    const state: State = saved && Array.isArray(saved.a) ? saved : { a: [], done: false };
    const scoreOf = (a: Attempt) => score(a.pop, pz.t);
    let pending: { lon: number; lat: number } | null = null;

    // ---------------------------------------------------------------- layout
    const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
    const prompt = h(
      'div',
      { class: 'panel hc-prompt' },
      h('p', { class: 'prompt' }, ...rich(t('prompt'), { target: fmtInt(pz.t), r: `${pz.r} km` })),
      pz.reg ? h('p', { class: 'hc-region' }, regionText(pz.reg)) : null,
      h('p', { class: 'hc-hint muted' }, finePointer ? t('hintMouse') : t('hintTouch')),
    );
    const dropBtn = h('button', { class: 'btn primary', type: 'button', hidden: true }, t('drop'));
    const leftEl = h('span', { class: 'hc-left muted' });
    const readout = h('p', { class: 'hc-readout', 'aria-live': 'polite' });
    const list = h('ol', { class: 'guesses hc-attempts' });
    const resultBox = h('div');

    map?.destroy();
    const m = new HeadcountMap({
      onHover: (lon, lat) => {
        if (pending) return;
        m.setPreview(state.done ? null : { lon, lat, r: pz.r });
      },
      onLeave: () => {
        if (!pending && !state.done) m.setPreview(null);
      },
      onTap: (lon, lat, type) => {
        if (state.done) return measure(lon, lat);
        if (type === 'mouse') return lock(lon, lat);
        pending = { lon, lat };
        m.setPreview({ lon, lat, r: pz.r, cls: 'pinned' });
        dropBtn.hidden = false;
      },
    });
    map = m;
    dropBtn.addEventListener('click', () => pending && lock(pending.lon, pending.lat));

    ctx.root.append(prompt, m.el, h('div', { class: 'hc-controls' }, leftEl, dropBtn), readout, list, resultBox);
    await m.init();

    // ---------------------------------------------------------------- game
    function lock(lon: number, lat: number) {
      if (state.done) return;
      if (pz.reg && !regionOk(pz.reg, contAt(lon, lat))) {
        toast(regionText(pz.reg));
        return;
      }
      const a = { lat: Math.round(lat * 1000) / 1000, lon: Math.round(lon * 1000) / 1000, pop: 0 };
      a.pop = Math.round(popInCircle(grid, a.lat, a.lon, pz.r));
      state.a.push(a);
      const s = scoreOf(a);
      if (s === 100 || state.a.length >= MAX_ATTEMPTS) state.done = true;
      pending = null;
      dropBtn.hidden = true;
      m.setPreview(null);
      saveGame(ID, ctx.day, state);
      if (state.done) {
        const best = Math.max(...state.a.map(scoreOf));
        recordResult(ID, ctx.day, best >= WIN_SCORE, bucketFor(best), String(best));
        m.fit(); // show the perfect circles wherever they are
      }
      update();
    }

    function measure(lon: number, lat: number) {
      const pop = popInCircle(grid, lat, lon, pz.r);
      m.setPreview({ lon, lat, r: pz.r, cls: 'measure' });
      readout.textContent = t('measure', { pop: fmtPop(pop) });
    }

    function update() {
      const circles = state.a.map((a, i) => ({ lon: a.lon, lat: a.lat, r: pz.r, cls: `att ${scoreCls(scoreOf(a))}`, label: String(i + 1) }));
      if (state.done) {
        circles.unshift(...pz.p.map((p) => ({ lon: p.lon, lat: p.lat, r: pz.r, cls: 'perfect', label: p.city })));
        m.showDensity(grid);
      }
      m.setCircles(circles);
      list.replaceChildren(
        ...state.a.map((a, i) => {
          const s = scoreOf(a);
          return h(
            'li',
            { class: `guess ${s >= WIN_SCORE ? 'good' : ''}` },
            h('span', {}, h('span', { class: 'muted' }, `${i + 1}. `), h('strong', {}, fmtPop(a.pop))),
            h('span', { class: 'tag' }, verdict(a.pop, pz.t, s)),
            h('span', { class: `tile hc-score ${scoreCls(s)}`, title: t('score', { s }) }, String(s)),
          );
        }),
      );
      leftEl.textContent = state.done ? '' : t('left', { n: MAX_ATTEMPTS - state.a.length });
      if (state.done) showResult();
    }

    function showResult() {
      const best = Math.max(...state.a.map(scoreOf));
      const won = best >= WIN_SCORE;
      readout.textContent = t('explore');
      const detail = h(
        'div',
        { class: 'hc-detail' },
        h('p', {}, `${t('target')}: `, h('strong', {}, fmtInt(pz.t)), ` · ${pz.r} km`),
        h('h3', {}, t('perfect')),
        h(
          'ul',
          { class: 'hc-perfect' },
          ...pz.p.map((p) =>
            h(
              'li',
              {},
              h('span', { class: 'hc-swatch', 'aria-hidden': 'true' }),
              h('span', {}, t('near', { city: p.city }), h('span', { class: 'muted' }, ` · ${countryName(p.cc)}`)),
              h('strong', {}, fmtPop(p.pop)),
            ),
          ),
        ),
        h('p', { class: 'muted hc-small' }, t('density')),
        h('p', { class: 'muted hc-small' }, `${t('attribution')}: ${t('attrPop')} ${t('attrCities')}`),
      );
      resultBox.replaceChildren(
        resultPanel({
          won,
          headline: won ? t('wonHead', { s: best }) : t('lostHead', { s: best }),
          detail,
          share: shareText(ctx.day, state.a.map((a) => a.pop), best, won),
          mode: ID,
          buckets: BUCKETS,
        }),
      );
    }

    update();
  },

  unmount() {
    map?.destroy();
    map = null;
  },

  howTo() {
    return h(
      'div',
      { class: 'hc-howto' },
      h('p', {}, t('howTo1')),
      h('p', {}, t('howTo2')),
      h('p', {}, t('howTo3')),
      h('p', { class: 'howto-example' }, t('howToEx')),
    );
  },
};

export default mode;
