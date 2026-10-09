// Pure geometry for Mental Map: similarity (Procrustes/Umeyama) and affine least-squares fits,
// scoring and bias readout. No DOM, no imports: unit-tested directly by node (tests/mental.test.mjs).
// Coordinates are screen-like: x to the right (east), y DOWN (south).

export type Pt = [number, number];

/** q = s·R(theta)·p + t, with R(theta) = [[cos, −sin], [sin, cos]]. In a y-down frame theta > 0 turns clockwise. */
export interface Similarity {
  s: number;
  theta: number;
  tx: number;
  ty: number;
}

/** q = [[a, b], [c, d]]·p + t */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export function applySim(m: Similarity, p: Pt): Pt {
  const cs = Math.cos(m.theta);
  const sn = Math.sin(m.theta);
  return [m.s * (cs * p[0] - sn * p[1]) + m.tx, m.s * (sn * p[0] + cs * p[1]) + m.ty];
}

export function invertSim(m: Similarity): Similarity {
  const s = 1 / m.s;
  const cs = Math.cos(-m.theta);
  const sn = Math.sin(-m.theta);
  return { s, theta: -m.theta, tx: -s * (cs * m.tx - sn * m.ty), ty: -s * (sn * m.tx + cs * m.ty) };
}

function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p[0];
    y += p[1];
  }
  return [x / pts.length, y / pts.length];
}

/**
 * Least-squares similarity (uniform scale, rotation, translation; never a reflection) mapping src onto dst.
 * Closed-form 2D Umeyama: centre both sets, the optimal rotation is atan2(Σ cross, Σ dot).
 */
export function fitSimilarity(src: Pt[], dst: Pt[]): Similarity {
  const cs = centroid(src);
  const cd = centroid(dst);
  let dot = 0;
  let cross = 0;
  let ss = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i][0] - cs[0];
    const y = src[i][1] - cs[1];
    const u = dst[i][0] - cd[0];
    const v = dst[i][1] - cd[1];
    dot += x * u + y * v;
    cross += x * v - y * u;
    ss += x * x + y * y;
  }
  const theta = Math.atan2(cross, dot);
  const s = ss > 1e-12 ? Math.hypot(dot, cross) / ss : 1;
  const m: Similarity = { s: s > 0 ? s : 1, theta, tx: 0, ty: 0 };
  const r = applySim(m, cs);
  m.tx = cd[0] - r[0];
  m.ty = cd[1] - r[1];
  return m;
}

/** Least-squares affine map src → dst. Null when src is (nearly) collinear. */
export function fitAffine(src: Pt[], dst: Pt[]): Affine | null {
  const cs = centroid(src);
  const cd = centroid(dst);
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let sxu = 0;
  let syu = 0;
  let sxv = 0;
  let syv = 0;
  for (let i = 0; i < src.length; i++) {
    const x = src[i][0] - cs[0];
    const y = src[i][1] - cs[1];
    const u = dst[i][0] - cd[0];
    const v = dst[i][1] - cd[1];
    sxx += x * x;
    sxy += x * y;
    syy += y * y;
    sxu += x * u;
    syu += y * u;
    sxv += x * v;
    syv += y * v;
  }
  const det = sxx * syy - sxy * sxy;
  if (!(det > 1e-9 * (sxx + syy) ** 2)) return null;
  const a = (syy * sxu - sxy * syu) / det;
  const b = (sxx * syu - sxy * sxu) / det;
  const c = (syy * sxv - sxy * syv) / det;
  const d = (sxx * syv - sxy * sxv) / det;
  return { a, b, c, d, tx: cd[0] - a * cs[0] - b * cs[1], ty: cd[1] - c * cs[0] - d * cs[1] };
}

/** RMS distance of points from their centroid: the "size" of the set. */
export function spread(pts: Pt[]): number {
  const c = centroid(pts);
  let s = 0;
  for (const p of pts) s += (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2;
  return Math.sqrt(s / pts.length);
}

/** Errors as a fraction of the spread at which the score reaches 0. */
export const ZERO_AT = 0.5;

/** 0–100. Mean error equal to half the set's RMS radius scores 0; perfect scores 100. */
export function scoreFrom(meanErr: number, spreadKm: number): number {
  if (!(spreadKm > 0)) return 0;
  return Math.round(100 * Math.max(0, 1 - meanErr / (ZERO_AT * spreadKm)));
}

/** Per-country error band 0..3 (🟩🟨🟧🟥), relative to the spread of the set. */
export const BANDS = [0.1, 0.2, 0.3];
export function band(err: number, spreadKm: number): number {
  const r = err / spreadKm;
  let i = 0;
  while (i < BANDS.length && r >= BANDS[i]) i++;
  return i;
}

/** 8-way compass index (0 = N, 1 = NE, … 7 = NW) of a y-down vector. */
export function compass(dx: number, dy: number): number {
  const deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  return ((Math.round(deg / 45) % 8) + 8) % 8;
}

export interface Evaluation {
  /** player canvas → true km frame */
  sim: Similarity;
  /** per-country error in km after the fit */
  errs: number[];
  /** per-country error vector (placed − true) in the km frame, y down */
  vecs: Pt[];
  meanErr: number;
  spread: number;
  score: number;
  /** rotation the player applied to the world, degrees; > 0 = clockwise */
  tilt: number;
  /** N–S scale relative to E–W, percent (−18 = north–south squashed by 18%); null if undetermined */
  ns: number | null;
  worst: number;
}

/** Compare the player's points (canvas units) with the true points (km, same order). */
export function evaluate(player: Pt[], truth: Pt[]): Evaluation {
  const sim = fitSimilarity(player, truth);
  const vecs: Pt[] = player.map((p, i) => {
    const q = applySim(sim, p);
    return [q[0] - truth[i][0], q[1] - truth[i][1]];
  });
  const errs = vecs.map((v) => Math.hypot(v[0], v[1]));
  const meanErr = errs.reduce((a, b) => a + b, 0) / errs.length;
  const sp = spread(truth);
  let worst = 0;
  errs.forEach((e, i) => {
    if (e > errs[worst]) worst = i;
  });
  // The world as the player drew it: the affine map true → player.
  // Tilt = rotation part of its polar decomposition (falls back to the similarity's rotation);
  // N–S vs E–W = how long a north–south unit came out compared with an east–west unit.
  let tiltRad = -sim.theta;
  const aff = fitAffine(truth, player);
  let ns: number | null = null;
  if (aff && aff.a * aff.d - aff.b * aff.c > 0) {
    tiltRad = Math.atan2(aff.c - aff.b, aff.a + aff.d);
    const ew = Math.hypot(aff.a, aff.c);
    const nsLen = Math.hypot(aff.b, aff.d);
    if (ew > 0 && nsLen > 0) ns = (nsLen / ew - 1) * 100;
  }
  let tilt = (tiltRad * 180) / Math.PI;
  tilt = ((((tilt + 180) % 360) + 360) % 360) - 180;
  return { sim, errs, vecs, meanErr, spread: sp, score: scoreFrom(meanErr, sp), tilt, ns, worst };
}
