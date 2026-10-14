// Street-map drawing shared by Streetprint and Expedition's street-crop clue.
// Styles: .st-* classes (src/modes/streets/style.css, src/modes/expedition/style.css).
import { svgEl } from '../../core/ui';
import { linesPath, polyPath, type Puzzle, type View } from './logic';

/** Draws one view (3 km crop or 10 km context) into a fresh <svg>. */
export function drawView(view: View, kind: 'crop' | 'zoom', p: Puzzle): { svg: SVGSVGElement; g: SVGGElement } {
  const s = view.s;
  const svg = svgEl('svg', { viewBox: `${-s} ${-s} ${2 * s} ${2 * s}`, class: `st-svg st-${kind}`, role: 'img' });
  const g = svgEl('g', { class: 'st-rot' });
  const water = svgEl('g', { class: 'st-water' });
  for (const poly of view.w) water.append(svgEl('path', { d: polyPath(poly), class: 'st-wpoly' }));
  if (view.wl.length) water.append(svgEl('path', { d: linesPath(view.wl), class: 'st-wline' }));
  g.append(water);
  // Drawn like a street map: every road is a light line over a darker, wider casing (all casings first,
  // so junctions stay open).
  const roads = (layers: [string, string][]) => {
    for (const pass of ['st-case', 'st-street'])
      for (const [d, cls] of layers) g.append(svgEl('path', { d, class: `${pass}${cls ? ` ${cls}` : ''}` }));
  };
  if (kind === 'crop') {
    roads([[linesPath(p.r), ''], [linesPath(p.m), 'st-major']]);
    g.append(svgEl('path', { d: linesPath(p.rl), class: 'st-rail' }));
  } else {
    roads([[linesPath(p.z.m), 'st-major'], [linesPath(p.z.f), 'st-fast']]);
    const c = p.s;
    g.append(svgEl('rect', { x: -c, y: -c, width: 2 * c, height: 2 * c, class: 'st-cropbox' }));
  }
  svg.append(g);
  return { svg, g };
}
