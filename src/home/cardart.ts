// Static artwork for the home cards: photo per mode (public/img, see scripts/build-images.mjs),
// a light vector overlay that hints at the mechanic, and a line icon.

export const IMG: Record<string, string> = {
  beeline: 'img/card-beeline.jpg',
  streets: 'img/card-streets.jpg',
  mental: 'img/card-mental.svg',
  headcount: 'img/card-headcount.jpg',
  hinterland: 'img/card-hinterland.jpg',
  tripoint: 'img/card-tripoint.jpg',
};

const svg = (body: string) =>
  `<svg class="mc-overlay" viewBox="0 0 800 500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${body}</svg>`;

const pin = (x: number, y: number) =>
  `<g transform="translate(${x} ${y})"><path d="M0 0c-9-12-15-19-15-27a15 15 0 0 1 30 0c0 8-6 15-15 27z" fill="#fff"/><circle cy="-27" r="6.5" fill="var(--brand-light)"/></g>`;

export const OVERLAYS: Record<string, string> = {
  beeline: svg(
    `<path d="M215 330 C 330 200, 470 190, 600 250" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" stroke-dasharray="2 12"/>${pin(215, 330)}${pin(600, 250)}`,
  ),
  streets: svg(
    `<path d="M150 410 L250 300 L320 330 L380 250 L470 230 L520 290 L610 260 L680 160" fill="none" stroke="var(--brand-dark)" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" opacity=".92"/>` +
      [[150, 410], [250, 300], [380, 250], [520, 290], [680, 160]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#fff" stroke="var(--brand-dark)" stroke-width="4"/>`).join(''),
  ),
  mental: '',
  headcount: svg(
    `<g fill="none" stroke="#ffd36a"><circle cx="300" cy="190" r="34" stroke-width="3"/><circle cx="300" cy="190" r="62" stroke-width="1.6" opacity=".6"/><circle cx="300" cy="190" r="94" stroke-width="1" opacity=".35"/><circle cx="520" cy="300" r="22" stroke-width="2.4" opacity=".8"/><circle cx="520" cy="300" r="44" stroke-width="1.2" opacity=".4"/></g><circle cx="300" cy="190" r="6" fill="#ffd36a"/>`,
  ),
  hinterland: svg(
    `<g fill="none" stroke="#fff" stroke-width="2.4"><circle cx="455" cy="372" r="18"/><path d="M455 342v14M455 388v14M425 372h14M471 372h14"/></g><g transform="translate(482 318)"><rect width="124" height="34" rx="6" fill="rgba(20,28,40,.78)" stroke="rgba(255,255,255,.55)"/><text x="62" y="23" text-anchor="middle" fill="#fff" font-family="Archivo, sans-serif" font-size="17" font-weight="600">Yeşilköy</text></g>`,
  ),
  tripoint: svg(
    `<circle cx="400" cy="250" r="170" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/><path d="M330 160 L520 205 L410 380 Z" fill="rgba(255,255,255,.08)" stroke="#fff" stroke-width="4" stroke-linejoin="round"/>` +
      [[330, 160], [520, 205], [410, 380]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="10" fill="#fff"/><circle cx="${x}" cy="${y}" r="4.5" fill="#0f6d73"/>`).join(''),
  ),
};

const icon = (d: string) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;

export const ICONS: Record<string, string> = {
  beeline: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>'),
  streets: icon('<circle cx="6" cy="18" r="2"/><path d="M18 9c-1.7-2.3-3-3.7-3-5a3 3 0 0 1 6 0c0 1.3-1.3 2.7-3 5z"/><path d="M8 18h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h2" stroke-dasharray="2 2.4"/>'),
  mental: icon('<path d="M9.5 4A2.5 2.5 0 0 0 7 6.5v.2A3 3 0 0 0 4.5 12a3 3 0 0 0 1.4 4.8A2.8 2.8 0 0 0 9.5 20H12V5.5A1.5 1.5 0 0 0 10.5 4z"/><path d="M14.5 4A2.5 2.5 0 0 1 17 6.5v.2a3 3 0 0 1 2.5 5.3 3 3 0 0 1-1.4 4.8 2.8 2.8 0 0 1-3.6 3.2H12"/><path d="M8.5 10.5c1 .3 1.8 1 2 2M15.5 10.5c-1 .3-1.8 1-2 2"/>'),
  headcount: icon('<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.5 14.2A4.5 4.5 0 0 1 21 18.5"/>'),
  hinterland: icon('<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/><path d="M10 20v-5.5h4V20"/>'),
  tripoint: icon('<path d="M12 4 20.5 19h-17z"/><circle cx="12" cy="4" r="1.6" fill="currentColor"/><circle cx="20.5" cy="19" r="1.6" fill="currentColor"/><circle cx="3.5" cy="19" r="1.6" fill="currentColor"/>'),
};
