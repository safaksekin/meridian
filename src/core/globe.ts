import type { GeoProjection } from 'd3-geo';
import { h } from './ui';
import { makeT } from './i18n';

const t = makeT();

/**
 * Makes an orthographic globe drawn into `svg` (square viewBox) interactive: drag turns it; the wheel,
 * a pinch or the returned `zoomBy` zoom between the whole globe and `maxZoom` times closer.
 * `redraw` repaints the svg from the projection.
 */
export function globeControls(svg: SVGSVGElement, proj: GeoProjection, redraw: () => void, maxZoom = 6) {
  const base = proj.scale();
  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { kind: 'drag'; x: number; y: number; rot: [number, number, number] } | { kind: 'pinch'; d0: number; k0: number } | null = null;
  let frame = 0;
  const paint = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(redraw);
  };
  const zoom = () => proj.scale() / base;
  const turn = (lon: number, lat: number) => proj.rotate([lon, Math.max(-80, Math.min(80, lat)), 0]);
  /** Screen px per viewBox unit and the globe's corner: it is letterboxed inside the svg box. */
  const frameOf = () => {
    const box = svg.getBoundingClientRect();
    const size = svg.viewBox.baseVal.width;
    const s = Math.min(box.width, box.height) / size;
    return { s, left: box.left + (box.width - size * s) / 2, top: box.top + (box.height - size * s) / 2 };
  };
  const toView = (clientX: number, clientY: number): [number, number] => {
    const f = frameOf();
    return [(clientX - f.left) / f.s, (clientY - f.top) / f.s];
  };
  const place = (at: [number, number]): [number, number] | null => {
    const ll = proj.invert?.(at);
    return ll && Number.isFinite(ll[0]) && Number.isFinite(ll[1]) ? ll : null;
  };

  /** Sets the zoom (1 = whole globe), keeping the place at `at` (viewBox units) under the pointer. False when nothing changed. */
  function zoomTo(k: number, at?: [number, number]): boolean {
    k = Math.max(1, Math.min(maxZoom, k));
    if (Math.abs(k - zoom()) < 1e-4) return false;
    const before = at && place(at);
    proj.scale(base * k);
    if (at && before) {
      for (let i = 0; i < 3; i++) {
        const now = place(at);
        if (!now) break;
        const [lon, lat] = proj.rotate();
        turn(lon + ((((now[0] - before[0]) % 360) + 540) % 360) - 180, lat + now[1] - before[1]);
      }
    }
    paint();
    return true;
  }

  const begin = () => {
    const pts = [...pointers.values()];
    if (pts.length === 1) gesture = { kind: 'drag', x: pts[0].x, y: pts[0].y, rot: proj.rotate() };
    else if (pts.length === 2) gesture = { kind: 'pinch', d0: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) || 1, k0: zoom() };
    else if (!pts.length) gesture = null;
  };
  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // no text selection or image drag while turning the globe
    svg.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    begin();
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture?.kind === 'drag') {
      const k = 180 / (proj.scale() * Math.PI) / frameOf().s;
      turn(gesture.rot[0] + (e.clientX - gesture.x) * k, gesture.rot[1] - (e.clientY - gesture.y) * k);
      paint();
    } else if (gesture?.kind === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      zoomTo((gesture.k0 * Math.hypot(a.x - b.x, a.y - b.y)) / gesture.d0, toView((a.x + b.x) / 2, (a.y + b.y) / 2));
    }
  });
  const end = (e: PointerEvent) => {
    if (!pointers.delete(e.pointerId)) return;
    begin(); // pinch -> one finger left: carry on as a drag from here
  };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
  svg.addEventListener(
    'wheel',
    (e) => {
      const dy = (e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY) * (e.ctrlKey ? 4 : 1); // ctrl = trackpad pinch: small deltas
      // At either end of the range the wheel scrolls the page as usual.
      if (zoomTo(zoom() * Math.exp(-dy * 0.0025), toView(e.clientX, e.clientY))) e.preventDefault();
    },
    { passive: false },
  );
  svg.addEventListener('dblclick', (e) => e.preventDefault());

  return {
    zoomBy: (f: number) => void zoomTo(zoom() * f),
    /** Back to the whole globe. */
    reset: () => void zoomTo(1),
  };
}

/** The + / − buttons that sit in a map's corner (`.map-zoom` in style.css; the parent must be positioned). */
export function zoomButtons(zoomBy: (f: number) => void, ...more: HTMLElement[]): HTMLElement {
  return h('div', { class: 'map-zoom' }, zoomBtn('+', t('zoomIn'), () => zoomBy(2)), zoomBtn('−', t('zoomOut'), () => zoomBy(0.5)), ...more);
}

export function zoomBtn(txt: string, label: string, fn: () => void): HTMLElement {
  return h('button', { class: 'icon-btn', type: 'button', 'aria-label': label, title: label, onclick: fn }, txt);
}
