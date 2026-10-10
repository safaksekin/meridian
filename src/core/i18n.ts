import { getPref, setPref } from './storage';

export type Lang = 'en' | 'tr';
export type Dict = Record<string, string>;

function detect(): Lang {
  const saved = getPref('lang');
  if (saved === 'en' || saved === 'tr') return saved;
  return (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en';
}

export let lang: Lang = detect();

export function setLang(l: Lang): void {
  lang = l;
  setPref('lang', l);
  document.documentElement.lang = l;
}

const CORE: Record<Lang, Dict> = {
  en: {
    tagline: 'Six daily geography puzzles',
    play: 'Play',
    done: 'Done',
    share: 'Share result',
    copied: 'Copied to clipboard',
    next: 'Next puzzle in',
    stats: 'Statistics',
    played: 'Played',
    winPct: 'Win %',
    streak: 'Streak',
    maxStreak: 'Best',
    howTo: 'How to play',
    close: 'Close',
    back: 'All games',
    guess: 'Guess',
    typeCountry: 'Type a country…',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    noMatch: 'No match',
    already: 'Already guessed',
    unknown: 'Pick an item from the list',
    loading: 'Loading…',
    loadError: 'Could not load today\'s puzzle. Check your connection and reload.',
    solved: 'Solved!',
    failed: 'Out of guesses',
    answer: 'Answer',
    day: 'Day',
    attribution: 'Data',
    language: 'Language',
    themeLight: 'Switch to light theme',
    themeDark: 'Switch to dark theme',
    testMode: 'Test mode',
    testHint: 'Daily limit is off while we test',
    prev: 'Previous puzzle',
    nextPuzzle: 'Next puzzle',
    random: 'Random puzzle',
    replay: 'Play again',
    puzzle: 'Puzzle',
    today: 'Today',
    todayProgress: '{n} of 6 played today',
    newIn: 'New puzzles in',
    brandSub: 'Geography & discovery',
    streakTitle: 'Daily streak',
    streakDays: '{n} days',
    navExplore: 'Explore',
    navDaily: 'Daily challenge',
    navRecords: 'Records',
    changeName: 'change name',
    setName: 'Set your explorer name',
    pickName: 'Pick a name',
  },
  tr: {
    tagline: 'Her gün altı coğrafya bulmacası',
    play: 'Oyna',
    done: 'Bitti',
    share: 'Sonucu paylaş',
    copied: 'Panoya kopyalandı',
    next: 'Sonraki bulmaca',
    stats: 'İstatistikler',
    played: 'Oynanan',
    winPct: 'Kazanma %',
    streak: 'Seri',
    maxStreak: 'En iyi',
    howTo: 'Nasıl oynanır',
    close: 'Kapat',
    back: 'Tüm oyunlar',
    guess: 'Tahmin et',
    typeCountry: 'Bir ülke yaz…',
    zoomIn: 'Yakınlaş',
    zoomOut: 'Uzaklaş',
    noMatch: 'Eşleşme yok',
    already: 'Bunu zaten denedin',
    unknown: 'Listeden bir seçim yap',
    loading: 'Yükleniyor…',
    loadError: 'Bugünün bulmacası yüklenemedi. Bağlantını kontrol edip yenile.',
    solved: 'Bildin!',
    failed: 'Hakların bitti',
    answer: 'Cevap',
    day: 'Gün',
    attribution: 'Veri',
    language: 'Dil',
    themeLight: 'Açık temaya geç',
    themeDark: 'Koyu temaya geç',
    testMode: 'Test modu',
    testHint: 'Test süresince günlük sınır kapalı',
    prev: 'Önceki bulmaca',
    nextPuzzle: 'Sonraki bulmaca',
    random: 'Rastgele bulmaca',
    replay: 'Baştan oyna',
    puzzle: 'Bulmaca',
    today: 'Bugün',
    todayProgress: 'Bugün {n}/6 oynandı',
    newIn: 'Yeni bulmacalara',
    brandSub: 'Coğrafya & keşif',
    streakTitle: 'Günlük seri',
    streakDays: '{n} gün',
    navExplore: 'Keşfet',
    navDaily: 'Günlük meydan okuma',
    navRecords: 'Rekorlar',
    changeName: 'adını değiştir',
    setName: 'Kaşif adını belirle',
    pickName: 'İsim seç',
  },
};

/** Build a translator over the core strings plus a mode's own strings. Supports {name} placeholders. */
export function makeT(extra?: Record<Lang, Dict>) {
  return (key: string, vars?: Record<string, string | number>): string => {
    let s = extra?.[lang]?.[key] ?? CORE[lang][key] ?? extra?.en?.[key] ?? CORE.en[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
    return s;
  };
}

export const t = makeT();

/** Lowercase, strip accents and Turkish dotted/dotless i so "turkiye" matches "Türkiye". */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
