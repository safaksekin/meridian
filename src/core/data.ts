// Cached JSON loader for files under public/data/.
const cache = new Map<string, Promise<unknown>>();

export function loadJSON<T>(path: string): Promise<T> {
  if (!cache.has(path)) {
    const url = new URL(`data/${path}`, document.baseURI).toString();
    cache.set(
      path,
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(`${path}: ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path) as Promise<T>;
}
