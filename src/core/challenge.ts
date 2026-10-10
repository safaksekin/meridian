// Friend challenges: asynchronous duels carried entirely in a share link (no server).
// The link is `${origin}${pathname}?day=<day>&ch=<token>#/<mode>`, where token is the base64url
// of {v:1, m:mode, d:day, n:nickname, l:label, w:won}. The friend plays the same puzzle and sees
// the comparison in the result panel. Nothing in the token reveals the answer.
import './competition.css';
import { lang, makeT, type Lang } from './i18n';
import { todayNumber } from './daily';
import { getPref, getStats, setPref } from './storage';
import { copyShare, h, modal, toast } from './ui';
import { MODES } from '../modes/registry';
import { MODE_IDS, levelFor, levelStartXp, levelTitle, parseLabel, progressSummary, xpFor } from './progress';

const t = makeT({
  en: {
    chButton: '⚔️ Challenge a friend',
    chBack: '⚔️ Challenge {name} back',
    chAs: 'as {name}',
    chEdit: 'change name',
    chNickTitle: 'Explorer name',
    chNickHint: 'Your friends see this name on your challenges. Up to 20 letters, digits, spaces, _ - .',
    chNickPlaceholder: 'e.g. Magellan',
    chNickSave: 'Save',
    chNickEmpty: 'Pick a name first',
    chShare: '⚔️ {name} challenges you on Meridian {mode} #{day}: {label}. Can you beat it?',
    chLinkCopied: 'Challenge link copied',
    chBanner: '{name} scored {label} on this puzzle. Can you beat it?',
    chBannerLost: '{name} did not crack this puzzle ({label}). Can you?',
    chBannerSub: 'Finish the puzzle to see who wins.',
    chYou: 'You',
    chYouWin: 'You win 🏆',
    chDraw: 'Draw 🤝',
    chTheyWin: '{name} wins',
    chHeading: 'Challenge',
    xpGain: '+{xp} XP',
    xpLevel: 'Level {n} · {title}',
    xpLevelUp: 'Level up!',
    xpToNext: '{n} XP to level {next}',
    xpStreak: '🔥 {n}-day streak',
    xpPractice: 'Practice round · no XP',
  },
  tr: {
    chButton: '⚔️ Arkadaşına meydan oku',
    chBack: '⚔️ {name} rövanşı',
    chAs: '{name} olarak',
    chEdit: 'adı değiştir',
    chNickTitle: 'Kaşif adın',
    chNickHint: 'Arkadaşların meydan okumalarında bu adı görür. En fazla 20 harf, rakam, boşluk, _ - .',
    chNickPlaceholder: 'örn. Piri Reis',
    chNickSave: 'Kaydet',
    chNickEmpty: 'Önce bir ad seç',
    chShare: '⚔️ {name} sana Meridian {mode} #{day} için meydan okuyor: {label}. Geçebilir misin?',
    chLinkCopied: 'Meydan okuma bağlantısı kopyalandı',
    chBanner: '{name} bu bulmacada {label} yaptı. Geçebilir misin?',
    chBannerLost: '{name} bu bulmacayı çözemedi ({label}). Sen çözebilir misin?',
    chBannerSub: 'Kimin kazandığını görmek için bulmacayı bitir.',
    chYou: 'Sen',
    chYouWin: 'Kazandın 🏆',
    chDraw: 'Berabere 🤝',
    chTheyWin: '{name} kazandı',
    chHeading: 'Meydan okuma',
    xpGain: '+{xp} XP',
    xpLevel: 'Seviye {n} · {title}',
    xpLevelUp: 'Seviye atladın!',
    xpToNext: 'Seviye {next} için {n} XP',
    xpStreak: '🔥 {n} günlük seri',
    xpPractice: 'Antrenman turu · XP yok',
  },
});

export interface Challenge {
  v: 1;
  /** Mode id. */
  m: string;
  /** Puzzle day number. */
  d: number;
  /** Challenger nickname (sanitized). */
  n: string;
  /** Challenger result label, e.g. "3/6", "X/6", "74/100", "98". */
  l: string;
  /** Whether the challenger won. */
  w: boolean;
}

const NICK_PREF = 'nick';
const NICK_MAX = 20;

/** Keep letters, digits, space, _ - . ; collapse spaces; max 20 characters. */
export function sanitizeName(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const kept = raw.normalize('NFC').replace(/[^\p{L}\p{M}\p{N} _.\-]/gu, '').replace(/\s+/g, ' ').trim();
  return [...kept].slice(0, NICK_MAX).join('').trim();
}

export function getNickname(): string {
  return sanitizeName(getPref(NICK_PREF) ?? '');
}

export function setNickname(name: string): void {
  setPref(NICK_PREF, sanitizeName(name));
}

function toBase64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeChallenge(c: Omit<Challenge, 'v'>): string {
  const body: Challenge = { v: 1, m: c.m, d: c.d, n: sanitizeName(c.n), l: c.l, w: !!c.w };
  return toBase64Url(JSON.stringify(body));
}

/** Decode and validate a token. Anything malformed, oversized or unknown yields null. */
export function decodeChallenge(token: unknown): Challenge | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 400 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  let o: unknown;
  try {
    o = JSON.parse(fromBase64Url(token));
  } catch {
    return null;
  }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const r = o as Record<string, unknown>;
  if (r.v !== 1) return null;
  if (typeof r.m !== 'string' || !(MODE_IDS as readonly string[]).includes(r.m)) return null;
  if (typeof r.d !== 'number' || !Number.isInteger(r.d) || r.d < 1 || r.d > 100000) return null;
  if (typeof r.w !== 'boolean' || typeof r.l !== 'string' || !parseLabel(r.m, r.l)) return null;
  const n = sanitizeName(r.n);
  if (!n) return null;
  return { v: 1, m: r.m, d: r.d, n, l: r.l.trim(), w: r.w };
}

export function challengeUrl(c: Omit<Challenge, 'v'>, base = `${location.origin}${location.pathname}`): string {
  return `${base}?day=${c.d}&ch=${encodeChallenge(c)}#/${c.m}`;
}

/** The challenge carried by the current URL, if it is for this mode and day. */
export function activeChallenge(mode: string, day: number): Challenge | null {
  let token: string | null = null;
  try {
    token = new URLSearchParams(location.search).get('ch');
  } catch {
    return null;
  }
  const c = decodeChallenge(token);
  return c && c.m === mode && c.d === day ? c : null;
}

/**
 * Compare two result labels of the same mode: 1 if `a` is better, -1 if `b` is better, 0 for a draw.
 * Guess modes: a solve beats a miss, fewer guesses beat more, two misses draw.
 * Score modes: higher score wins. A malformed label always loses to a valid one.
 */
export function compareLabels(mode: string, a: string, b: string): -1 | 0 | 1 {
  const pa = parseLabel(mode, a);
  const pb = parseLabel(mode, b);
  if (!pa || !pb) return pa ? 1 : pb ? -1 : 0;
  if (pa.kind === 'score') return pa.value > pb.value ? 1 : pa.value < pb.value ? -1 : 0;
  if (pa.solved !== pb.solved) return pa.solved ? 1 : -1;
  if (!pa.solved) return 0;
  return pa.value < pb.value ? 1 : pa.value > pb.value ? -1 : 0;
}

function modeName(id: string, l: Lang = lang): string {
  return MODES.find((m) => m.id === id)?.name[l] ?? id;
}

/**
 * Banner for the top of a mode page when the URL carries a challenge for this mode and day.
 * Shows only the challenger's name and result label, never the answer. Returns null otherwise.
 */
export function challengeBanner(mode: string, day: number): HTMLElement | null {
  const c = activeChallenge(mode, day);
  if (!c) return null;
  const solved = parseLabel(c.m, c.l)?.solved !== false;
  return h(
    'aside',
    { class: 'cmp-banner', role: 'note' },
    h('span', { class: 'cmp-banner-icon', 'aria-hidden': 'true' }, '⚔️'),
    h(
      'div',
      { class: 'cmp-banner-text' },
      h('strong', {}, t(solved ? 'chBanner' : 'chBannerLost', { name: c.n, label: c.l })),
      h('span', {}, t('chBannerSub')),
    ),
  );
}

/** Ask for (or edit) the explorer name. Calls onSaved with the sanitized name after a save. */
export function editNickname(onSaved?: (name: string) => void): void {
  const input = h('input', {
    type: 'text',
    class: 'ac-input cmp-nick-input',
    maxlength: String(NICK_MAX * 2),
    placeholder: t('chNickPlaceholder'),
    autocomplete: 'nickname',
    spellcheck: 'false',
    'aria-label': t('chNickTitle'),
  });
  input.value = getNickname();
  const form = h(
    'form',
    { class: 'cmp-nick' },
    h('p', { class: 'muted' }, t('chNickHint')),
    h('div', { class: 'cmp-nick-row' }, input, h('button', { class: 'btn primary', type: 'submit' }, t('chNickSave'))),
  );
  let close: () => void = () => {};
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = sanitizeName(input.value);
    if (!name) {
      toast(t('chNickEmpty'));
      input.focus();
      return;
    }
    setNickname(name);
    close();
    onSaved?.(name);
  });
  close = modal(t('chNickTitle'), form);
  setTimeout(() => input.focus(), 0);
}

function shareChallenge(mode: string, day: number, label: string, won: boolean, name: string): void {
  const url = challengeUrl({ m: mode, d: day, n: name, l: label, w: won });
  const text = `${t('chShare', { name, mode: modeName(mode), day, label })}\n${url}`;
  void copyShare(text, t('chLinkCopied'));
}

function xpLine(mode: string, day: number, won: boolean, label: string | undefined): HTMLElement | null {
  if (day !== todayNumber()) return h('p', { class: 'cmp-xp practice' }, t('xpPractice'));
  const entry = getStats(mode).history[day];
  const res = entry ?? (label ? { won, label } : null);
  if (!res) return null;
  const gain = xpFor(mode, res.won, res.label);
  const s = progressSummary();
  const total = entry ? s.xp : s.xp + gain; // entry missing: the result was not recorded (yet)
  const level = levelFor(total);
  const levelUp = levelFor(total - gain) < level;
  const start = levelStartXp(level);
  const next = levelStartXp(level + 1);
  const pct = Math.max(0, Math.min(100, (100 * (total - start)) / Math.max(1, next - start)));
  return h(
    'div',
    { class: `cmp-xp${levelUp ? ' level-up' : ''}` },
    h(
      'p',
      { class: 'cmp-xp-line' },
      h('strong', { class: 'cmp-xp-gain' }, t('xpGain', { xp: gain })),
      ' · ',
      h('span', {}, t('xpLevel', { n: level, title: levelTitle(level) })),
      levelUp ? h('span', { class: 'cmp-xp-up' }, ` · ${t('xpLevelUp')}`) : null,
    ),
    h('div', { class: 'cmp-xp-bar', role: 'presentation' }, h('span', { style: { width: `${pct}%` } })),
    h(
      'p',
      { class: 'cmp-xp-sub' },
      t('xpToNext', { n: next - total, next: level + 1 }),
      s.streak > 0 ? h('span', { class: 'cmp-streak' }, t('xpStreak', { n: s.streak })) : null,
    ),
  );
}

function comparison(mode: string, c: Challenge, label: string): HTMLElement {
  const r = compareLabels(mode, label, c.l);
  const verdict = r > 0 ? t('chYouWin') : r < 0 ? t('chTheyWin', { name: c.n }) : t('chDraw');
  const cls = r > 0 ? 'win' : r < 0 ? 'loss' : 'draw';
  return h(
    'div',
    { class: `cmp-vs ${cls}`, role: 'status' },
    h('span', { class: 'cmp-vs-tag' }, `⚔️ ${t('chHeading')}`),
    h(
      'p',
      { class: 'cmp-vs-line' },
      h('span', { class: 'cmp-vs-side' }, `${t('chYou')} `, h('b', {}, label)),
      h('span', { class: 'cmp-vs-sep', 'aria-hidden': 'true' }, ' · '),
      h('span', { class: 'cmp-vs-side' }, `${c.n} `, h('b', {}, c.l)),
    ),
    h('p', { class: 'cmp-vs-verdict' }, `→ ${verdict}`),
  );
}

/** "You 2/6 · Ana 3/6 → You win 🏆" when the URL carries a challenge for this puzzle, else null. */
export function challengeComparison(opts: { mode: string; day: number; label?: string }): HTMLElement | null {
  const ch = activeChallenge(opts.mode, opts.day);
  const label = ownLabel(opts.mode, opts.day, opts.label);
  return ch && label ? comparison(opts.mode, ch, label) : null;
}

function ownLabel(mode: string, day: number, label?: string): string | null {
  const l = label ?? getStats(mode).history[day]?.label;
  return l && parseLabel(mode, l) ? l : null;
}

/**
 * Competition extras for the end-of-game panel: the "Challenge a friend" button (with the
 * explorer name and a way to change it) and the XP / level line.
 * `label` is the player's own result label for this game; without one only the XP line shows.
 */
export function competitionBlock(opts: { mode: string; day: number; won: boolean; label?: string }): HTMLElement {
  const { mode, day, won } = opts;
  const label = ownLabel(mode, day, opts.label);
  const wrap = h('div', { class: 'cmp' });
  if (label) {
    const ch = activeChallenge(mode, day);
    const who = h('span', { class: 'cmp-who' });
    const renderWho = () => {
      const nick = getNickname();
      who.replaceChildren();
      if (!nick) return;
      who.append(
        t('chAs', { name: nick }),
        ' · ',
        h('button', { type: 'button', class: 'cmp-link', onclick: () => editNickname(() => renderWho()) }, t('chEdit')),
      );
    };
    renderWho();
    const go = () => {
      const nick = getNickname();
      if (nick) shareChallenge(mode, day, label, won, nick);
      else
        editNickname((name) => {
          renderWho();
          shareChallenge(mode, day, label, won, name);
        });
    };
    wrap.append(
      h('button', { type: 'button', class: 'btn wide cmp-btn', onclick: go }, ch ? t('chBack', { name: ch.n }) : t('chButton')),
      who,
    );
  }
  const xp = xpLine(mode, day, won, label ?? undefined);
  if (xp) wrap.append(xp);
  return wrap;
}
