// Shared page chrome: header with language menu, and the test-mode toolbar.
import { h } from '../core/ui';
import { lang, setLang, t, type Lang } from '../core/i18n';
import { LOGO } from './art';
import { TEST_MODE } from '../core/config';
import { dayNumber, todayNumber } from '../core/daily';
import { clearGame, getPref, setPref } from '../core/storage';
import { progressSummary } from '../core/progress';
import { editNickname, getNickname } from '../core/challenge';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'English' },
];

function langMenu(onChange: () => void): HTMLElement {
  const select = h(
    'select',
    { class: 'lang-select', 'aria-label': t('language') },
    ...LANGS.map((l) => h('option', { value: l.id, selected: l.id === lang }, l.label)),
  ) as HTMLSelectElement;
  select.addEventListener('change', () => {
    setLang(select.value as Lang);
    onChange();
  });
  return h(
    'label',
    { class: 'lang-menu' },
    h('span', { class: 'lang-globe', 'aria-hidden': 'true' }, '🌐'),
    select,
    h('span', { class: 'lang-caret', 'aria-hidden': 'true' }, '▾'),
  );
}

function goHomeAndScroll(id: string) {
  const onHome = location.hash.replace(/^#\/?/, '') === '';
  if (onHome) {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  try {
    sessionStorage.setItem('meridian:scrollTo', id);
  } catch {
    /* ignore */
  }
  location.hash = '#/';
}

/** Called by the home page after it renders: honours a scroll request from the header nav. */
export function consumeScroll() {
  let id: string | null = null;
  try {
    id = sessionStorage.getItem('meridian:scrollTo');
    sessionStorage.removeItem('meridian:scrollTo');
  } catch {
    /* ignore */
  }
  if (id) requestAnimationFrame(() => document.getElementById(id!)?.scrollIntoView({ block: 'start' }));
}

function avatar(): HTMLElement {
  const btn = h('button', { class: 'avatar', type: 'button' }) as HTMLButtonElement;
  const paint = () => {
    const name = getNickname();
    btn.textContent = name ? name.trim().charAt(0).toLocaleUpperCase(lang === 'tr' ? 'tr-TR' : 'en-GB') : '?';
    btn.title = name ? `${name} · ${t('changeName')}` : t('setName');
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => editNickname(paint));
  paint();
  return btn;
}

export function header(opts: { title?: string; back?: boolean; help?: () => void; onLang: () => void }): HTMLElement {
  const brand = h('a', { href: '#/', class: 'brand', 'aria-label': 'Meridian' });
  brand.innerHTML = `<span class="brand-mark">${LOGO}</span>`;
  brand.append(h('span', { class: 'brand-text' }, h('span', { class: 'brand-name' }, opts.back && opts.title ? opts.title : 'Meridian')));
  const p = progressSummary();
  const streakChip = h('a', { href: '#/', class: 'top-chip streak', title: t('streakTitle') }, `🔥 ${t('streakDays', { n: p.streak })}`, h('span', { class: 'chev', 'aria-hidden': 'true' }, '›'));
  streakChip.addEventListener('click', (e) => {
    e.preventDefault();
    goHomeAndScroll('records');
  });
  const refresh = () => {
    if (!streakChip.isConnected) return window.removeEventListener('meridian:progress', refresh);
    const q = progressSummary();
    streakChip.firstChild!.textContent = `🔥 ${t('streakDays', { n: q.streak })}`;
    streakChip.classList.remove('bump');
    void streakChip.offsetWidth;
    streakChip.classList.add('bump');
  };
  window.addEventListener('meridian:progress', refresh);
  const navLink = (label: string, on: () => void, active = false) =>
    h('button', { class: `nav-link${active ? ' active' : ''}`, type: 'button', onclick: on }, label);
  const nav = opts.back
    ? null
    : h(
        'nav',
        { class: 'top-nav', 'aria-label': 'Meridian' },
        navLink(t('navExplore'), () => window.scrollTo({ top: 0, behavior: 'smooth' }), true),
        navLink(t('navDaily'), () => goHomeAndScroll('games')),
        navLink(t('navRecords'), () => goHomeAndScroll('records')),
      );
  return h(
    'header',
    { class: 'top' },
    h('div', { class: 'top-left' }, opts.back ? h('a', { href: '#/', class: 'icon-btn', 'aria-label': t('back') }, '←') : null, brand, nav),
    h(
      'div',
      { class: 'top-right' },
      streakChip,
      opts.help ? h('button', { class: 'icon-btn', 'aria-label': t('howTo'), onclick: opts.help }, '?') : null,
      opts.back ? null : avatar(),
      langMenu(opts.onLang),
    ),
  );
}

function goToDay(n: number) {
  const day = Math.max(1, n);
  const q = day === todayNumber() ? '' : `?day=${day}`;
  location.href = `${location.pathname}${q}${location.hash}`;
}

// Brand colour candidates, switchable from the test bar until one is chosen. The first is the
// default in style.css; the others are `:root[data-brand=…]` overrides there.
const BRANDS: { id: string; name: string; swatch: string }[] = [
  { id: '', name: 'Turkuaz', swatch: '#0b7c88' },
  { id: 'blue', name: 'Mavi', swatch: '#2864dc' },
  { id: 'green', name: 'Yeşil', swatch: '#1f7a4d' },
  { id: 'orange', name: 'Turuncu', swatch: '#c2500f' },
];

/** Applies the brand candidate picked in test mode (no-op once TEST_MODE is off). */
export function applyTestBrand() {
  if (!TEST_MODE) return;
  const id = getPref('brand') ?? '';
  if (id && BRANDS.some((b) => b.id === id)) document.documentElement.dataset.brand = id;
  else delete document.documentElement.dataset.brand;
}

function brandPicker(): HTMLElement {
  const current = getPref('brand') ?? '';
  const el = h('div', { class: 'tb-brands', role: 'group', 'aria-label': 'Marka rengi' });
  for (const b of BRANDS) {
    const btn = h('button', { class: 'tb-swatch', type: 'button', title: b.name, 'aria-label': b.name, 'aria-pressed': String(b.id === current), style: { background: b.swatch } });
    btn.addEventListener('click', () => {
      setPref('brand', b.id);
      applyTestBrand();
      for (const o of el.children) o.setAttribute('aria-pressed', String(o === btn));
    });
    el.append(btn);
  }
  return el;
}

/** Test-mode toolbar. On a game page it can also restart the current puzzle. */
export function testBar(mode?: string): HTMLElement | null {
  if (!TEST_MODE) return null;
  const day = dayNumber();
  const btn = (label: string, title: string, on: () => void) =>
    h('button', { class: 'tb-btn', type: 'button', title, 'aria-label': title, onclick: on }, label);
  return h(
    'div',
    { class: 'testbar', role: 'toolbar', 'aria-label': t('testMode') },
    h('span', { class: 'tb-tag', title: t('testHint') }, `🧪 ${t('testMode')}`),
    mode ? null : brandPicker(),
    h(
      'div',
      { class: 'tb-controls' },
      btn('‹', t('prev'), () => goToDay(day - 1)),
      h('span', { class: 'tb-day' }, `${t('puzzle')} #${day}${day === todayNumber() ? ` · ${t('today')}` : ''}`),
      btn('›', t('nextPuzzle'), () => goToDay(day + 1)),
      btn('🎲', t('random'), () => {
        let n = day;
        while (n === day) n = 1 + Math.floor(Math.random() * 365);
        goToDay(n);
      }),
      mode
        ? btn('↺', t('replay'), () => {
            clearGame(mode, day);
            location.reload();
          })
        : null,
    ),
  );
}
