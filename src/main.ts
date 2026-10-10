import './style.css';
import { MODES } from './modes/registry';
import type { ModeModule } from './modes/types';
import { dayNumber } from './core/daily';
import { lang, t } from './core/i18n';
import { h, modal } from './core/ui';
import { getPref, setPref } from './core/storage';
import { loadCountries } from './core/countries';
import { header, testBar } from './home/chrome';
import { renderHome } from './home/home';
import { challengeBanner } from './core/challenge';

const app = document.getElementById('app')!;
let current: ModeModule | null = null;

async function route() {
  current?.unmount?.();
  current = null;
  document.documentElement.lang = lang;
  const id = location.hash.replace(/^#\/?/, '');
  const day = dayNumber();
  const def = MODES.find((m) => m.id === id);
  if (!def) {
    document.title = 'Meridian';
    app.replaceChildren(header({ onLang: route }), ...[testBar()].filter((x): x is HTMLElement => !!x), renderHome(day));
    return;
  }
  document.title = `${def.name[lang]} · Meridian`;
  const root = h('main', { class: `mode mode-${def.id}` }, h('p', { class: 'muted center' }, t('loading')));
  let mod: ModeModule | null = null;
  const showHelp = () => mod && modal(t('howTo'), mod.howTo());
  app.replaceChildren(header({ title: def.name[lang], back: true, help: showHelp, onLang: route }), ...[testBar(def.id), challengeBanner(def.id, day)].filter((x): x is HTMLElement => !!x), root);
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
