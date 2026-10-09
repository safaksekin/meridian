// Pan/zoom world map for Headcount. The world is projected once (equirectangular, 4 units per degree,
// so the 0.25° population grid maps 1:1 onto it); panning and zooming only change one SVG transform.
import { geoCircle, geoEquirectangular, geoPath } from 'd3-geo';
import { drawWorld, loadWorld } from '../../core/map';
import { h, svgEl } from '../../core/ui';
import { R_EARTH, type Grid } from './pop.js';
import { t } from './strings';

const BW = 1440; // base width: 360° * 4
const Y_TOP = (90 - 84) * 4; // visible latitude range 84°N … 58°S
const Y_BOT = (90 + 58) * 4;
const MAX_K_FACTOR = 48;
const TAP_SLOP = 7;

export interface CircleStyle {
  cls: string;
  label?: string;
}

export interface MapEvents {
  /** Mouse hover (no buttons down). */
  onHover?(lon: number, lat: number): void;
  onLeave?(): void;
  /** Tap or click that was not a drag. */
  onTap?(lon: number, lat: number, pointerType: string): void;
}

export class HeadcountMap {
  readonly el: HTMLElement;
  private svg: SVGSVGElement;
  private root: SVGGElement;
  private density: SVGGElement;
  private circles: SVGGElement;
  private preview: SVGGElement;
  private labels: SVGGElement;
  private labelData: { lon: number; lat: number; text: string; cls: string }[] = [];
  private projection = geoEquirectangular().scale(BW / (2 * Math.PI)).translate([BW / 2, 360]);
  private path = geoPath(this.projection);
  private w = 300;
  private hgt = 200;
  private k = 1;
  private tx = 0;
  private ty = 0;
  private minK = 1;
  private fitted = false;
  private ro: ResizeObserver;
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture:
    | { kind: 'drag'; x0: number; y0: number; tx0: number; ty0: number; moved: boolean; type: string }
    | { kind: 'pinch'; d0: number; k0: number; bx: number; by: number }
    | null = null;
  private raf = 0;

  constructor(private events: MapEvents) {
    this.svg = svgEl('svg', { class: 'hc-svg', role: 'img' });
    this.root = svgEl('g');
    this.density = svgEl('g', { class: 'hc-density' });
    this.circles = svgEl('g');
    this.preview = svgEl('g');
    this.labels = svgEl('g', { class: 'hc-labels' });
    const zoomBtn = (txt: string, label: string, fn: () => void) =>
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick: fn }, txt);
    this.el = h(
      'div',
      { class: 'mapbox hc-map' },
      this.svg,
      h(
        'div',
        { class: 'hc-zoom' },
        zoomBtn('+', t('zoomIn'), () => this.zoomBy(2)),
        zoomBtn('−', t('zoomOut'), () => this.zoomBy(0.5)),
        zoomBtn('⤢', t('reset'), () => this.fit()),
      ),
    );
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.el);
    this.bind();
  }

  async init(): Promise<void> {
    const world = await loadWorld();
    const { layer } = drawWorld(this.svg, this.projection, world);
    const base = [...this.svg.childNodes];
    this.root.append(...base);
    layer.remove();
    this.root.append(this.density, this.circles, this.preview);
    this.svg.append(this.root, this.labels);
    this.resize();
  }

  destroy(): void {
    this.ro.disconnect();
    cancelAnimationFrame(this.raf);
  }

  // ---------------------------------------------------------------- view
  private resize() {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.w = r.width;
    this.hgt = r.height;
    this.svg.setAttribute('viewBox', `0 0 ${this.w} ${this.hgt}`);
    this.minK = Math.min(this.w / BW, this.hgt / (Y_BOT - Y_TOP));
    if (!this.fitted) this.home();
    else this.apply(this.k, this.tx, this.ty);
  }

  /** Initial view: the whole world, or on tall/narrow boxes a closer view of the populated mid-latitudes. */
  home(): void {
    const rel = (0.85 * this.hgt) / (Y_BOT - Y_TOP) / this.minK;
    if (rel > 1.25) {
      this.fitted = true;
      this.focus(25, 20, rel);
    } else this.fit();
  }

  fit(): void {
    this.fitted = true;
    this.apply(this.minK, 0, 0);
  }

  /** Centre the view on a point at the given zoom (relative to the whole-world zoom). */
  focus(lon: number, lat: number, rel: number): void {
    const [bx, by] = this.projection([lon, lat])!;
    const k = this.minK * rel;
    this.apply(k, this.w / 2 - bx * k, this.hgt / 2 - by * k);
  }

  private zoomBy(f: number, sx = this.w / 2, sy = this.hgt / 2) {
    const k = this.clampK(this.k * f);
    const bx = (sx - this.tx) / this.k;
    const by = (sy - this.ty) / this.k;
    this.apply(k, sx - bx * k, sy - by * k);
  }

  private clampK(k: number) {
    return Math.min(this.minK * MAX_K_FACTOR, Math.max(this.minK, k));
  }

  private apply(k: number, tx: number, ty: number) {
    k = this.clampK(k);
    const cw = BW * k;
    const ch = (Y_BOT - Y_TOP) * k;
    tx = cw <= this.w ? (this.w - cw) / 2 : Math.min(0, Math.max(this.w - cw, tx));
    ty = ch <= this.hgt ? (this.hgt - ch) / 2 - Y_TOP * k : Math.min(-Y_TOP * k, Math.max(this.hgt - Y_BOT * k, ty));
    this.k = k;
    this.tx = tx;
    this.ty = ty;
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render());
  }

  private render() {
    this.raf = 0;
    this.root.setAttribute('transform', `translate(${this.tx},${this.ty}) scale(${this.k})`);
    this.labels.replaceChildren(
      ...this.labelData.map((l) => {
        const [bx, by] = this.projection([l.lon, l.lat])!;
        const el = svgEl('text', { x: bx * this.k + this.tx, y: by * this.k + this.ty, class: l.cls });
        el.textContent = l.text;
        return el;
      }),
    );
  }

  private toLonLat(clientX: number, clientY: number): [number, number] | null {
    const r = this.svg.getBoundingClientRect();
    const bx = (clientX - r.left - this.tx) / this.k;
    const by = (clientY - r.top - this.ty) / this.k;
    const ll = this.projection.invert!([bx, by]);
    if (!ll || ll[1] > 85 || ll[1] < -85 || bx < 0 || bx > BW) return null;
    return [ll[0], ll[1]];
  }

  // ---------------------------------------------------------------- input
  private bind() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      svg.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 1) {
        this.gesture = { kind: 'drag', x0: e.clientX, y0: e.clientY, tx0: this.tx, ty0: this.ty, moved: false, type: e.pointerType };
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const r = svg.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        this.gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, k0: this.k, bx: (mx - this.tx) / this.k, by: (my - this.ty) / this.k };
      }
    });
    svg.addEventListener('pointermove', (e) => {
      if (!this.pointers.has(e.pointerId)) {
        if (e.pointerType === 'mouse') {
          const ll = this.toLonLat(e.clientX, e.clientY);
          if (ll) this.events.onHover?.(ll[0], ll[1]);
          else this.events.onLeave?.();
        }
        return;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const g = this.gesture;
      if (g?.kind === 'drag') {
        const dx = e.clientX - g.x0;
        const dy = e.clientY - g.y0;
        if (!g.moved && Math.hypot(dx, dy) > TAP_SLOP) g.moved = true;
        if (g.moved) this.apply(this.k, g.tx0 + dx, g.ty0 + dy);
        if (e.pointerType === 'mouse') {
          const ll = this.toLonLat(e.clientX, e.clientY);
          if (ll && !g.moved) this.events.onHover?.(ll[0], ll[1]);
        }
      } else if (g?.kind === 'pinch' && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const r = svg.getBoundingClientRect();
        const mx = (a.x + b.x) / 2 - r.left;
        const my = (a.y + b.y) / 2 - r.top;
        const k = this.clampK((g.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0);
        this.apply(k, mx - g.bx * k, my - g.by * k);
      }
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      this.pointers.delete(e.pointerId);
      const g = this.gesture;
      if (g?.kind === 'drag' && !g.moved && e.type === 'pointerup') {
        const ll = this.toLonLat(e.clientX, e.clientY);
        if (ll) this.events.onTap?.(ll[0], ll[1], g.type);
      }
      if (this.pointers.size === 1) {
        // Pinch -> one finger left: continue as a (non-tap) drag from here.
        const [p] = [...this.pointers.values()];
        this.gesture = { kind: 'drag', x0: p.x, y0: p.y, tx0: this.tx, ty0: this.ty, moved: true, type: e.pointerType };
      } else if (this.pointers.size === 0) this.gesture = null;
    };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.pointers.size) this.events.onLeave?.();
    });
    svg.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const r = svg.getBoundingClientRect();
        const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        this.zoomBy(Math.exp(-dy * 0.0025), e.clientX - r.left, e.clientY - r.top);
      },
      { passive: false },
    );
    svg.addEventListener('dblclick', (e) => e.preventDefault());
  }

  // ---------------------------------------------------------------- drawing
  private circlePath(lon: number, lat: number, rKm: number): string {
    const c = geoCircle().center([lon, lat]).radius((rKm / R_EARTH) * (180 / Math.PI)).precision(1)();
    return this.path(c) ?? '';
  }

  private circleEl(lon: number, lat: number, rKm: number, cls: string): SVGGElement {
    const g = svgEl('g', { class: cls });
    g.append(svgEl('path', { d: this.circlePath(lon, lat, rKm), class: 'hc-ring' }));
    const [x, y] = this.projection([lon, lat])!;
    g.append(svgEl('circle', { cx: x, cy: y, r: 1.2, class: 'hc-dot' }));
    return g;
  }

  setPreview(p: { lon: number; lat: number; r: number; cls?: string } | null): void {
    this.preview.replaceChildren(...(p ? [this.circleEl(p.lon, p.lat, p.r, `hc-circle ${p.cls ?? 'preview'}`)] : []));
  }

  setCircles(list: { lon: number; lat: number; r: number; cls: string; label?: string }[]): void {
    this.circles.replaceChildren(...list.map((c) => this.circleEl(c.lon, c.lat, c.r, `hc-circle ${c.cls}`)));
    this.labelData = list.filter((c) => c.label).map((c) => ({ lon: c.lon, lat: c.lat, text: c.label!, cls: `hc-label ${c.cls}` }));
    if (!this.raf) this.raf = requestAnimationFrame(() => this.render());
  }

  /** Faint population density layer (people per km², log scale), drawn from the same grid. */
  showDensity(grid: Grid): void {
    if (this.density.childNodes.length) return;
    const { w, h: gh, vals, cell, lat0 } = grid;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = gh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(w, gh);
    const cellKm2 = (cell * Math.PI / 180 * R_EARTH) ** 2;
    for (let row = 0; row < gh; row++) {
      const cos = Math.max(0.05, Math.cos(((lat0 - (row + 0.5) * cell) * Math.PI) / 180));
      for (let c = 0; c < w; c++) {
        const v = vals[row * w + c];
        if (!v) continue;
        const dens = v / (cellKm2 * cos);
        // 3 people/km² -> invisible, 10,000 people/km² -> full strength.
        const a = Math.min(1, (Math.log10(dens) - 0.5) / 3.5);
        if (a <= 0) continue;
        const i = 4 * (row * w + c);
        img.data[i] = 226;
        img.data[i + 1] = 88;
        img.data[i + 2] = 34;
        img.data[i + 3] = Math.round(20 + 235 * a * a);
      }
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const im = svgEl('image', { x: 0, y: 0, width: BW, height: 720, preserveAspectRatio: 'none' });
      im.setAttribute('href', URL.createObjectURL(blob));
      this.density.replaceChildren(im);
    });
  }
}
