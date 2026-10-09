// Headcount core, shared verbatim by the browser (via pop.d.ts) and scripts/build-headcount.mjs,
// so puzzle targets and "perfect circles" agree exactly with what the player's browser computes.
// Plain JS on purpose: Node runs it without a TypeScript step.

export const R_EARTH = 6371.0088;
export const RADII = [100, 150, 200, 300, 500, 800];
export const BUCKETS = ['95+', '90+', '75+', '50+', '<50'];
export const WIN_SCORE = 90;
export const MAX_ATTEMPTS = 3;

const D2R = Math.PI / 180;
const MAGIC = 0x31474348; // "HCG1" little-endian
const HEADER = 32;

// ---------------------------------------------------------------- grid encoding
// Cell values are stored as code = round(log1p(pop) * scale) (Uint16, 0 = empty), sparsely:
// header (32 bytes) | occupancy bitmap (1 bit per cell) | high bytes of the non-zero codes | low bytes.
// The file on disk is that payload gzip'ed.

/** values: Float64Array(w*h) row-major from the north edge. Returns the uncompressed payload. */
export function encodeGrid(values, w, h, lon0, lat0, cell, scale) {
  const n = w * h;
  const codes = new Uint16Array(n);
  let nnz = 0;
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const code = v > 0 ? Math.min(65535, Math.round(Math.log1p(v) * scale)) : 0;
    codes[i] = code;
    if (code) nnz++;
  }
  const maskLen = Math.ceil(n / 8);
  const out = new Uint8Array(HEADER + maskLen + 2 * nnz);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint16(4, w, true);
  dv.setUint16(6, h, true);
  dv.setFloat32(8, lon0, true);
  dv.setFloat32(12, lat0, true);
  dv.setFloat32(16, cell, true);
  dv.setFloat32(20, scale, true);
  dv.setUint32(24, nnz, true);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const code = codes[i];
    if (!code) continue;
    out[HEADER + (i >> 3)] |= 1 << (i & 7);
    out[HEADER + maskLen + k] = code >>> 8;
    out[HEADER + maskLen + nnz + k] = code & 255;
    k++;
  }
  return out;
}

/** Inverse of encodeGrid. bytes: the uncompressed payload. */
export function decodeGrid(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('headcount grid: bad magic');
  const w = dv.getUint16(4, true);
  const h = dv.getUint16(6, true);
  const lon0 = dv.getFloat32(8, true);
  const lat0 = dv.getFloat32(12, true);
  const cell = dv.getFloat32(16, true);
  const scale = dv.getFloat32(20, true);
  const nnz = dv.getUint32(24, true);
  const n = w * h;
  const maskLen = Math.ceil(n / 8);
  if (bytes.length !== HEADER + maskLen + 2 * nnz) throw new Error('headcount grid: bad length');
  const vals = new Float32Array(n);
  const lut = new Map();
  let k = 0;
  for (let i = 0; i < n; i++) {
    if (!(bytes[HEADER + (i >> 3)] & (1 << (i & 7)))) continue;
    const code = (bytes[HEADER + maskLen + k] << 8) | bytes[HEADER + maskLen + nnz + k];
    k++;
    let v = lut.get(code);
    if (v === undefined) {
      v = Math.expm1(code / scale);
      lut.set(code, v);
    }
    vals[i] = v;
  }
  return { w, h, lon0, lat0, cell, scale, vals };
}

/** Sum of all cells. */
export function gridTotal(g) {
  let s = 0;
  for (let i = 0; i < g.vals.length; i++) s += g.vals[i];
  return s;
}

// ---------------------------------------------------------------- the circle sum
/**
 * Population inside a geodesic circle. Every cell whose centre lies within the radius counts;
 * cells near the edge are weighted linearly across a band one cell wide, so the result changes
 * smoothly as the circle moves. Distances are haversine on a sphere of radius R_EARTH.
 */
export function popInCircle(g, lat, lon, rKm) {
  const { w, h, cell, lat0, lon0, vals } = g;
  const cellKm = cell * D2R * R_EARTH;
  const phi1 = lat * D2R;
  const cosPhi1 = Math.cos(phi1);
  const sinPhi1 = Math.sin(phi1);
  const reachDeg = (rKm + cellKm) / R_EARTH / D2R + cell;
  const rowMin = Math.max(0, Math.floor((lat0 - (lat + reachDeg)) / cell));
  const rowMax = Math.min(h - 1, Math.floor((lat0 - (lat - reachDeg)) / cell));
  let sum = 0;
  for (let row = rowMin; row <= rowMax; row++) {
    const latC = lat0 - (row + 0.5) * cell;
    const phi = latC * D2R;
    const cosPhi = Math.cos(phi);
    const ramp = cellKm * Math.sqrt(Math.max(cosPhi, 0.01));
    const dMax = rKm + ramp / 2;
    // Longitude half-width of the circle (plus margin) on this row.
    const ang = dMax / R_EARTH;
    let half;
    if (ang >= Math.PI) half = 180;
    else {
      const den = cosPhi1 * cosPhi;
      if (den < 1e-12) half = 180;
      else {
        const cv = (Math.cos(ang) - sinPhi1 * Math.sin(phi)) / den;
        if (cv > 1) continue;
        half = cv < -1 ? 180 : Math.acos(cv) / D2R + cell;
      }
    }
    let c0;
    let c1;
    if (half >= 180) {
      c0 = 0;
      c1 = w - 1;
    } else {
      c0 = Math.floor((lon - half - lon0) / cell);
      c1 = Math.floor((lon + half - lon0) / cell);
      if (c1 - c0 >= w) c1 = c0 + w - 1;
    }
    const sDphi = Math.sin((phi - phi1) / 2);
    const a0 = sDphi * sDphi;
    const k = cosPhi1 * cosPhi;
    const base = row * w;
    for (let c = c0; c <= c1; c++) {
      const v = vals[base + (((c % w) + w) % w)];
      if (v === 0) continue;
      const sDl = Math.sin(((lon0 + (c + 0.5) * cell - lon) * D2R) / 2);
      const hav = a0 + k * sDl * sDl;
      const d = 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(hav)));
      const wt = 0.5 + (rKm - d) / ramp;
      if (wt <= 0) continue;
      sum += wt >= 1 ? v : v * wt;
    }
  }
  return sum;
}

// ---------------------------------------------------------------- scoring
/** 100 at the exact target, 0 at half or double it, log scale in between. */
export function score(captured, target) {
  if (!(captured > 0) || !(target > 0)) return 0;
  const s = 100 * (1 - Math.abs(Math.log(captured / target)) / Math.LN2);
  return Math.max(0, Math.round(s));
}

export function bucketFor(best) {
  if (best >= 95) return '95+';
  if (best >= 90) return '90+';
  if (best >= 75) return '75+';
  if (best >= 50) return '50+';
  return '<50';
}

/** Round to two significant figures (24,600,000 -> 25,000,000). */
export function niceTarget(p) {
  if (!(p > 0)) return 0;
  const mag = Math.pow(10, Math.floor(Math.log10(p)) - 1);
  return Math.round(p / mag) * mag;
}

/** Compact population: 38.4M, 2.45M, 820K, 1.21B. tr=true uses Turkish suffixes and a decimal comma. */
export function formatPop(n, tr = false) {
  const units = tr ? ['Mr', 'Mn', 'B'] : ['B', 'M', 'K'];
  const steps = [1e9, 1e6, 1e3];
  let s = String(Math.round(n));
  for (let i = steps.length - 1; i >= 0; i--) {
    const x = n / steps[i];
    if (x < 0.9995 && i > 0) continue;
    if (x < 0.9995) break;
    const d = x >= 99.95 ? 0 : x >= 9.995 ? 1 : 2;
    const str = x.toFixed(d);
    if (i > 0 && parseFloat(str) >= 1000) continue; // 999.7K -> 1.00M
    s = str + units[i];
  }
  return tr ? s.replace('.', ',') : s;
}

/** Share text: header, one emoji line with the captured populations (no locations), URL. */
export function shareText(day, pops, best, won) {
  const line = `👥 ${pops.map((p) => formatPop(p)).join(' ➡ ')} ${won ? '🎯' : '❌'} ${best}`;
  return `Meridian Headcount #${day}\n${line}\nhttps://meridian.example/#/headcount`;
}
