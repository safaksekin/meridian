import './style.css';
import { MODES } from './modes/registry';
import type { ModeModule } from './modes/types';
import { dayNumber } from './core/daily';
import { lang, setLang, t } from './core/i18n';
import { h, modal } from './core/ui';
import { getPref, getStats, setPref } from './core/storage';
import { loadCountries } from './core/countries';

const app = document.getElementById('app')!;
let current: ModeModule | null = null;

function header(title: string, opts: { back?: boolean; help?: () => void } = {}) {
  return h(
    'header',
    { class: 'top' },
    h(
      'div',
      { class: 'top-left' },
      opts.back ? h('a', { href: '#/', class: 'icon-btn', 'aria-label': t('back') }, '←') : null,
      h('a', { href: '#/', class: 'brand' }, opts.back ? title : 'Meridian'),
    ),
    h(
      'div',
      { class: 'top-right' },
      opts.help ? h('button', { class: 'icon-btn', 'aria-label': t('howTo'), onclick: opts.help }, '?') : null,
      h(
        'button',
        {
          class: 'lang-btn',
          'aria-label': lang === 'tr' ? 'Switch to English' : 'Türkçeye geç',
          onclick: () => {
            setLang(lang === 'tr' ? 'en' : 'tr');
            route();
          },
        },
        lang === 'tr' ? 'EN' : 'TR',
      ),
    ),
  );
}

function home(day: number) {
  const cards = MODES.map((m) => {
    const res = getStats(m.id).history[day];
    return h(
      'a',
      { href: `#/${m.id}`, class: `card ${res ? (res.won ? 'is-won' : 'is-lost') : ''}` },
      h('span', { class: 'card-icon', 'aria-hidden': 'true' }, m.icon),
      h('span', { class: 'card-text' }, h('strong', {}, m.name[lang]), h('span', {}, m.blurb[lang])),
      h('span', { class: 'card-status' }, res ? res.label : t('play')),
    );
  });
  app.replaceChildren(
    header('Meridian'),
    h(
      'main',
      { class: 'home' },
      h('div', { class: 'hero' }, h('h1', {}, 'Meridian'), h('p', {}, `${t('tagline')} · ${t('day')} ${day}`)),
      h('nav', { class: 'cards' }, ...cards),
      h(
        'footer',
        { class: 'foot' },
        `${t('attribution')}: Natural Earth, GeoNames (CC BY 4.0), © OpenStreetMap contributors (ODbL), WorldPop / GHSL.`,
      ),
    ),
  );
}

async function route() {
  current?.unmount?.();
  current = null;
  document.documentElement.lang = lang;
  const id = location.hash.replace(/^#\/?/, '');
  const day = dayNumber();
  const def = MODES.find((m) => m.id === id);
  if (!def) {
    document.title = 'Meridian';
    home(day);
    return;
  }
  document.title = `${def.name[lang]} · Meridian`;
  const root = h('main', { class: `mode mode-${def.id}` }, h('p', { class: 'muted center' }, t('loading')));
  let mod: ModeModule | null = null;
  const showHelp = () => mod && modal(t('howTo'), mod.howTo());
  app.replaceChildren(header(def.name[lang], { back: true, help: showHelp }), root);
  window.scrollTo(0, 0);
  try {
    await loadCountries();
    mod = (await def.load()).default;
    if (location.hash.replace(/^#\/?/, '') !== id) return; // user navigated away while loading
    current = mod;
    root.replaceChildren(h('p', { class: 'day-label' }, `${def.icon} ${def.name[lang]} #${day}`));
    await mod.mount({ day, root });
    if (!getPref(`seen:${def.id}`)) {
      setPref(`seen:${def.id}`, '1');
      showHelp();
    }
  } catch (err) {
    console.error(err);
    root.replaceChildren(h('p', { class: 'error' }, t('loadError')));
  }
}

window.addEventListener('hashchange', route);
route();
