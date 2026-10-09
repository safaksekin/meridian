import './style.css';
import type { ModeModule } from '../types';
import { autocomplete, h, resultPanel, toast } from '../../core/ui';
import { lang, makeT } from '../../core/i18n';
import { loadJSON } from '../../core/data';
import { country, countryItems, countryName } from '../../core/countries';
import { arrowFor, bearingDeg, flag, formatKm, haversineKm } from '../../core/geo';
import { puzzleIndex } from '../../core/daily';
import { loadGame, recordResult, saveGame } from '../../core/storage';
import {
  BUCKETS,
  MAX_GUESSES,
  bucketFor,
  revealedCount,
  sameFamily,
  scoreLabel,
  shareText,
  status,
  type Families,
  type Puzzle,
} from './logic';
import { revealMap } from './map';

const MODE = 'hinterland';

const t = makeT({
  en: {
    prompt: 'Which country are these places in?',
    left: '{n} of 6 guesses left',
    lastGuess: 'Last guess!',
    hidden: 'Revealed after a wrong guess',
    answerIs: 'The answer was {c}',
    familyOf: 'Main language family: {f}',
    pattern: 'Typical pattern: {pct}% of the small-place names we have for this country end in “-{s}”.',
    source: 'Place names: GeoNames (CC BY 4.0). Map: Natural Earth.',
    famUnknown: '—',
    h1: 'You see the name of a real small town or village (500–20,000 people). Guess the country it is in. You have 6 guesses.',
    h2: 'Every wrong guess reveals another place name from the same country. The first names are the most ambiguous, the later ones give it away.',
    h3: 'Each guess shows the distance and direction from your country to the answer, and its main language family: green means the same family as the answer.',
    ex: 'Example: the first clue is “Kirchberg an der Iller”. You guess Austria: the row shows “Germanic” in green and “501 km ↖️”. The next clue, “Großlangheim”, confirms it: Germany.',
  },
  tr: {
    prompt: 'Bu yerler hangi ülkede?',
    left: '{n} tahmin hakkın kaldı',
    lastGuess: 'Son tahmin!',
    hidden: 'Yanlış tahminden sonra açılır',
    answerIs: 'Cevap: {c}',
    familyOf: 'Ana dil ailesi: {f}',
    pattern: 'Tipik ad kalıbı: bu ülke için elimizdeki küçük yerleşim adlarının %{pct} kadarı “-{s}” ile bitiyor.',
    source: 'Yer adları: GeoNames (CC BY 4.0). Harita: Natural Earth.',
    famUnknown: '—',
    h1: 'Gerçek bir kasaba ya da köyün (500–20.000 kişi) adını görürsün. Hangi ülkede olduğunu tahmin et. 6 hakkın var.',
    h2: 'Her yanlış tahmin aynı ülkeden bir yer adı daha açar. İlk adlar en belirsizleri, sonrakiler ele verir.',
    h3: 'Her tahmin, ülkenden cevaba olan uzaklığı ve yönü, ayrıca ana dil ailesini gösterir: yeşil, cevapla aynı dil ailesi demektir.',
    ex: 'Örnek: ilk ipucu “Kirchberg an der Iller”. Avusturya dersin: satırda yeşil “Cermen” ve “501 km ↖️” görünür. Sonraki ipucu “Großlangheim” işi bitirir: Almanya.',
  },
});

const FAMILY_NAMES: Record<string, { en: string; tr: string }> = {
  germanic: { en: 'Germanic', tr: 'Cermen' },
  romance: { en: 'Romance', tr: 'Roman' },
  slavic: { en: 'Slavic', tr: 'Slav' },
  baltic: { en: 'Baltic', tr: 'Baltık' },
  hellenic: { en: 'Hellenic', tr: 'Helen' },
  albanian: { en: 'Albanian', tr: 'Arnavut' },
  armenian: { en: 'Armenian', tr: 'Ermeni' },
  kartvelian: { en: 'Kartvelian', tr: 'Kartvel' },
  uralic: { en: 'Uralic', tr: 'Ural' },
  turkic: { en: 'Turkic', tr: 'Türk' },
  mongolic: { en: 'Mongolic', tr: 'Moğol' },
  iranian: { en: 'Iranian', tr: 'İrani' },
  indoaryan: { en: 'Indo-Aryan', tr: 'Hint-Aryan' },
  sinotibetan: { en: 'Sino-Tibetan', tr: 'Çin-Tibet' },
  taikadai: { en: 'Tai-Kadai', tr: 'Tay-Kaday' },
  austroasiatic: { en: 'Austroasiatic', tr: 'Avustroasya' },
  japonic: { en: 'Japonic', tr: 'Japon' },
  koreanic: { en: 'Koreanic', tr: 'Kore' },
  austronesian: { en: 'Austronesian', tr: 'Austronezya' },
  papuan: { en: 'Papuan', tr: 'Papua' },
  semitic: { en: 'Semitic', tr: 'Sami' },
  cushitic: { en: 'Cushitic', tr: 'Kuşi' },
  chadic: { en: 'Chadic', tr: 'Çad' },
  nilosaharan: { en: 'Nilo-Saharan', tr: 'Nil-Sahra' },
  bantu: { en: 'Bantu', tr: 'Bantu' },
  nigercongo: { en: 'Niger-Congo', tr: 'Nijer-Kongo' },
  eskimoaleut: { en: 'Eskimo-Aleut', tr: 'Eskimo-Aleut' },
};

interface State {
  g: string[];
}

let families: Families = {};

function familyLabel(code: string): string {
  const f = FAMILY_NAMES[families[code]];
  if (!f) return t('famUnknown');
  return f[lang];
}

function distanceCell(guess: string, target: string): string {
  if (guess === target) return '🎯';
  const a = country(guess);
  const b = country(target);
  const km = haversineKm(a.lat, a.lon, b.lat, b.lon);
  return `${formatKm(km)} ${arrowFor(bearingDeg(a.lat, a.lon, b.lat, b.lon))}`;
}

const mode: ModeModule = {
  async mount(ctx) {
    const [puzzles, fam] = await Promise.all([
      loadJSON<Puzzle[]>('hinterland/puzzles.json'),
      loadJSON<Families>('hinterland/families.json'),
    ]);
    families = fam;
    const puzzle = puzzles[puzzleIndex(ctx.day, puzzles.length)];
    const target = puzzle.country;
    const saved = loadGame<State>(MODE, ctx.day);
    const valid = new Set(countryItems().map((it) => it.id));
    const state: State = { g: Array.isArray(saved?.g) ? saved.g.filter((c) => valid.has(c)).slice(0, MAX_GUESSES) : [] };

    const clues = h('ol', { class: 'hl-names' });
    const left = h('p', { class: 'hl-left muted' });
    const guessList = h('ol', { class: 'guesses hl-guesses' });
    const after = h('div', { class: 'hl-after' });
    const input = autocomplete({
      items: () => countryItems(),
      placeholder: t('typeCountry'),
      onPick: (it) => guess(it.id),
    });

    ctx.root.append(
      h('section', { class: 'panel hl-clues' }, h('p', { class: 'prompt' }, h('strong', {}, t('prompt'))), clues),
      input.el,
      left,
      guessList,
      after,
    );

    function guess(code: string) {
      if (status(state.g, target).done) return;
      if (state.g.includes(code)) {
        toast(t('already'));
        return;
      }
      state.g.push(code);
      saveGame(MODE, ctx.day, state);
      const st = status(state.g, target);
      if (st.done) recordResult(MODE, ctx.day, st.won, bucketFor(state.g, target), scoreLabel(state.g, target));
      render(true);
    }

    function renderClues(done: boolean, fresh: boolean) {
      const shown = revealedCount(state.g, target, puzzle.names.length);
      clues.replaceChildren(
        ...puzzle.names.map((n, i) => {
          const visible = i < shown;
          const isNew = fresh && visible && i === shown - 1 && !done;
          return h(
            'li',
            { class: `hl-clue${visible ? '' : ' is-hidden'}${isNew ? ' is-new' : ''}` },
            h('span', { class: 'hl-num' }, String(i + 1)),
            visible
              ? h('span', { class: 'hl-name' }, n.n, done && n.admin1 ? h('span', { class: 'hl-admin' }, n.admin1) : null)
              : h('span', { class: 'hl-name hl-placeholder', 'aria-label': t('hidden') }, '· · ·'),
          );
        }),
      );
    }

    function renderGuesses() {
      guessList.replaceChildren(
        ...state.g.map((g) => {
          const ok = g === target;
          const same = sameFamily(g, target, families);
          return h(
            'li',
            { class: `guess${ok ? ' good' : ''}` },
            h('span', { class: 'hl-g' }, h('span', { 'aria-hidden': 'true' }, flag(g)), ' ', countryName(g)),
            h('span', { class: `tag hl-fam${same || ok ? ' is-same' : ''}` }, familyLabel(g)),
            h('span', { class: 'hl-dist' }, distanceCell(g, target)),
          );
        }),
      );
    }

    function renderEnd() {
      const st = status(state.g, target);
      const mapBox = h('div', { class: 'mapbox hl-map' });
      revealMap(target, puzzle.names)
        .then((svg) => {
          svg.setAttribute('aria-label', countryName(target));
          mapBox.replaceChildren(svg);
        })
        .catch(() => mapBox.remove());
      const detail = h(
        'div',
        { class: 'hl-reveal' },
        h('p', { class: 'hl-answer' }, h('span', { class: 'hl-flag', 'aria-hidden': 'true' }, flag(target)), ' ', t('answerIs', { c: countryName(target) })),
        h('p', { class: 'muted hl-family' }, t('familyOf', { f: familyLabel(target) })),
        mapBox,
        puzzle.pat ? h('p', { class: 'hl-pattern' }, t('pattern', { pct: puzzle.pat.pct, s: puzzle.pat.s })) : null,
        h('p', { class: 'hl-source muted' }, t('source')),
      );
      after.replaceChildren(
        resultPanel({
          won: st.won,
          headline: st.won ? t('solved') : t('failed'),
          detail,
          share: shareText(ctx.day, state.g, target, families),
          mode: MODE,
          buckets: BUCKETS,
        }),
      );
    }

    function render(fresh = false) {
      const st = status(state.g, target);
      renderClues(st.done, fresh);
      renderGuesses();
      input.el.hidden = st.done;
      const remaining = MAX_GUESSES - state.g.length;
      left.textContent = st.done ? '' : remaining === 1 ? t('lastGuess') : t('left', { n: remaining });
      left.hidden = st.done;
      if (st.done) renderEnd();
      else after.replaceChildren();
    }

    render();
  },

  howTo() {
    return h(
      'div',
      {},
      h('p', {}, t('h1')),
      h('p', {}, t('h2')),
      h('p', {}, t('h3')),
      h('p', { class: 'howto-example' }, t('ex')),
    );
  },
};

export default mode;
