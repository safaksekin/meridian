// Hand-drawn style card illustrations (viewBox 0 0 120 120). Strokes use currentColor
// (the card's accent); fills use --art-soft so light and dark themes both stay calm.
const A: Record<string, string> = {
  beeline: `
    <circle cx="60" cy="60" r="40" fill="var(--art-soft)" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5"/>
    <ellipse cx="60" cy="60" rx="40" ry="14" fill="none" stroke="currentColor" stroke-opacity=".18"/>
    <ellipse cx="60" cy="60" rx="16" ry="40" fill="none" stroke="currentColor" stroke-opacity=".18"/>
    <path d="M28 78 Q 56 30 96 44" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 7"/>
    <circle cx="28" cy="78" r="5" fill="currentColor"/>
    <path d="M92 37 L101 45 L89 49 Z" fill="currentColor"/>`,
  streets: `
    <defs><clipPath id="art-st"><rect x="18" y="18" width="84" height="84" rx="14"/></clipPath></defs>
    <rect x="18" y="18" width="84" height="84" rx="14" fill="var(--art-soft)"/>
    <g clip-path="url(#art-st)" stroke="currentColor" stroke-linecap="round">
      <g transform="rotate(45 60 60)" stroke-opacity=".38" stroke-width="1.6">
        <path d="M0 30H120M0 44H120M0 58H120M0 72H120M0 86H120M30 0V120M44 0V120M58 0V120M72 0V120M86 0V120"/>
      </g>
      <path d="M8 100 L112 26" stroke-width="4"/>
      <path d="M14 60 H106" stroke-width="2.6" stroke-opacity=".8"/>
    </g>`,
  mental: `
    <rect x="18" y="18" width="84" height="84" rx="14" fill="var(--art-soft)"/>
    <g fill="none" stroke="currentColor" stroke-opacity=".45" stroke-width="1.6" stroke-dasharray="3 4">
      <path d="M38 40 L48 48"/><path d="M80 36 L74 48"/><path d="M44 82 L54 74"/><path d="M84 78 L76 70"/>
    </g>
    <g fill="none" stroke="currentColor" stroke-opacity=".5" stroke-width="1.6">
      <circle cx="50" cy="50" r="5"/><circle cx="73" cy="51" r="5"/><circle cx="56" cy="72" r="5"/><circle cx="74" cy="68" r="5"/>
    </g>
    <g fill="currentColor"><circle cx="36" cy="38" r="5.5"/><circle cx="82" cy="33" r="5.5"/><circle cx="42" cy="85" r="5.5"/><circle cx="87" cy="81" r="5.5"/></g>`,
  headcount: `
    <rect x="18" y="18" width="84" height="84" rx="14" fill="var(--art-soft)"/>
    <g fill="currentColor" fill-opacity=".35">
      ${[
        [30, 32], [42, 28], [88, 30], [92, 44], [28, 90], [36, 96], [94, 88], [86, 96], [26, 60], [96, 64], [70, 30], [50, 94],
      ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2"/>`).join('')}
    </g>
    <g fill="currentColor">
      ${[
        [56, 56], [62, 52], [66, 60], [58, 64], [52, 60], [64, 68], [70, 54], [60, 70], [54, 50], [68, 64], [48, 66], [62, 60],
      ].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.6"/>`).join('')}
    </g>
    <circle cx="60" cy="60" r="26" fill="none" stroke="currentColor" stroke-width="3"/>
    <circle cx="60" cy="60" r="2" fill="currentColor"/>`,
  hinterland: `
    <rect x="18" y="18" width="84" height="84" rx="14" fill="var(--art-soft)"/>
    <g fill="currentColor" fill-opacity=".9">
      <path d="M30 64 L42 53 L54 64 V80 H30 Z"/>
      <path d="M58 70 L68 61 L78 70 V82 H58 Z" fill-opacity=".6"/>
      <path d="M80 60 L89 52 L98 60 V74 H80 Z" fill-opacity=".4"/>
    </g>
    <g fill="var(--art-soft)"><rect x="38" y="68" width="8" height="12" rx="1"/></g>
    <rect x="30" y="30" width="46" height="14" rx="7" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M38 37 H66" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="6 4"/>
    <path d="M24 86 H96" stroke="currentColor" stroke-opacity=".35" stroke-width="1.6" stroke-linecap="round"/>`,
  tripoint: `
    <defs><clipPath id="art-tp"><circle cx="60" cy="60" r="40"/></clipPath></defs>
    <g clip-path="url(#art-tp)">
      <path d="M60 60 L20 14 L100 14 L104 40 Z" fill="currentColor" fill-opacity=".14"/>
      <path d="M60 60 L104 40 L104 110 L64 110 Z" fill="currentColor" fill-opacity=".32"/>
      <path d="M60 60 L64 110 L14 110 L14 22 Z" fill="var(--art-soft)"/>
      <path d="M60 60 C 50 48 38 36 24 18 M60 60 C 74 54 88 48 104 40 M60 60 C 58 76 64 92 62 110" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
    </g>
    <circle cx="60" cy="60" r="40" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="1.5"/>
    <circle cx="60" cy="60" r="5" fill="var(--surface)" stroke="currentColor" stroke-width="2.6"/>`,
};

export function artSvg(id: string): string {
  return `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false">${A[id] ?? ''}</svg>`;
}

/** Brand mark: a globe with one highlighted meridian. */
export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false"><circle cx="16" cy="16" r="13" fill="none" stroke="currentColor" stroke-width="2"/><ellipse cx="16" cy="16" rx="5.5" ry="13" fill="none" stroke="var(--accent)" stroke-width="2.2"/><path d="M3.5 12h25M3.5 20h25" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5"/></svg>`;
