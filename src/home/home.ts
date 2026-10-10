import './home.css';
import { MODES } from '../modes/registry';
import { h, modal, toast } from '../core/ui';
import { lang, makeT } from '../core/i18n';
import { getStats } from '../core/storage';
import { msUntilTomorrow } from '../core/daily';
import { progressSummary } from '../core/progress';
import { ICONS, OVERLAYS, IMG } from './cardart';
import { consumeScroll } from './chrome';

const t = makeT({
  en: {
    title: 'How well do you know the world?',
    sub: 'A new place every day. Six different games. One world.',
    explore: 'Explore all games',
    navExplore: 'Explore',
    navDaily: 'Daily challenge',
    navRecords: 'Records',
    photoCaption: 'Barcelona from the International Space Station',
    credits: 'Images: NASA (public domain), Unsplash contributors (CC0) via Wikimedia Commons.',
    start: "Start today's puzzles",
    allDone: 'All six done. See your record',
    how: 'How it works',
    reset: 'Reset',
    doneOf: '{n}/6 done',
    routeTag: "Today's route",
    heading: 'Heading',
    section: 'Daily geography series',
    discoveries: "Today's discoveries",
    curated: 'Hand-picked puzzles for {date}',
    progressTitle: '{n} / 6 completed',
    finishAll: 'Finish all six to grow your streak and level',
    nthGame: 'Game {n} of the day',
    completed: 'Completed',
    play: 'Play',
    review: 'Review',
    difficulty: 'Difficulty',
    profileKicker: 'Explorer profile',
    level: 'Level {n}',
    xpTo: '{xp} XP · {left} XP to level {next}',
    challengeTitle: 'Challenge your friends',
    challengeText: 'Finish any puzzle, then send a challenge link from the result screen. Your friend plays the same puzzle and sees who did better.',
    streakKicker: 'Daily streak',
    streakTitle: 'Keep your streak alive',
    streakText: 'Finish at least one puzzle a day.',
    days: '{n} days',
    best: 'Best: {n}',
    shareStreak: 'Share your streak',
    streakShareText: 'My Meridian exploration streak: {n} days 🔥 Level {lv} {title}. Can you beat it?',
    recordsKicker: 'Your record book',
    recordsTitle: 'Personal records',
    recordsNote: 'Stored only on this device. No accounts, no tracking.',
    colGame: 'Game',
    colPlayed: 'Played',
    colWin: 'Win %',
    colStreak: 'Streak',
    colBest: 'Best',
    howTitle: 'How Meridian works',
    how1: 'Every day at midnight six new puzzles appear. Everyone in the world gets the same ones.',
    how2: 'Each finished puzzle earns XP. Wins and sharp answers earn more. XP raises your explorer level.',
    how3: 'Finish at least one puzzle a day to keep your streak.',
    how4: 'After a puzzle, send a challenge link: your friend plays the same puzzle and the result screen shows who won.',
    footData: 'Data',
    footProj: 'Projection WGS 84',
    footCycle: 'New puzzles at local midnight',
    cat_beeline: 'Route puzzle',
    cat_streets: 'Urban fabric',
    cat_mental: 'Mental map',
    cat_headcount: 'Demography',
    cat_hinterland: 'Place names',
    cat_tripoint: 'Border geography',
  },
  tr: {
    title: 'Dünyayı ne kadar iyi tanıyorsun?',
    sub: 'Her gün yeni bir yer. Altı farklı oyun. Tek bir dünya.',
    explore: 'Tüm oyunları keşfet',
    navExplore: 'Keşfet',
    navDaily: 'Günlük meydan okuma',
    navRecords: 'Rekorlar',
    photoCaption: 'Uluslararası Uzay İstasyonu’ndan Barselona',
    credits: 'Görseller: NASA (kamu malı), Unsplash katkıcıları (CC0), Wikimedia Commons üzerinden.',
    start: 'Bugünün oyunlarına başla',
    allDone: 'Altısı da bitti. Rekorlarına bak',
    how: 'Nasıl işler?',
    reset: 'Sıfırlanma',
    doneOf: '{n}/6 tamam',
    routeTag: 'Günün rotası',
    heading: 'Yön',
    section: 'Günlük coğrafya serisi',
    discoveries: 'Bugünün keşifleri',
    curated: '{date} için seçilmiş bulmacalar',
    progressTitle: '{n} / 6 tamamlandı',
    finishAll: 'Serini ve seviyeni büyütmek için altısını da bitir',
    nthGame: 'Günün {n}. oyunu',
    completed: 'Tamamlandı',
    play: 'Oyna',
    review: 'İncele',
    difficulty: 'Zorluk',
    profileKicker: 'Kaşif profili',
    level: 'Seviye {n}',
    xpTo: '{xp} XP · seviye {next} için {left} XP',
    challengeTitle: 'Arkadaşlarına meydan oku',
    challengeText: 'Bir bulmacayı bitir, sonuç ekranından meydan okuma linki gönder. Arkadaşın aynı bulmacayı oynar ve kimin daha iyi olduğunu görür.',
    streakKicker: 'Günlük devamlılık',
    streakTitle: 'Serini koru',
    streakText: 'Her gün en az bir bulmacayı bitir.',
    days: '{n} gün',
    best: 'En iyi: {n}',
    shareStreak: 'Serini paylaş',
    streakShareText: 'Meridian keşif serim: {n} gün 🔥 Seviye {lv} {title}. Geçebilir misin?',
    recordsKicker: 'Rekor defterin',
    recordsTitle: 'Kişisel rekorlar',
    recordsNote: 'Sadece bu cihazda saklanır. Hesap yok, takip yok.',
    colGame: 'Oyun',
    colPlayed: 'Oynanan',
    colWin: 'Kazanma %',
    colStreak: 'Seri',
    colBest: 'En iyi',
    howTitle: 'Meridian nasıl işler?',
    how1: 'Her gece yarısı altı yeni bulmaca gelir. Dünyadaki herkes aynı bulmacaları oynar.',
    how2: 'Bitirdiğin her bulmaca XP kazandırır. Kazanmak ve keskin cevaplar daha çok kazandırır. XP kaşif seviyeni yükseltir.',
    how3: 'Serini korumak için her gün en az bir bulmaca bitir.',
    how4: 'Bulmacadan sonra meydan okuma linki gönder: arkadaşın aynı bulmacayı oynar, sonuç ekranı kimin kazandığını gösterir.',
    footData: 'Veri',
    footProj: 'Projeksiyon WGS 84',
    footCycle: 'Yeni bulmacalar yerel gece yarısında',
    cat_beeline: 'Rota bulmacası',
    cat_streets: 'Şehir dokusu',
    cat_mental: 'Bilişsel harita',
    cat_headcount: 'Demografi',
    cat_hinterland: 'Yer adları',
    cat_tripoint: 'Sınır coğrafyası',
  },
});

const NS = () => (lang === 'tr' ? ['K', 'G'] : ['N', 'S']);
const EW = () => (lang === 'tr' ? ['D', 'B'] : ['E', 'W']);

function countdownEl(): HTMLElement {
  const el = h('span', { class: 'mono' });
  const tick = () => {
    const ms = msUntilTomorrow();
    const p = (n: number) => String(n).padStart(2, '0');
    el.textContent = `${p(Math.floor(ms / 3600000))}:${p(Math.floor((ms % 3600000) / 60000))}:${p(Math.floor((ms % 60000) / 1000))}`;
    if (el.isConnected) setTimeout(tick, 1000);
  };
  setTimeout(tick, 0);
  tick();
  return el;
}

async function share(text: string) {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) return await navigator.share({ text });
  } catch {
    /* fall through */
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(lang === 'tr' ? 'Panoya kopyalandı' : 'Copied to clipboard');
  } catch {
    prompt('', text);
  }
}

// ---------------------------------------------------------------- hero map
const BCN: [number, number] = [41.39, 2.17];
// hero-europe.jpg is an equirectangular crop: lon -26..52, lat 72..28
function heroXY(lat: number, lon: number): [number, number] {
  return [((lon + 26) / 78) * 100, ((72 - lat) / 44) * 100];
}

function compassRose(): string {
  return `<svg viewBox="-50 -50 100 100" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width=".8"><circle r="30"/><circle r="22" stroke-dasharray="1 2.4"/></g><g fill="currentColor"><path d="M0-44 4-4 0 0-4-4Z"/><path d="M0 44 4 4 0 0-4 4Z" opacity=".55"/><path d="M44 0 4 4 0 0 4-4Z" opacity=".55"/><path d="M-44 0-4 4 0 0-4-4Z" opacity=".55"/></g><g font-family="Archivo Narrow, sans-serif" font-size="7" font-weight="700" text-anchor="middle" fill="currentColor"><text y="-46">N</text><text y="52">S</text><text x="49" y="2.5">E</text><text x="-49" y="2.5">W</text></g></svg>`;
}

function heroArt(): HTMLElement {
  const [px, py] = heroXY(BCN[0], BCN[1]);
  const art = h('div', { class: 'hero-art', 'aria-hidden': 'true' });
  // .hero-stage has the image's own frame (see home.css), so the pin stays on Barcelona however the map is cropped.
  art.innerHTML = `
    <img class="hero-map" src="img/hero-europe.jpg" alt="" width="1600" height="902" fetchpriority="high">
    <div class="hero-clip"><div class="hero-stage">
      <svg class="hero-route" viewBox="0 0 100 100" preserveAspectRatio="none"><path d="M${px} ${py} C ${px + 9} ${py - 26}, ${px + 19} ${py - 40}, 66 26" vector-effect="non-scaling-stroke"/></svg>
      <span class="hero-pin" style="left:${px}%;top:${py}%"></span>
    </div></div>
    <span class="hero-rose">${compassRose()}</span>`;
  const photo = h(
    'figure',
    { class: 'hero-photo' },
    h('img', { src: 'img/photo-barcelona.jpg', alt: t('photoCaption'), loading: 'eager', width: '480', height: '360' }),
    h('figcaption', {}, h('span', { class: 'hp-pin', 'aria-hidden': 'true' }), h('span', { class: 'mono' }, `${BCN[0].toFixed(4)}° ${NS()[0]}   ${BCN[1].toFixed(4)}° ${EW()[0]}`)),
  );
  art.append(photo);
  return art;
}

// ---------------------------------------------------------------- cards
function card(m: (typeof MODES)[number], day: number): HTMLElement {
  const res = getStats(m.id).history[day];
  const media = h('div', { class: `mc-media mc-${m.id}` });
  media.innerHTML = `<img src="${IMG[m.id]}" alt="" loading="lazy" width="800" height="500">${OVERLAYS[m.id] ?? ''}`;
  media.append(h('span', { class: 'mc-tag' }, t(`cat_${m.id}`)));
  if (res) media.append(h('span', { class: `mc-badge done${res.won ? '' : ' lost'}` }, `✓ ${t('completed')}`));
  const icon = h('span', { class: 'mc-icon', 'aria-hidden': 'true' });
  icon.innerHTML = ICONS[m.id] ?? '';
  return h(
    'a',
    { href: `#/${m.id}`, class: `mc${res ? ' is-done' : ''}`, 'aria-label': `${m.name[lang]}: ${m.blurb[lang]}` },
    media,
    h(
      'div',
      { class: 'mc-body' },
      icon,
      h(
        'div',
        { class: 'mc-text' },
        h('h3', { class: 'mc-title' }, m.name[lang]),
        h('p', { class: 'mc-blurb' }, m.blurb[lang]),
        res ? h('div', { class: 'mc-meta' }, h('span', { class: `mc-score ${res.won ? 'won' : 'lost'}` }, res.label)) : null,
      ),
      h('span', { class: 'mc-go', 'aria-hidden': 'true' }, '→'),
    ),
  );
}

// ---------------------------------------------------------------- competition panels
function profilePanel(): HTMLElement {
  const p = progressSummary();
  const span = Math.max(1, p.nextLevelXp - p.levelStartXp);
  const pct = Math.max(0, Math.min(100, ((p.xp - p.levelStartXp) / span) * 100));
  return h(
    'section',
    { class: 'pp panel-card' },
    h('p', { class: 'kicker' }, t('profileKicker')),
    h('div', { class: 'pp-level' }, h('span', { class: 'pp-badge', 'aria-hidden': 'true' }, String(p.level)), h('div', {}, h('h3', {}, p.levelTitle), h('p', { class: 'muted mono pp-xp' }, t('xpTo', { xp: p.xp, left: Math.max(0, p.nextLevelXp - p.xp), next: p.level + 1 })))),
    h('div', { class: 'bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pct)) }, h('i', { style: { width: `${pct}%` } })),
    h('div', { class: 'pp-challenge' }, h('span', { class: 'pp-swords', 'aria-hidden': 'true' }, '⚔️'), h('div', {}, h('strong', {}, t('challengeTitle')), h('p', { class: 'muted' }, t('challengeText')))),
  );
}

function streakPanel(): HTMLElement {
  const p = progressSummary();
  const url = `${location.origin}${location.pathname}`;
  return h(
    'section',
    { class: 'sp panel-card' },
    h('div', { class: 'sp-head' }, h('div', {}, h('p', { class: 'kicker' }, t('streakKicker')), h('h3', {}, t('streakTitle')), h('p', { class: 'muted' }, t('streakText'))), h('span', { class: 'sp-flame', 'aria-hidden': 'true' }, '🔥')),
    h('div', { class: 'sp-count' }, h('strong', {}, t('days', { n: p.streak })), h('span', { class: 'mono muted' }, t('best', { n: p.bestStreak }))),
    h(
      'ol',
      { class: 'week' },
      ...p.week.map((d) =>
        h('li', { class: `${d.played ? 'played' : ''}${d.today ? ' today' : ''}${d.future ? ' future' : ''}` }, h('span', { class: 'mono' }, d.label), h('i', { 'aria-hidden': 'true' }, d.played ? '✓' : d.future ? '' : '·')),
      ),
    ),
    h('button', { class: 'btn wide', type: 'button', onclick: () => share(`${t('streakShareText', { n: p.streak, lv: p.level, title: p.levelTitle })}\n${url}`) }, `↗ ${t('shareStreak')}`),
  );
}

function recordsPanel(): HTMLElement {
  const rows = MODES.map((m) => {
    const s = getStats(m.id);
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, h('span', { 'aria-hidden': 'true' }, `${m.icon} `), m.name[lang]),
      h('td', { class: 'mono' }, String(s.played)),
      h('td', { class: 'mono' }, s.played ? `${Math.round((100 * s.wins) / s.played)}%` : '–'),
      h('td', { class: 'mono' }, String(s.streak)),
      h('td', { class: 'mono gold' }, String(s.maxStreak)),
    );
  });
  return h(
    'section',
    { class: 'rb panel-card' },
    h('p', { class: 'kicker' }, t('recordsKicker')),
    h('h3', {}, t('recordsTitle')),
    h(
      'div',
      { class: 'rb-scroll' },
      h(
        'table',
        { class: 'rb-table' },
        h('thead', {}, h('tr', {}, ...[t('colGame'), t('colPlayed'), t('colWin'), t('colStreak'), t('colBest')].map((c) => h('th', { scope: 'col' }, c)))),
        h('tbody', {}, ...rows),
      ),
    ),
    h('p', { class: 'muted rb-note' }, t('recordsNote')),
  );
}

function howModal() {
  modal(t('howTitle'), h('ol', { class: 'how-list' }, ...['how1', 'how2', 'how3', 'how4'].map((k) => h('li', {}, t(k)))));
}

// ---------------------------------------------------------------- page
export function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

export function renderHome(day: number): HTMLElement {
  const done = MODES.filter((m) => getStats(m.id).history[day]).length;
  const next = MODES.find((m) => !getStats(m.id).history[day]);
  const p = progressSummary();

  const hero = h(
    'section',
    { class: 'hero2' },
    h(
      'div',
      { class: 'hero-copy' },
      h('h1', {}, t('title')),
      h('p', { class: 'hero-sub' }, t('sub')),
      h(
        'div',
        { class: 'hero-actions' },
        next
          ? h('a', { class: 'btn cta', href: `#/${next.id}` }, `${t('start')}`, h('span', { 'aria-hidden': 'true' }, '→'))
          : h('button', { class: 'btn cta', type: 'button', onclick: () => scrollToId('records') }, t('allDone')),
        h('button', { class: 'link-btn', type: 'button', onclick: () => scrollToId('games') }, t('explore'), h('span', { 'aria-hidden': 'true' }, '→')),
      ),
      h('p', { class: 'hero-meta2' }, h('span', {}, `⏳ ${t('reset')} `, countdownEl()), h('span', { class: 'sep', 'aria-hidden': 'true' }), h('button', { class: 'link-btn small', type: 'button', onclick: howModal }, t('how'))),
    ),
    heroArt(),
  );

  const section = h(
    'section',
    { class: 'today-sec', id: 'games' },
    h(
      'div',
      { class: 'today-head' },
      h('h2', {}, t('discoveries')),
      h('div', { class: 'today-progress' }, h('span', {}, t('progressTitle', { n: done })), h('div', { class: 'bar' }, h('i', { style: { width: `${(done / 6) * 100}%` } })), p.todayXp ? h('span', { class: 'xp-chip' }, `+${p.todayXp} XP`) : null),
      h('span', { class: 'today-rule', 'aria-hidden': 'true' }),
    ),
    h('nav', { class: 'mc-grid', 'aria-label': t('discoveries') }, ...MODES.map((m) => card(m, day))),
  );

  const compete = h('section', { class: 'compete', id: 'records' }, profilePanel(), streakPanel(), recordsPanel());

  const foot = h(
    'footer',
    { class: 'foot2' },
    h('div', { class: 'foot-strip mono' }, h('span', {}, 'MERIDIAN'), h('span', {}, t('footProj').toUpperCase()), h('span', {}, t('footCycle').toUpperCase())),
    h(
      'p',
      {},
      `${t('footData')}: Natural Earth, GeoNames (CC BY 4.0), © OpenStreetMap contributors (ODbL), GHSL (CC BY 4.0), Wikidata (CC0). ${t('credits')} `,
      h('a', { href: 'https://github.com/safaksekin/meridian', target: '_blank', rel: 'noopener' }, 'GitHub'),
    ),
  );

  setTimeout(consumeScroll, 0);
  return h('main', { class: 'home' }, hero, section, compete, foot);
}
