import './style.css';
import { geoOrthographic } from 'd3-geo';
import type { ModeModule } from '../types';
import { h, svgEl, autocomplete, resultPanel, toast } from '../../core/ui';
import { makeT, lang } from '../../core/i18n';
import { puzzleIndex } from '../../core/daily';
import { loadJSON } from '../../core/data';
import { loadGame, saveGame, recordResult } from '../../core/storage';
import { country, countryName, countryItems } from '../../core/countries';
import { flag } from '../../core/geo';
import { loadWorld, drawWorld } from '../../core/map';
import {
  MAX_GUESSES, marks, isWin, misses, hints, found, givenCountry, lockedSlots, shareText, bucket, pathOf, niceKm, type Mark,
} from './logic';

const ID = 'tripoint';
const BUCKETS = ['1', '2', '3', '4', 'X'];
const NEAR_KM = 150;
const WIDE_KM = 500;
const VU = 1000; // SVG view units for the circle radius

interface Puzzle {
  n: number;
  lat: number;
  lon: number;
  codes: string[];
  name: { en: string; tr: string } | null;
  difficulty: number;
  unit: number;
  radius: number;
  b: number[][];
  c: number[][];
  l: number[][];
  r: number[][];
  f: Record<string, number[][]>;
}

interface Saved {
  guesses: string[][];
  draft: (string | null)[];
}

const t = makeT({
  en: {
    prompt: 'Three borders meet in the centre. Which three countries?',
    slot: 'Country {n}',
    add: 'Add',
    check: 'Check',
    full: 'All three slots are full. Tap one to clear it.',
    inSlot: 'Already in a slot',
    ruledOut: 'Already ruled out',
    left: '{n} guesses left',
    left1: 'Last guess',
    next1: 'A miss reveals coastlines and lakes',
    next2: 'A miss reveals rivers',
    next3: 'A miss widens the view and names one country',
    next3b: 'A miss widens the view',
    given: '{name} is one of them',
    found: 'Found',
    clear: 'Remove {name}',
    mapLabel: 'Border lines within {km} km of a tripoint',
    north: 'N',
    knownAs: 'Known as {name}',
    countries: 'The three countries',
    attr: 'Borders, coastlines, lakes, rivers: Natural Earth (public domain). Names: Wikidata (CC0).',
    solvedIn: 'Solved in {n}/4',
    how1: 'The map shows only border lines around a point where three countries meet. North is up and the circle has a radius of about 150 km.',
    how2: 'Fill the three slots with countries (order does not matter) and press Check. You have 4 guesses.',
    how3: '🟩 is one of the three · 🟨 borders at least one of them · ⬛ neither. Correct countries stay locked in place.',
    how4: 'Each miss adds a hint: 1) coastlines and lakes, 2) rivers, 3) a wider 500 km view and one missing country named.',
    howEx: 'Example: the answer is Switzerland, Germany and France (Basel). Guessing Germany, Austria, Portugal gives 🟩 Germany, 🟨 Austria (it borders Germany and Switzerland), ⬛ Portugal.',
  },
  tr: {
    prompt: 'Merkezde üç sınır buluşuyor. Hangi üç ülke?',
    slot: '{n}. ülke',
    add: 'Ekle',
    check: 'Kontrol et',
    full: 'Üç kutu da dolu. Boşaltmak için birine dokun.',
    inSlot: 'Bu ülke zaten bir kutuda',
    ruledOut: 'Bu ülke zaten elendi',
    left: '{n} hak kaldı',
    left1: 'Son hak',
    next1: 'Yanlış tahmin kıyıları ve gölleri gösterir',
    next2: 'Yanlış tahmin nehirleri gösterir',
    next3: 'Yanlış tahmin görüşü genişletir ve bir ülkeyi açar',
    next3b: 'Yanlış tahmin görüşü genişletir',
    given: '{name} bunlardan biri',
    found: 'Bulundu',
    clear: '{name} ülkesini kaldır',
    mapLabel: 'Bir üçlü noktanın {km} km çevresindeki sınır çizgileri',
    north: 'K',
    knownAs: 'Bilinen adı: {name}',
    countries: 'Üç ülke',
    attr: 'Sınırlar, kıyılar, göller, nehirler: Natural Earth (kamu malı). Adlar: Wikidata (CC0).',
    solvedIn: '{n}/4 tahminde bildin',
    how1: 'Haritada yalnızca üç ülkenin buluştuğu bir noktanın çevresindeki sınır çizgileri var. Kuzey yukarıda; çemberin yarıçapı yaklaşık 150 km.',
    how2: 'Üç kutuyu ülkelerle doldur (sıra önemli değil) ve Kontrol et\'e bas. 4 hakkın var.',
    how3: '🟩 üç ülkeden biri · 🟨 en az birine komşu · ⬛ hiçbiri. Doğru ülkeler yerinde kilitli kalır.',
    how4: 'Her yanlış tahmin bir ipucu ekler: 1) kıyılar ve göller, 2) nehirler, 3) 500 km\'lik geniş görüş ve eksik ülkelerden birinin adı.',
    howEx: 'Örnek: cevap İsviçre, Almanya ve Fransa (Basel). Almanya, Avusturya, Portekiz tahmini 🟩 Almanya, 🟨 Avusturya (Almanya ve İsviçre\'ye komşu), ⬛ Portekiz verir.',
  },
});

const nbOf = (c: string) => country(c).nb;
const popOf = (c: string) => country(c).pop;
const label = (c: string) => `${flag(c)} ${countryName(c)}`;

function fmtCoord(lat: number, lon: number): string {
  const ns = lang === 'tr' ? (lat >= 0 ? 'K' : 'G') : lat >= 0 ? 'N' : 'S';
  const ew = lang === 'tr' ? (lon >= 0 ? 'D' : 'B') : lon >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(3)}° ${ns}, ${Math.abs(lon).toFixed(3)}° ${ew}`;
}

/** The border map: data in projected km (scaled into a fixed view), decorations in view units. */
function borderMap(P: Puzzle) {
  const svg = svgEl('svg', { class: 'tp-svg', viewBox: `${-VU * 1.07} ${-VU * 1.07} ${VU * 2.14} ${VU * 2.14}`, role: 'img' });
  const clipId = `tp-clip-${P.n}`;
  const defs = svgEl('defs');
  const clip = svgEl('clipPath', { id: clipId });
  clip.append(svgEl('circle', { r: VU }));
  defs.append(clip);
  const outer = svgEl('g', { 'clip-path': `url(#${clipId})` });
  const data = svgEl('g');
  const fills = P.codes.map((c, i) => svgEl('path', { d: pathOf(P.f[c] ?? [], true), class: `tp-fill tp-f${i}` }));
  const lakes = svgEl('path', { d: pathOf(P.l, true), class: 'tp-lake' });
  const rivers = svgEl('path', { d: pathOf(P.r), class: 'tp-river' });
  const coast = svgEl('path', { d: pathOf(P.c), class: 'tp-coast' });
  const borders = svgEl('path', { d: pathOf(P.b), class: 'tp-border' });
  data.append(...fills, lakes, rivers, coast, borders);
  outer.append(data);

  const centre = svgEl('g', { class: 'tp-centre' });
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    centre.append(svgEl('line', { x1: dx * 24, y1: dy * 24, x2: dx * 56, y2: dy * 56 }));
  }
  const dot = svgEl('g', { class: 'tp-dot' });
  dot.append(svgEl('circle', { r: 30, class: 'tp-dot-halo' }), svgEl('circle', { r: 13, class: 'tp-dot-core' }));

  const north = svgEl('g', { class: 'tp-north', transform: `translate(${VU * 0.94} ${-VU * 0.98})` });
  north.append(svgEl('path', { d: 'M0 -40 L22 26 L0 12 L-22 26 Z' }));
  const nText = svgEl('text', { y: 96, 'text-anchor': 'middle' });
  nText.textContent = t('north');
  north.append(nText);

  const scaleG = svgEl('g', { class: 'tp-scale' });
  const bar = svgEl('path', {});
  const sText = svgEl('text', { x: -VU * 1.04, y: VU * 0.97 });
  scaleG.append(bar, sText);

  svg.append(
    defs,
    svgEl('circle', { r: VU, class: 'tp-disc' }),
    outer,
    svgEl('circle', { r: VU, class: 'tp-ring' }),
    centre,
    dot,
    north,
    scaleG,
  );

  let radiusKm = NEAR_KM;
  let anim = 0;
  function applyRadius(km: number) {
    radiusKm = km;
    const s = VU / (km / P.unit);
    data.setAttribute('transform', `scale(${s})`);
    const L = niceKm(km * 0.38);
    const x0 = -VU * 1.04, x1 = x0 + (L / km) * VU, y = VU * 1.03;
    bar.setAttribute('d', `M${x0} ${y - 18}V${y}H${x1}V${y - 18}`);
    sText.textContent = `${L} km`;
    svg.setAttribute('aria-label', t('mapLabel', { km: Math.round(km) }));
  }
  applyRadius(NEAR_KM);

  function set(state: { coast: boolean; rivers: boolean; wide: boolean; reveal: boolean }, animate: boolean) {
    svg.classList.toggle('show-coast', state.coast || state.reveal);
    svg.classList.toggle('show-rivers', state.rivers || state.reveal);
    svg.classList.toggle('reveal', state.reveal);
    const target = state.wide || state.reveal ? WIDE_KM : NEAR_KM;
    cancelAnimationFrame(anim);
    if (!animate || target === radiusKm || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      applyRadius(target);
      return;
    }
    const from = radiusKm, t0 = performance.now(), dur = 900;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2;
      // Interpolate the log of the radius so the zoom feels even.
      applyRadius(Math.exp(Math.log(from) + (Math.log(target) - Math.log(from)) * e));
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  return { svg, set, stop: () => cancelAnimationFrame(anim) };
}

function locator(P: Puzzle): SVGSVGElement {
  const svg = svgEl('svg', { class: 'tp-globe', viewBox: '0 0 100 100', role: 'img', 'aria-label': fmtCoord(P.lat, P.lon) });
  const proj = geoOrthographic().rotate([-P.lon, -P.lat * 0.6]).translate([50, 50]).scale(47).clipAngle(90);
  loadWorld()
    .then((w) => {
      const { layer } = drawWorld(svg, proj, w, (c) => (P.codes.includes(c) ? 'var(--tp-globe-hi)' : null));
      const p = proj([P.lon, P.lat]);
      if (p) layer.append(svgEl('circle', { cx: p[0], cy: p[1], r: 4.5, class: 'tp-globe-dot' }));
    })
    .catch(() => svg.remove());
  return svg;
}

let stopMap: (() => void) | null = null;

const mode: ModeModule = {
  async mount(ctx) {
    const index = await loadJSON<{ count: number }>('tripoint/index.json');
    const P = await loadJSON<Puzzle>(`tripoint/p/${puzzleIndex(ctx.day, index.count)}.json`);
    const answer = P.codes;

    const saved = loadGame<Saved>(ID, ctx.day);
    const guesses: string[][] = (saved?.guesses ?? []).filter((g) => Array.isArray(g) && g.length === 3).slice(0, MAX_GUESSES);
    let slots: (string | null)[] = [null, null, null];

    const won = () => guesses.some((g) => isWin(g, answer));
    const done = () => won() || guesses.length >= MAX_GUESSES;
    const given = () => givenCountry(guesses, answer, popOf);
    const locked = () => lockedSlots(guesses, answer, given());
    const ruledOut = () => new Set(guesses.flat().filter((c) => !answer.includes(c)));

    function resetSlots(draft?: (string | null)[]) {
      slots = locked();
      const out = ruledOut();
      draft?.forEach((c, i) => {
        if (c && !slots[i] && !slots.includes(c) && !out.has(c)) slots[i] = c;
      });
    }
    resetSlots(saved?.draft);

    const save = () => saveGame(ID, ctx.day, { guesses, draft: slots } satisfies Saved);

    // ---- DOM ----
    const map = borderMap(P);
    stopMap = map.stop;
    const status = h('p', { class: 'tp-status', 'aria-live': 'polite' });
    const slotRow = h('div', { class: 'tp-slots' });
    const ac = autocomplete({
      items: () => {
        const taken = new Set(slots.filter(Boolean) as string[]);
        const out = ruledOut();
        return countryItems((c) => !taken.has(c.c) && !out.has(c.c));
      },
      placeholder: t('typeCountry'),
      buttonLabel: t('add'),
      onPick: (item) => {
        const free = slots.indexOf(null);
        if (free < 0) return toast(t('full'));
        if (slots.includes(item.id)) return toast(t('inSlot'));
        if (ruledOut().has(item.id)) return toast(t('ruledOut'));
        slots[free] = item.id;
        save();
        render();
        if (slots.includes(null)) ac.focus();
        else checkBtn.focus();
      },
    });
    const checkBtn = h('button', { class: 'btn primary wide tp-check', type: 'button', onclick: () => submit() }, t('check')) as HTMLButtonElement;
    const rows = h('ol', { class: 'tp-rows' });
    const play = h('div', { class: 'tp-play' }, slotRow, ac.el, checkBtn);
    const resultBox = h('div');
    ctx.root.append(
      h('p', { class: 'prompt' }, t('prompt')),
      h('div', { class: 'panel tp-mapwrap' }, map.svg),
      status,
      play,
      rows,
      resultBox,
    );

    function submit() {
      if (done() || slots.includes(null)) return;
      const guess = slots as string[];
      guesses.push([...guess]);
      const wasGiven = given();
      resetSlots();
      save();
      if (done()) {
        const w = won();
        recordResult(ID, ctx.day, w, bucket(w, guesses.length), w ? `${guesses.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`);
      } else if (!wasGiven && given()) {
        toast(t('given', { name: countryName(given()!) }));
      }
      render(true);
    }

    function render(animate = false) {
      const finished = done();
      const miss = misses(guesses, answer);
      map.set({ ...hints(miss), reveal: finished }, animate);
      const lockedNow = locked();

      // Slots
      slotRow.replaceChildren(
        ...slots.map((c, i) => {
          const isLocked = !!c && lockedNow[i] === c;
          if (!c) return h('div', { class: 'tp-slot empty' }, t('slot', { n: i + 1 }));
          if (isLocked) {
            return h('div', { class: 'tp-slot locked', title: t('found') }, h('span', { class: 'tp-slot-name' }, label(c)), h('span', { 'aria-hidden': 'true' }, '🔒'));
          }
          return h(
            'button',
            {
              class: 'tp-slot filled',
              type: 'button',
              'aria-label': t('clear', { name: countryName(c) }),
              onclick: () => {
                slots[i] = null;
                save();
                render();
              },
            },
            h('span', { class: 'tp-slot-name' }, label(c)),
            h('span', { class: 'tp-x', 'aria-hidden': 'true' }, '×'),
          );
        }),
      );
      checkBtn.disabled = slots.includes(null);
      ac.setDisabled(!slots.includes(null));

      // Guess history
      rows.replaceChildren(
        ...guesses.map((g) => {
          const m = marks(g, answer, nbOf);
          return h('li', { class: 'tp-row' }, ...g.map((c, i) => h('span', { class: `tp-chip ${m[i]}` }, h('span', { class: 'tp-chip-name' }, label(c)))));
        }),
      );

      // Status
      if (!finished) {
        const left = MAX_GUESSES - guesses.length;
        const next = [t('next1'), t('next2'), found(guesses, answer).length >= 2 ? t('next3b') : t('next3')][miss] ?? '';
        const g = given();
        status.replaceChildren(
          h('strong', {}, left === 1 ? t('left1') : t('left', { n: left })),
          next && left > 1 ? ` · ${next}` : '',
          g ? h('span', { class: 'tp-given' }, `💡 ${t('given', { name: countryName(g) })}`) : '',
        );
      } else {
        status.replaceChildren();
      }
      play.hidden = finished;
      if (finished && !resultBox.firstChild) showResult();
    }

    function showResult() {
      const w = won();
      const rowsMarks: Mark[][] = guesses.map((g) => marks(g, answer, nbOf));
      const detail = h(
        'div',
        { class: 'tp-reveal' },
        h('h3', { class: 'tp-sub' }, t('countries')),
        h('ul', { class: 'tp-legend' }, ...answer.map((c, i) => h('li', {}, h('i', { class: `tp-sw tp-f${i}` }), label(c)))),
        h(
          'div',
          { class: 'tp-where' },
          locator(P),
          h(
            'div',
            {},
            P.name ? h('strong', {}, t('knownAs', { name: lang === 'tr' ? P.name.tr : P.name.en })) : null,
            h('div', { class: 'muted' }, fmtCoord(P.lat, P.lon)),
          ),
        ),
        h('p', { class: 'tp-attr' }, t('attr')),
      );
      resultBox.replaceChildren(
        resultPanel({
          won: w,
          headline: w ? t('solvedIn', { n: guesses.length }) : t('failed'),
          detail,
          share: shareText(ctx.day, rowsMarks, w),
          mode: ID,
          buckets: BUCKETS,
        }),
      );
    }

    render();
  },
  unmount() {
    stopMap?.();
    stopMap = null;
  },
  howTo: () =>
    h(
      'div',
      { class: 'mode-tripoint' },
      h('p', {}, t('how1')),
      h('p', {}, t('how2')),
      h('p', {}, t('how3')),
      h('p', {}, t('how4')),
      h('p', { class: 'howto-example' }, t('howEx')),
    ),
};
export default mode;
