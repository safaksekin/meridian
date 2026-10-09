// Shared loader: Natural Earth admin-0 features with a stable 2-letter code per game "country".
// Indeterminate slivers are dropped; de-facto splits are merged into the UN-recognised state
// so that tripoints and line crossings match what players expect.
import { readFileSync } from 'node:fs';

const MERGE = {
  'Somaliland': 'SO',
  'Northern Cyprus': 'CY',
  'Cyprus No Mans Area': 'CY',
  'Dhekelia Sovereign Base Area': 'CY',
  'Akrotiri Sovereign Base Area': 'CY',
  'US Naval Base Guantanamo Bay': 'CU',
  'Siachen Glacier': 'IN',
  'Baykonur Cosmodrome': 'KZ',
};
// Fallbacks for entries whose ISO_A2_EH is missing.

export function codeFor(p) {
  if (MERGE[p.ADMIN]) return MERGE[p.ADMIN];
  const c = p.ISO_A2_EH && p.ISO_A2_EH !== '-99' ? p.ISO_A2_EH : (p.ISO_A2 !== '-99' ? p.ISO_A2 : null);
  return c;
}

export function loadFeatures(res = '10m') {
  const g = JSON.parse(readFileSync(new URL(`../../data-raw/ne_${res}_admin_0_countries.geojson`, import.meta.url)));
  const out = [];
  for (const f of g.features) {
    const code = codeFor(f.properties);
    if (!code) continue;
    out.push({ code, props: f.properties, geometry: f.geometry });
  }
  return out;
}

// Merge features that share a code into one MultiPolygon.
export function mergeByCode(features) {
  const by = new Map();
  for (const f of features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    if (!by.has(f.code)) by.set(f.code, { code: f.code, props: f.props, polys: [] });
    const e = by.get(f.code);
    // Keep the props of the "main" feature (largest population).
    if ((f.props.POP_EST || 0) > (e.props.POP_EST || 0)) e.props = f.props;
    e.polys.push(...polys);
  }
  return [...by.values()].map(e => ({ code: e.code, props: e.props, geometry: { type: 'MultiPolygon', coordinates: e.polys } }));
}
