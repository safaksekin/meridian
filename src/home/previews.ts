// Live, spoiler-free previews of today's puzzle for each home card. STUB: replaced by the full version.
/** Returns an <svg> (viewBox 0 0 320 200) for mode `id` on puzzle day `day`. Never reveals answers. */
export async function preview(id: string, day: number): Promise<SVGSVGElement> {
  void day;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 320 200');
  svg.setAttribute('class', `pv pv-${id}`);
  return svg;
}
