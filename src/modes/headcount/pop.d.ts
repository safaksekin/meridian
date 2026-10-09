export interface Grid {
  w: number;
  h: number;
  /** West edge (degrees) of column 0. */
  lon0: number;
  /** North edge (degrees) of row 0. */
  lat0: number;
  /** Cell size in degrees. */
  cell: number;
  scale: number;
  /** People per cell, row-major from the north edge. */
  vals: Float32Array;
}

export const R_EARTH: number;
export const RADII: number[];
export const BUCKETS: string[];
export const WIN_SCORE: number;
export const MAX_ATTEMPTS: number;

export function encodeGrid(values: ArrayLike<number>, w: number, h: number, lon0: number, lat0: number, cell: number, scale: number): Uint8Array;
export function decodeGrid(bytes: Uint8Array): Grid;
export function gridTotal(g: Grid): number;
export function popInCircle(g: Grid, lat: number, lon: number, rKm: number): number;
export function score(captured: number, target: number): number;
export function bucketFor(best: number): string;
export function niceTarget(p: number): number;
export function formatPop(n: number, tr?: boolean): string;
export function shareText(day: number, pops: number[], best: number, won: boolean): string;
