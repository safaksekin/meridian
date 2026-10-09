import type { Feature } from 'geojson';

export interface Region {
  in?: string;
  out?: string;
}
export function makeLocator(features: Feature[]): (lon: number, lat: number) => string | null;
export function regionOk(region: Region | null | undefined, cont: string | null): boolean;
