import './home.css';
import { MODES } from '../modes/registry';
import { h } from '../core/ui';
import { lang, t } from '../core/i18n';
import { getStats } from '../core/storage';
import { msUntilTomorrow } from '../core/daily';
import { artSvg, LOGO } from './art';

function countdown(): HTMLElement {
  const el = h('strong', { class: 'hero-count' });
  const tick = () => {
    const ms = msUntilTomorrow();
    el.textContent = `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0')}`;
    if (el.isConnected) setTimeout(tick, 30000);
  };
  setTimeout(tick, 0);
  tick();
  return el;
}

export function renderHome(day: number): HTMLElement {
  let played = 0;
  const cards = MODES.map((m) => {
    const res = getStats(m.id).history[day];
    if (res) played++;
    const art = h('div', { class: 'mcard-art' });
    art.innerHTML = artSvg(m.id);
    return h(
      'a',
      { href: `#/${m.id}`, class: `mcard m-${m.id}${res ? (res.won ? ' is-won' : ' is-lost') : ''}`, 'aria-label': `${m.name[lang]}. ${m.blurb[lang]}` },
      art,
      h('span', { class: 'mcard-name' }, m.name[lang]),
      h('span', { class: 'mcard-blurb' }, m.blurb[lang]),
      res ? h('span', { class: 'mcard-status' }, `${res.won ? '✓' : '✗'} ${res.label}`) : null,
    );
  });
  const mark = h('span', { class: 'hero-mark' });
  mark.innerHTML = LOGO;
  return h(
    'main',
    { class: 'home' },
    h(
      'section',
      { class: 'hero' },
      mark,
      h('h1', {}, 'Meridian'),
      h('p', { class: 'hero-tag' }, t('tagline')),
      h(
        'ul',
        { class: 'hero-meta' },
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '📅'), `${t('day')} ${day}`),
        h('li', {}, h('span', { 'aria-hidden': 'true' }, '✅'), t('todayProgress', { n: played })),
        h('li', { title: t('newIn') }, h('span', { 'aria-hidden': 'true' }, '⏳'), countdown()),
      ),
    ),
    h('nav', { class: 'mgrid', 'aria-label': t('tagline') }, ...cards),
    h(
      'footer',
      { class: 'foot' },
      `${t('attribution')}: Natural Earth, GeoNames (CC BY 4.0), © OpenStreetMap contributors (ODbL), GHSL (CC BY 4.0), Wikidata (CC0).`,
    ),
  );
}
