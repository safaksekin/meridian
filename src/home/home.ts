import './home.css';
import { geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { MODES } from '../modes/registry';
import { h, modal, svgEl, toast } from '../core/ui';
import { lang, makeT } from '../core/i18n';
import { getStats } from '../core/storage';
import { msUntilTomorrow, puzzleIndex } from '../core/daily';
import { loadJSON } from '../core/data';
import { loadWorld } from '../core/map';
import { flag } from '../core/geo';
import { progressSummary } from '../core/progress';
import { preview } from './previews';

const t = makeT({
  en: {
    kicker: 'Daily challenge',
    title: 'How well do you know the world?',
    sub: 'Six new puzzles every day. One planet. Think in maps, read borders and street patterns, and put your geographic instinct to the test.',
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
    min: '~{n} min',
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
    kicker: 'Günlük meydan okuma',
    title: 'Dünyayı ne kadar iyi tanıyorsun?',
    sub: 'Her gün altı yeni bulmaca. Tek bir dünya. Haritaların diliyle düşün, sınırları ve sokak dokularını oku, coğrafi sezgini sına.',
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
    min: '~{n} dk',
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

/** Typical play time (minutes) and difficulty (1–3) per mode, shown on cards. */
const META: Record<string, { min: number; diff: number }> = {
  beeline: { min: 3, diff: 2 },
  streets: { min: 3, diff: 3 },
  mental: { min: 2, diff: 2 },
  headcount: { min: 3, diff: 2 },
  hinterland: { min: 2, diff: 3 },
  tripoint: { min: 2, diff: 3 },
};

const EPOCH = Date.UTC(2026, 9, 10);
function dateOfDay(day: number): Date {
  return new Date(EPOCH + (day - 1) * 86400000);
}
function fmtDate(day: number, opts: Intl.DateTimeFormatOptions): string {
  return dateOfDay(day).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { ...opts, timeZone: 'UTC' });
}

function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.round((a - d) * 60);
  return `${d}°${String(m === 60 ? 59 : m).padStart(2, '0')}′${v >= 0 ? pos : neg}`;
}
const NS = () => (lang === 'tr' ? ['K', 'G'] : ['N', 'S']);
const EW = () => (lang === 'tr' ? ['D', 'B'] : ['E', 'W']);
function coord(lat: number, lon: number): string {
  return `${dms(lat, NS()[0], NS()[1])} ${dms(lon, EW()[0], EW()[1])}`;
}

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

// ---------------------------------------------------------------- hero globe
interface BeelinePuzzle { city: string; cc: string; lat: number; lon: number; b: number }

function destination(lat: number, lon: number, brg: number, km: number): [number, number] {
  const r = Math.PI / 180;
  const d = km / 6371.0088;
  const p1 = lat * r;
  const l1 = lon * r;
  const b = brg * r;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [((l2 / r + 540) % 360) - 180, p2 / r];
}

function routePanel(day: number): HTMLElement {
  const size = 360;
  const svg = svgEl('svg', { viewBox: `0 0 ${size} ${size}`, class: 'route-globe', role: 'img', 'aria-label': t('routeTag') });
  const caption = h('div', { class: 'route-caption' });
  const panel = h(
    'a',
    { class: 'route-panel', href: '#/beeline' },
    h('div', { class: 'route-head' }, h('span', { class: 'kicker live' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), t('routeTag')), h('span', { class: 'route-n', 'aria-hidden': 'true' }, NS()[0])),
    h('div', { class: 'route-stage' }, svg),
    caption,
  );
  Promise.all([loadJSON<BeelinePuzzle[]>('beeline/puzzles.json'), loadWorld()])
    .then(([puzzles, world]) => {
      const p = puzzles[puzzleIndex(day, puzzles.length)];
      caption.replaceChildren(
        h('span', { class: 'route-city' }, `${flag(p.cc)} ${p.city}`),
        h('span', { class: 'mono route-coord' }, coord(p.lat, p.lon)),
        h('span', { class: 'route-brg' }, h('small', { class: 'mono' }, t('heading').toUpperCase()), h('strong', { class: 'mono' }, `${String(p.b).padStart(3, '0')}°`)),
      );
      const proj = geoOrthographic().scale(size / 2 - 10).translate([size / 2, size / 2]).clipAngle(90).precision(0.5);
      const path = geoPath(proj);
      const grat = geoGraticule10();
      const stub: [number, number][] = [0, 150, 300, 450, 600, 750].map((km) => destination(p.lat, p.lon, p.b, km));
      const sphere = svgEl('path', { class: 'rg-sphere' });
      const gratEl = svgEl('path', { class: 'rg-grat' });
      const land = svgEl('path', { class: 'rg-land' });
      const borders = svgEl('path', { class: 'rg-borders' });
      const arc = svgEl('path', { class: 'rg-arc' });
      const halo = svgEl('circle', { class: 'rg-halo', r: 14 });
      const pin = svgEl('circle', { class: 'rg-pin', r: 5 });
      svg.append(sphere, gratEl, land, borders, arc, halo, pin);
      const landGeo = { type: 'FeatureCollection', features: world.countries } as unknown as GeoJSON.FeatureCollection;
      let lon0 = p.lon + 35;
      const lat0 = Math.max(-35, Math.min(35, p.lat * 0.7));
      const draw = () => {
        proj.rotate([-lon0, -lat0]);
        sphere.setAttribute('d', path({ type: 'Sphere' }) ?? '');
        gratEl.setAttribute('d', path(grat) ?? '');
        land.setAttribute('d', path(landGeo) ?? '');
        borders.setAttribute('d', path(world.borders) ?? '');
        arc.setAttribute('d', path({ type: 'LineString', coordinates: stub }) ?? '');
        const c = proj([p.lon, p.lat]);
        const visible = path({ type: 'Point', coordinates: [p.lon, p.lat] }) != null;
        for (const el of [pin, halo]) {
          el.style.display = c && visible ? '' : 'none';
          if (c) {
            el.setAttribute('cx', String(c[0]));
            el.setAttribute('cy', String(c[1]));
          }
        }
      };
      draw();
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        lon0 = p.lon;
        draw();
        return;
      }
      // Glide towards the start city, then drift slowly.
      let last = performance.now();
      let target = p.lon;
      const step = (now: number) => {
        if (!svg.isConnected) return;
        const dt = Math.min(64, now - last);
        last = now;
        const gap = ((target - lon0 + 540) % 360) - 180;
        if (Math.abs(gap) > 0.5) lon0 += gap * Math.min(1, dt / 900);
        else target -= dt * 0.004;
        draw();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    })
    .catch((e) => console.warn('route panel', e));
  return panel;
}

// ---------------------------------------------------------------- cards
function pips(n: number): HTMLElement {
  return h('span', { class: 'pips', title: t('difficulty'), 'aria-label': `${t('difficulty')} ${n}/3` }, ...[1, 2, 3].map((i) => h('i', { class: i <= n ? 'on' : '' })));
}

function lazyPreview(holder: HTMLElement, id: string, day: number) {
  const load = () =>
    preview(id, day)
      .then((svg) => {
        holder.querySelector('.pv-skeleton')?.remove();
        holder.prepend(svg);
        holder.classList.add('ready');
      })
      .catch((e) => console.warn('preview', id, e));
  if (!('IntersectionObserver' in window)) return load();
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        load();
      }
    },
    { rootMargin: '200px' },
  );
  io.observe(holder);
}

function card(m: (typeof MODES)[number], i: number, day: number): HTMLElement {
  const res = getStats(m.id).history[day];
  const meta = META[m.id];
  const media = h(
    'div',
    { class: 'mc-media' },
    h('div', { class: 'pv-skeleton', 'aria-hidden': 'true' }),
    h('span', { class: 'mc-tag' }, t(`cat_${m.id}`)),
    h('span', { class: `mc-badge${res ? ' done' : ''}` }, res ? `✓ ${t('completed')}` : t('nthGame', { n: i + 1 })),
  );
  lazyPreview(media, m.id, day);
  return h(
    'a',
    { href: `#/${m.id}`, class: `mc${res ? (res.won ? ' is-won' : ' is-lost') : ''}`, 'aria-label': `${m.name[lang]}: ${m.blurb[lang]}` },
    media,
    h(
      'div',
      { class: 'mc-body' },
      h('div', { class: 'mc-title-row' }, h('h3', { class: 'mc-title' }, m.name[lang]), pips(meta.diff)),
      h('p', { class: 'mc-blurb' }, m.blurb[lang]),
      h(
        'div',
        { class: 'mc-foot' },
        res
          ? h('span', { class: `mc-score ${res.won ? 'won' : 'lost'}` }, `${res.won ? '🏅' : '•'} ${res.label}`)
          : h('span', { class: 'mono mc-time' }, `⏱ ${t('min', { n: meta.min })}`),
        h('span', { class: `mc-cta${res ? ' ghost' : ''}` }, res ? t('review') : `${t('play')} →`),
      ),
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
export function renderHome(day: number): HTMLElement {
  const done = MODES.filter((m) => getStats(m.id).history[day]).length;
  const next = MODES.find((m) => !getStats(m.id).history[day]);
  const p = progressSummary();
  const dateLong = fmtDate(day, { day: 'numeric', month: 'long', year: 'numeric' });
  const dateShort = fmtDate(day, { day: 'numeric', month: 'long' }).toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-GB');

  const hero = h(
    'section',
    { class: 'hero2' },
    h(
      'div',
      { class: 'hero-copy' },
      h('p', { class: 'kicker live' }, h('i', { class: 'live-dot', 'aria-hidden': 'true' }), `${dateShort} · ${t('kicker')} · #${day}`),
      h('h1', {}, t('title')),
      h('p', { class: 'hero-sub' }, t('sub')),
      h(
        'div',
        { class: 'hero-actions' },
        next
          ? h('a', { class: 'btn primary', href: `#/${next.id}` }, `${t('start')} →`)
          : h('button', { class: 'btn primary', type: 'button', onclick: () => document.querySelector('.compete')?.scrollIntoView({ behavior: 'smooth' }) }, t('allDone')),
        h('button', { class: 'btn', type: 'button', onclick: howModal }, t('how')),
      ),
      h(
        'p',
        { class: 'hero-meta2' },
        h('span', {}, `⏳ ${t('reset')} `, countdownEl()),
        h('span', { class: 'sep', 'aria-hidden': 'true' }),
        h('span', {}, `◎ ${t('doneOf', { n: done })}`),
      ),
    ),
    routePanel(day),
  );

  const section = h(
    'section',
    { class: 'today-sec' },
    h(
      'div',
      { class: 'today-head' },
      h('div', {}, h('p', { class: 'kicker' }, t('section')), h('h2', {}, t('discoveries')), h('p', { class: 'muted' }, t('curated', { date: dateLong }))),
      h(
        'div',
        { class: 'today-progress panel-card' },
        h('div', { class: 'tp-row' }, h('strong', {}, t('progressTitle', { n: done })), h('span', { class: 'xp-chip' }, `+${p.todayXp} XP`)),
        h('div', { class: 'bar' }, h('i', { style: { width: `${(done / 6) * 100}%` } })),
        h('p', { class: 'muted mono' }, t('finishAll')),
      ),
    ),
    h('nav', { class: 'mc-grid', 'aria-label': t('discoveries') }, ...MODES.map((m, i) => card(m, i, day))),
  );

  const compete = h('section', { class: 'compete' }, profilePanel(), streakPanel(), recordsPanel());

  const foot = h(
    'footer',
    { class: 'foot2' },
    h('div', { class: 'foot-strip mono' }, h('span', {}, 'MERIDIAN ATLAS'), h('span', {}, t('footProj').toUpperCase()), h('span', {}, t('footCycle').toUpperCase())),
    h(
      'p',
      {},
      `${t('footData')}: Natural Earth, GeoNames (CC BY 4.0), © OpenStreetMap contributors (ODbL), GHSL (CC BY 4.0), Wikidata (CC0). `,
      h('a', { href: 'https://github.com/safaksekin/meridian', target: '_blank', rel: 'noopener' }, 'GitHub'),
    ),
  );

  return h('main', { class: 'home' }, hero, section, compete, foot);
}
