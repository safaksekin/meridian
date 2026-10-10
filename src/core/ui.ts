import { fold, t } from './i18n';
import { dayNumber, msUntilTomorrow } from './daily';
import { getStats } from './storage';
import { challengeComparison, competitionBlock } from './challenge';

type Child = Node | string | null | undefined | false;

/** Tiny hyperscript helper. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c != null && c !== false) el.append(c);
  return el;
}

export function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

let toastTimer = 0;
export function toast(msg: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el!.classList.remove('show'), 1800);
}

export interface AutoItem {
  id: string;
  label: string;
  sub?: string;
  keys: string[];
}

/**
 * Text input with a dropdown of matching items. Calls onPick with the chosen item.
 * Only items from the list can be submitted, so typos never cost a guess.
 */
export function autocomplete(opts: {
  items: () => AutoItem[];
  placeholder: string;
  onPick: (item: AutoItem) => void;
  buttonLabel?: string;
  /** No built-in button: the host supplies its own controls. Enter still picks. */
  bare?: boolean;
  /** Enter pressed on an empty input (e.g. to submit a finished row). */
  onEmptySubmit?: () => void;
}): { el: HTMLElement; focus: () => void; setDisabled: (d: boolean) => void; setPlaceholder: (text: string) => void } {
  const input = h('input', {
    type: 'text',
    class: 'ac-input',
    placeholder: opts.placeholder,
    autocomplete: 'off',
    autocapitalize: 'off',
    spellcheck: 'false',
    'aria-autocomplete': 'list',
  });
  const listEl = h('ul', { class: 'ac-list', role: 'listbox' });
  const btn = h('button', { class: 'btn primary', type: 'submit' }, opts.buttonLabel ?? t('guess'));
  let matches: AutoItem[] = [];
  let active = 0;

  function search(q: string): AutoItem[] {
    const f = fold(q);
    if (!f) return [];
    const starts: AutoItem[] = [];
    const contains: AutoItem[] = [];
    for (const it of opts.items()) {
      if (it.keys.some((k) => k.startsWith(f) || k.split(' ').some((w) => w.startsWith(f)))) starts.push(it);
      else if (it.keys.some((k) => k.includes(f))) contains.push(it);
    }
    return [...starts, ...contains].slice(0, 8);
  }

  function render() {
    listEl.replaceChildren(
      ...matches.map((m, i) =>
        h(
          'li',
          {
            role: 'option',
            class: i === active ? 'active' : '',
            onmousedown: (e: Event) => {
              e.preventDefault();
              pick(m);
            },
          },
          m.label,
          m.sub ? h('span', { class: 'ac-sub' }, m.sub) : null,
        ),
      ),
    );
    listEl.hidden = matches.length === 0;
  }

  function pick(m: AutoItem) {
    input.value = '';
    matches = [];
    render();
    opts.onPick(m);
  }

  input.addEventListener('input', () => {
    matches = search(input.value);
    active = 0;
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, matches.length - 1);
      render();
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0);
      render();
      e.preventDefault();
    } else if (e.key === 'Escape') {
      matches = [];
      render();
    }
  });
  input.addEventListener('blur', () => setTimeout(() => { matches = []; render(); }, 100));

  const form = h('form', { class: 'ac' }, h('div', { class: 'ac-wrap' }, input, listEl), opts.bare ? null : btn);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (matches.length === 0) matches = search(input.value);
    const exact = matches.find((m) => m.keys.includes(fold(input.value)));
    const choice = exact ?? (matches.length === 1 ? matches[0] : matches[active]);
    if (choice && input.value.trim()) pick(choice);
    else if (!input.value.trim() && opts.onEmptySubmit) opts.onEmptySubmit();
    else toast(input.value.trim() ? t('unknown') : t('typeCountry'));
  });
  listEl.hidden = true;
  return {
    el: form,
    focus: () => input.focus(),
    setDisabled: (d) => {
      input.disabled = d;
      btn.disabled = d;
    },
    setPlaceholder: (text) => {
      input.placeholder = text;
    },
  };
}

/**
 * Single-screen rule: keeps `until` (the last control the player needs) on the first screen by
 * capping the size of a square visual (map, canvas) above it. Sets `--fit` on the visual; its CSS
 * uses that as a max-width. `under` is something directly below the visual that must stay visible
 * too, even when the controls sit beside it. Re-fits when the window or the page content changes,
 * and stops by itself once the visual leaves the page.
 */
export function keepOnScreen(visual: HTMLElement | SVGElement, until: () => Element | null, opts: { under?: Element; minSize?: number } = {}): void {
  let frame = 0;
  const fit = () => {
    if (!visual.isConnected) return stop();
    const box = visual.getBoundingClientRect();
    const ctl = until()?.getBoundingClientRect();
    if (!ctl || !ctl.height || !box.height) return visual.style.removeProperty('--fit');
    // Controls stacked under the visual eat into its height; controls beside it (wide layout) do not.
    const stacked = ctl.left < box.right - 1 && ctl.right > box.left + 1;
    const under = opts.under?.getBoundingClientRect();
    const below = Math.max(0, stacked ? ctl.bottom - box.bottom : 0, under?.height ? under.bottom - box.bottom : 0);
    const room = window.innerHeight - (box.top + window.scrollY) - below - 12;
    const next = `${Math.max(opts.minSize ?? 200, Math.floor(room))}px`;
    if (visual.style.getPropertyValue('--fit') !== next) visual.style.setProperty('--fit', next);
  };
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(fit);
  };
  const observer = new ResizeObserver(schedule);
  const stop = () => {
    observer.disconnect();
    window.removeEventListener('resize', schedule);
  };
  observer.observe(visual.closest('main') ?? document.body);
  window.addEventListener('resize', schedule);
  fit();
}

export function modal(title: string, body: Node, onClose?: () => void): () => void {
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  const overlay = h(
    'div',
    { class: 'overlay', onclick: (e: Event) => e.target === overlay && close() },
    h(
      'div',
      { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', {}, title), h('button', { class: 'icon-btn', 'aria-label': t('close'), onclick: close }, '✕')),
      body,
    ),
  );
  document.addEventListener('keydown', onKey);
  document.body.append(overlay);
  return close;
}

/** Share via the native sheet on touch devices, otherwise copy to the clipboard (toast `copiedMsg`). */
export async function copyShare(text: string, copiedMsg = t('copied')) {
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text });
      return;
    }
  } catch {
    /* fall back to clipboard */
  }
  try {
    await navigator.clipboard.writeText(text);
    toast(copiedMsg);
  } catch {
    prompt('', text);
  }
}

function countdown(): HTMLElement {
  const el = h('span', { class: 'countdown' });
  const tick = () => {
    const ms = msUntilTomorrow();
    const hh = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const mm = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const ss = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    el.textContent = `${hh}:${mm}:${ss}`;
    if (el.isConnected) setTimeout(tick, 1000);
  };
  setTimeout(tick, 0);
  tick();
  return el;
}

export function statsBlock(mode: string, buckets: string[]): HTMLElement {
  const s = getStats(mode);
  const max = Math.max(1, ...buckets.map((b) => s.dist[b] || 0));
  return h(
    'div',
    { class: 'stats' },
    h(
      'div',
      { class: 'stat-row' },
      ...[
        [s.played, t('played')],
        [s.played ? Math.round((100 * s.wins) / s.played) : 0, t('winPct')],
        [s.streak, t('streak')],
        [s.maxStreak, t('maxStreak')],
      ].map(([n, l]) => h('div', { class: 'stat' }, h('strong', {}, String(n)), h('span', {}, String(l)))),
    ),
    h(
      'div',
      { class: 'dist' },
      ...buckets.map((b) =>
        h(
          'div',
          { class: 'dist-row' },
          h('span', {}, b),
          h('div', { class: 'dist-bar', style: { width: `${Math.max(6, (100 * (s.dist[b] || 0)) / max)}%` } }, String(s.dist[b] || 0)),
        ),
      ),
    ),
  );
}

/** Modes write share links against a placeholder host; swap in wherever the site is actually served. */
function liveShareText(text: string): string {
  const base = `${location.origin}${location.pathname}`;
  return text.split('https://meridian.example/').join(base);
}

/**
 * End-of-game panel: headline, challenge comparison, mode-specific detail, share button,
 * challenge-a-friend button, XP line, stats, countdown. `label` is the result label passed to
 * recordResult (e.g. "3/6", "X/6", "74/100", "98"); it powers friend challenges.
 */
export function resultPanel(opts: { won: boolean; headline: string; detail?: Node; share: string; mode: string; buckets: string[]; label?: string }): HTMLElement {
  const share = liveShareText(opts.share);
  const day = dayNumber();
  return h(
    'section',
    { class: `result ${opts.won ? 'won' : 'lost'}` },
    h('h2', {}, opts.headline),
    challengeComparison({ mode: opts.mode, day, label: opts.label }),
    opts.detail ?? null,
    h('pre', { class: 'share-preview' }, share),
    h('button', { class: 'btn primary wide', onclick: () => copyShare(share) }, t('share')),
    competitionBlock({ mode: opts.mode, day, won: opts.won, label: opts.label }),
    statsBlock(opts.mode, opts.buckets),
    h('p', { class: 'next' }, `${t('next')}: `, countdown()),
  );
}
