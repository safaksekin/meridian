import './style.css';
import type { ModeModule } from '../types';
import { autocomplete, h, keepOnScreen, resultPanel, svgEl, toast, type AutoItem } from '../../core/ui';
import { fold, lang, makeT } from '../../core/i18n';
import { loadJSON } from '../../core/data';
import { countryName } from '../../core/countries';
import { arrowFor, bearingDeg, flag, formatKm, haversineKm } from '../../core/geo';
import { puzzleIndex } from '../../core/daily';
import { loadGame, recordResult, saveGame } from '../../core/storage';
import { drawView } from './draw';
import {
  BUCKETS,
  HINTS,
  MAX_GUESSES,
  bucketFor,
  coverScale,
  rosePath,
  scoreLabel,
  shareText,
  status,
  unlockedHints,
  type City,
  type Hint,
  type Puzzle,
  type PuzzleMeta,
} from './logic';

const MODE = 'streets';

const t = makeT({
  en: {
    prompt: 'Which city is this?',
    sub: '3 × 3 km of streets, turned at a random angle',
    typeCity: 'Type a city…',
    left: '{n} of 6 guesses left',
    lastGuess: 'Last guess!',
    hint_north: 'North up',
    hint_water: 'Water',
    hint_rail: 'Rail',
    hint_zoom: '10 km view',
    hint_names: 'Street names',
    newHint: 'New hint: {h}',
    hintsTitle: 'Hints',
    locked: 'Unlocks after wrong guess {n}',
    roseTitle: 'Street orientation',
    roseNote: 'Share of street length by compass bearing',
    namesTitle: 'Streets in this crop',
    view3: '3 km',
    view10: '10 km',
    answerIs: 'It was {c}',
    openMap: 'Open this spot on OpenStreetMap',
    attribution: 'Map data © OpenStreetMap contributors (ODbL). Cities: GeoNames (CC BY 4.0).',
    mapLabel: 'Street network of the mystery city',
    h1: 'You see 3 × 3 km of a real city’s street network: no labels, no water, turned at a random angle. Guess the city. You have 6 guesses.',
    h2: 'Each guess shows the distance and direction from your city to the answer. Every wrong guess unlocks a hint: 1) the map turns north-up and a street-orientation rose appears, 2) water, 3) railways and metro, 4) a 10 km view with major roads, 5) three street names.',
    ex: 'Example: you see a perfect diagonal grid with cut-off corners and guess Madrid. The row shows “504 km ➡️”, the map turns north-up and the rose shows two strong diagonals: Barcelona’s Eixample.',
  },
  tr: {
    prompt: 'Bu hangi şehir?',
    sub: '3 × 3 km sokak ağı, rastgele bir açıyla döndürülmüş',
    typeCity: 'Bir şehir yaz…',
    left: '{n} tahmin hakkın kaldı',
    lastGuess: 'Son tahmin!',
    hint_north: 'Kuzey yukarı',
    hint_water: 'Su',
    hint_rail: 'Raylı',
    hint_zoom: '10 km görünüm',
    hint_names: 'Sokak adları',
    newHint: 'Yeni ipucu: {h}',
    hintsTitle: 'İpuçları',
    locked: '{n}. yanlış tahminden sonra açılır',
    roseTitle: 'Sokak yönelimi',
    roseNote: 'Sokak uzunluğunun pusula yönlerine dağılımı',
    namesTitle: 'Bu kesitteki sokaklar',
    view3: '3 km',
    view10: '10 km',
    answerIs: 'Cevap: {c}',
    openMap: 'Bu noktayı OpenStreetMap’te aç',
    attribution: 'Harita verisi © OpenStreetMap katkıcıları (ODbL). Şehirler: GeoNames (CC BY 4.0).',
    mapLabel: 'Gizemli şehrin sokak ağı',
    h1: 'Gerçek bir şehrin 3 × 3 km’lik sokak ağını görürsün: etiket yok, su yok, rastgele bir açıyla döndürülmüş. Şehri tahmin et. 6 hakkın var.',
    h2: 'Her tahmin, şehrinden cevaba olan uzaklığı ve yönü gösterir. Her yanlış tahmin bir ipucu açar: 1) harita kuzeye döner ve sokak yönelim gülü çıkar, 2) su, 3) demiryolu ve metro, 4) ana yollarla 10 km görünüm, 5) üç sokak adı.',
    ex: 'Örnek: köşeleri kesik, kusursuz çapraz bir ızgara görüp Madrid dersin. Satırda “504 km ➡️” çıkar, harita kuzeye döner ve gül iki güçlü çapraz yön gösterir: Barselona’nın Eixample semti.',
  },
});

const HINT_ICON: Record<Hint, string> = { north: '🧭', water: '💧', rail: '🚆', zoom: '🔭', names: '🏷️' };

interface State {
  g: string[];
}

let cityById = new Map<string, City>();

function cityName(c: City): string {
  return lang === 'tr' && c.t ? c.t : c.n;
}

function cityLabel(c: City): string {
  return `${cityName(c)}, ${countryName(c.c)}`;
}

function cityItems(cities: City[]): AutoItem[] {
  return cities.map((c) => ({
    id: c.i,
    label: cityLabel(c),
    sub: flag(c.c),
    keys: [fold(c.n), ...(c.t ? [fold(c.t)] : []), ...(c.k ?? [])],
  }));
}

function roseSvg(rose: number[]): SVGSVGElement {
  const R = 46;
  const svg = svgEl('svg', { viewBox: '-60 -60 120 120', class: 'st-rose', role: 'img' });
  for (const r of [R, R / 2]) svg.append(svgEl('circle', { r, class: 'st-rose-grid' }));
  svg.append(svgEl('path', { d: `M0 ${-R}V${R}M${-R} 0H${R}`, class: 'st-rose-grid' }));
  svg.append(svgEl('path', { d: rosePath(rose, R), class: 'st-rose-petal' }));
  const n = svgEl('text', { x: 0, y: -R - 4, class: 'st-rose-n', 'text-anchor': 'middle' });
  n.textContent = 'N';
  svg.append(n);
  return svg;
}

function distanceCell(guess: City, target: City): string {
  if (guess.i === target.i) return '🎯';
  const km = haversineKm(guess.a, guess.o, target.a, target.o);
  return `${formatKm(km)} ${arrowFor(bearingDeg(guess.a, guess.o, target.a, target.o))}`;
}

const mode: ModeModule = {
  async mount(ctx) {
    const index = await loadJSON<PuzzleMeta[]>('streets/index.json');
    const meta = index[puzzleIndex(ctx.day, index.length)];
    const [puzzle, cities] = await Promise.all([
      loadJSON<Puzzle>(`streets/p/${meta.id}.json`),
      loadJSON<City[]>('streets/cities.json'),
    ]);
    cityById = new Map(cities.map((c) => [c.i, c]));
    const target = cityById.get(meta.c);
    if (!target) throw new Error(`streets: unknown city ${meta.c}`);
    const items = cityItems(cities);

    const saved = loadGame<State>(MODE, ctx.day);
    const state: State = {
      g: Array.isArray(saved?.g) ? saved.g.filter((id) => cityById.has(id)).slice(0, MAX_GUESSES) : [],
    };
    let view: 'crop' | 'zoom' = unlockedHints(state.g, meta.c).has('zoom') && !status(state.g, meta.c).done ? 'zoom' : 'crop';

    // ---- static structure
    const crop = drawView(puzzle, 'crop', puzzle);
    const zoom = drawView(puzzle.z, 'zoom', puzzle);
    crop.svg.setAttribute('aria-label', t('mapLabel'));
    zoom.svg.setAttribute('aria-label', t('mapLabel'));
    const mapBox = h('div', { class: 'st-map' }, crop.svg, zoom.svg);
    const tab3 = h('button', { class: 'st-tab', type: 'button', onclick: () => setView('crop') }, t('view3'));
    const tab10 = h('button', { class: 'st-tab', type: 'button', onclick: () => setView('zoom') }, t('view10'));
    const tabs = h('div', { class: 'st-tabs', role: 'tablist' }, tab3, tab10);
    const scale = h('div', { class: 'st-scale', 'aria-hidden': 'true' }, h('span', { class: 'st-scale-bar' }), h('span', { class: 'st-scale-label' }));
    const hintBar = h('ol', { class: 'st-hints', 'aria-label': t('hintsTitle') });
    const extras = h('div', { class: 'st-extras' });
    const left = h('p', { class: 'st-left muted' });
    const guessList = h('ol', { class: 'guesses st-guesses' });
    const after = h('div', { class: 'st-after' });
    const input = autocomplete({
      items: () => items,
      placeholder: t('typeCity'),
      onPick: (it) => guess(it.id),
    });

    const mapWrap = h('div', { class: 'st-mapwrap' }, mapBox, tabs, scale);
    ctx.root.append(
      h(
        'div',
        { class: 'split' },
        h('p', { class: 'prompt split-pre' }, h('strong', {}, t('prompt')), h('br'), h('span', { class: 'muted st-sub' }, t('sub'))),
        h('section', { class: 'panel st-panel split-visual' }, mapWrap, hintBar),
        h('div', { class: 'split-post' }, input.el, left, extras, guessList, after),
      ),
    );
    keepOnScreen(mapWrap, () => input.el, { under: hintBar });

    function setView(v: 'crop' | 'zoom') {
      view = v;
      renderMap();
    }

    function guess(id: string) {
      if (status(state.g, meta.c).done) return;
      if (state.g.includes(id)) {
        toast(t('already'));
        return;
      }
      const before = unlockedHints(state.g, meta.c);
      state.g.push(id);
      saveGame(MODE, ctx.day, state);
      const st = status(state.g, meta.c);
      if (st.done) {
        recordResult(MODE, ctx.day, st.won, bucketFor(state.g, meta.c), scoreLabel(state.g, meta.c));
        view = 'crop';
      } else {
        const now = unlockedHints(state.g, meta.c);
        const fresh = HINTS.find((hh) => now.has(hh) && !before.has(hh));
        if (fresh) {
          toast(t('newHint', { h: t(`hint_${fresh}`) }));
          if (fresh === 'zoom') view = 'zoom';
        }
      }
      render();
    }

    function renderMap() {
      const st = status(state.g, meta.c);
      const hints = unlockedHints(state.g, meta.c);
      const north = hints.has('north');
      const rot = north ? 0 : meta.rot;
      turnTo(rot);
      mapBox.classList.toggle('show-water', hints.has('water'));
      mapBox.classList.toggle('show-rail', hints.has('rail'));
      mapBox.classList.toggle('is-done', st.done);
      const zoomOk = hints.has('zoom');
      if (!zoomOk) view = 'crop';
      mapBox.classList.toggle('view-zoom', view === 'zoom');
      tabs.hidden = !zoomOk;
      tab3.classList.toggle('active', view === 'crop');
      tab10.classList.toggle('active', view === 'zoom');
      tab3.setAttribute('aria-selected', String(view === 'crop'));
      tab10.setAttribute('aria-selected', String(view === 'zoom'));
      // scale bar: 1 km (crop, north-up) or 2 km (zoom); hidden while rotated+scaled
      const km = view === 'zoom' ? 2 : 1;
      const span = view === 'zoom' ? 10 : 3 / (north ? 1 : coverScale(rot));
      (scale.firstChild as HTMLElement).style.width = `${(100 * km) / span}%`;
      (scale.lastChild as HTMLElement).textContent = `${km} km`;
    }

    function renderHints() {
      const hints = unlockedHints(state.g, meta.c);
      const st = status(state.g, meta.c);
      hintBar.hidden = st.done;
      hintBar.replaceChildren(
        ...HINTS.map((hh, i) =>
          h(
            'li',
            { class: `st-hint${hints.has(hh) ? ' on' : ''}`, title: hints.has(hh) ? t(`hint_${hh}`) : t('locked', { n: i + 1 }) },
            h('span', { 'aria-hidden': 'true' }, HINT_ICON[hh]),
            h('span', { class: 'st-hint-label' }, t(`hint_${hh}`)),
          ),
        ),
      );
      const parts: Node[] = [];
      if (hints.has('north')) {
        parts.push(
          h(
            'figure',
            { class: 'st-rosebox' },
            roseSvg(puzzle.rose),
            h('figcaption', {}, h('strong', {}, t('roseTitle')), h('br'), h('span', { class: 'muted' }, t('roseNote'))),
          ),
        );
      }
      if (hints.has('names') && puzzle.names.length) {
        parts.push(
          h(
            'div',
            { class: 'st-names' },
            h('strong', {}, t('namesTitle')),
            h('ul', {}, ...puzzle.names.map((n) => h('li', {}, n))),
          ),
        );
      }
      extras.replaceChildren(...parts);
      extras.hidden = parts.length === 0;
    }

    function renderGuesses() {
      guessList.replaceChildren(
        ...state.g.map((id) => {
          const c = cityById.get(id)!;
          const ok = id === meta.c;
          return h(
            'li',
            { class: `guess${ok ? ' good' : ''}` },
            h('span', { class: 'st-g' }, h('span', { 'aria-hidden': 'true' }, flag(c.c)), ' ', cityLabel(c)),
            h('span', {}, ''),
            h('span', { class: 'st-dist' }, distanceCell(c, target!)),
          );
        }),
      );
    }

    function renderEnd() {
      const st = status(state.g, meta.c);
      const osm = `https://www.openstreetmap.org/#map=15/${meta.lat}/${meta.lon}`;
      const detail = h(
        'div',
        { class: 'st-reveal' },
        h(
          'p',
          { class: 'st-answer' },
          h('span', { class: 'st-flag', 'aria-hidden': 'true' }, flag(target!.c)),
          ' ',
          t('answerIs', { c: cityLabel(target!) }),
        ),
        h('p', { class: 'st-osm' }, h('a', { href: osm, target: '_blank', rel: 'noopener' }, t('openMap'))),
        h('p', { class: 'st-attr muted' }, t('attribution')),
      );
      after.replaceChildren(
        resultPanel({
          won: st.won,
          headline: st.won ? t('solved') : t('failed'),
          detail,
          share: shareText(ctx.day, state.g, meta.c),
          mode: MODE,
          buckets: BUCKETS,
          label: scoreLabel(state.g, meta.c),
        }),
      );
    }

    function render() {
      const st = status(state.g, meta.c);
      renderMap();
      renderHints();
      renderGuesses();
      input.el.hidden = st.done;
      const remaining = MAX_GUESSES - state.g.length;
      left.hidden = st.done;
      left.textContent = st.done ? '' : remaining === 1 ? t('lastGuess') : t('left', { n: remaining });
      if (st.done) renderEnd();
      else after.replaceChildren();
    }

    // Rotation is animated through the SVG transform attribute (rotates about the crop centre, 0,0).
    let shownRot: number | null = null;
    let anim = 0;
    function applyRot(deg: number) {
      crop.g.setAttribute('transform', `rotate(${deg.toFixed(2)}) scale(${coverScale(deg).toFixed(4)})`);
    }
    function turnTo(deg: number) {
      cancelAnimationFrame(anim);
      const from = shownRot;
      shownRot = deg;
      const still = from == null || from === deg || matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (still) return applyRot(deg);
      // turn the short way round
      const delta = ((((deg - from) % 360) + 540) % 360) - 180;
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / 900);
        const e = 1 - (1 - k) ** 3;
        applyRot(from + delta * e);
        if (k < 1) anim = requestAnimationFrame(step);
      };
      anim = requestAnimationFrame(step);
    }

    render();
  },

  howTo() {
    return h(
      'div',
      {},
      h('p', {}, t('h1')),
      h('p', {}, t('h2')),
      h('p', { class: 'howto-example' }, t('ex')),
      h('p', { class: 'muted' }, t('attribution')),
    );
  },
};

export default mode;
