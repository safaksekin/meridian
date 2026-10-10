// Shared page chrome: header with language menu, and the test-mode toolbar.
import { h } from '../core/ui';
import { lang, setLang, t, type Lang } from '../core/i18n';
import { LOGO } from './art';
import { TEST_MODE } from '../core/config';
import { dayNumber, todayNumber } from '../core/daily';
import { clearGame, setPref } from '../core/storage';
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
  return h('label', { class: 'lang-menu' }, select, h('span', { class: 'lang-caret', 'aria-hidden': 'true' }, '▾'));
}

const line = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SUN = line('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>');
const MOON = line('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>');

/** Light / dark switch. Without a choice the site follows the device (style.css); index.html applies a saved choice before first paint. */
function themeToggle(): HTMLElement {
  const root = document.documentElement;
  const device = () => (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const now = () => root.dataset.theme ?? device();
  const btn = h('button', { class: 'icon-btn theme-btn', type: 'button' }) as HTMLButtonElement;
  const paint = () => {
    const dark = now() === 'dark';
    btn.innerHTML = dark ? SUN : MOON;
    btn.title = t(dark ? 'themeLight' : 'themeDark');
    btn.setAttribute('aria-label', btn.title);
  };
  btn.addEventListener('click', () => {
    const next = now() === 'dark' ? 'light' : 'dark';
    // Choosing what the device already uses drops the override, so the site follows the device again.
    if (next === device()) delete root.dataset.theme;
    else root.dataset.theme = next;
    setPref('theme', root.dataset.theme ?? 'auto');
    paint();
  });
  paint();
  return btn;
}

const onHome = () => location.hash.replace(/^#\/?/, '') === '';
const scrollMode = (): ScrollBehavior => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth');

function goHomeAndScroll(id: string) {
  if (onHome()) {
    document.getElementById(id)?.scrollIntoView({ behavior: scrollMode(), block: 'start' });
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

/** Home sections in the header. The underline slides to the clicked link and follows the scroll position. */
function topNav(): HTMLElement {
  const items = [
    { label: t('navExplore'), id: '' },
    { label: t('navDaily'), id: 'games' },
    { label: t('navRecords'), id: 'records' },
  ];
  const ink = h('span', { class: 'nav-ink', 'aria-hidden': 'true' });
  let active = 0;
  let clickScroll = false; // a click is scrolling the page: the underline stays on the clicked link
  let settle = 0;
  const place = () => {
    const el = links[active];
    ink.style.width = `${el.offsetWidth}px`;
    ink.style.transform = `translateX(${el.offsetLeft}px)`;
  };
  const setActive = (i: number) => {
    active = i;
    links.forEach((l, j) => l.classList.toggle('active', j === i));
    place();
  };
  const settleSoon = () => {
    clearTimeout(settle);
    settle = window.setTimeout(() => (clickScroll = false), 160);
  };
  const links: HTMLElement[] = items.map((it, i) =>
    h(
      'button',
      {
        class: 'nav-link',
        type: 'button',
        onclick: () => {
          clickScroll = true;
          settleSoon();
          setActive(i);
          if (it.id) goHomeAndScroll(it.id);
          else window.scrollTo({ top: 0, behavior: scrollMode() });
        },
      },
      it.label,
    ),
  );
  const nav = h('nav', { class: 'top-nav', 'aria-label': 'Meridian' }, ...links, ink);
  const onScroll = () => {
    if (!nav.isConnected) return window.removeEventListener('scroll', onScroll);
    if (clickScroll) return settleSoon();
    let i = 0;
    items.forEach((it, j) => {
      const el = it.id ? document.getElementById(it.id) : null;
      if (el && el.getBoundingClientRect().top <= innerHeight * 0.4) i = j;
    });
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2 && scrollY > 0) i = items.length - 1;
    if (i !== active) setActive(i);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  // Sizes are known once the nav is in the page (and change when the web font arrives).
  new ResizeObserver(() => {
    place();
    requestAnimationFrame(() => nav.classList.add('ready'));
  }).observe(nav);
  setActive(0);
  return nav;
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
  brand.addEventListener('click', (e) => {
    if (!onHome()) return;
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: scrollMode() });
  });
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
  const nav = opts.back ? null : topNav();
  return h(
    'header',
    { class: `top${opts.back ? ' in-game' : ''}` },
    h('div', { class: 'top-left' }, opts.back ? h('a', { href: '#/', class: 'icon-btn', 'aria-label': t('back') }, '←') : null, brand, nav),
    h(
      'div',
      { class: 'top-right' },
      streakChip,
      opts.help ? h('button', { class: 'icon-btn', 'aria-label': t('howTo'), onclick: opts.help }, '?') : null,
      opts.back ? null : avatar(),
      themeToggle(),
      langMenu(opts.onLang),
    ),
  );
}

function goToDay(n: number) {
  const day = Math.max(1, n);
  const q = day === todayNumber() ? '' : `?day=${day}`;
  location.href = `${location.pathname}${q}${location.hash}`;
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
