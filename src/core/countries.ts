import { loadJSON } from './data';
import { fold, lang } from './i18n';

export interface Country {
  c: string;
  en: string;
  tr: string;
  lat: number;
  lon: number;
  cont: string;
  sov: boolean;
  area: number;
  pop: number;
  nb: string[];
  al: string[];
}

let byCode: Map<string, Country> | null = null;
let list: Country[] = [];

export async function loadCountries(): Promise<Country[]> {
  if (!byCode) {
    list = await loadJSON<Country[]>('countries.json');
    byCode = new Map(list.map((c) => [c.c, c]));
  }
  return list;
}

export function country(code: string): Country {
  const c = byCode?.get(code);
  if (!c) throw new Error(`unknown country ${code}`);
  return c;
}

export function countryName(code: string): string {
  const c = byCode?.get(code);
  return c ? (lang === 'tr' ? c.tr : c.en) : code;
}

/** Searchable items for the autocomplete: matches both languages and aliases. */
export function countryItems(filter?: (c: Country) => boolean) {
  return list
    .filter((c) => !filter || filter(c))
    .map((c) => ({
      id: c.c,
      label: lang === 'tr' ? c.tr : c.en,
      keys: [fold(c.en), fold(c.tr), ...c.al.map(fold), c.c.toLowerCase()],
    }));
}
