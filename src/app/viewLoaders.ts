type Loader<T> = () => Promise<T>;

/**
 * One shared import per view. React holds back a lazily loaded view for about 300 ms after any
 * "loading" placeholder was shown, even when its code arrives in a few milliseconds, so views are
 * fetched ahead of the first time they are drawn instead of when they are first needed.
 */
export function createViewLoaders<T, K extends string>(sources: Record<K, Loader<T>>) {
  const started = new Map<K, Promise<T>>();
  const loaded = new Map<K, T>();
  function load(name: K): Promise<T> {
    let pending = started.get(name);
    if (!pending) {
      pending = sources[name]();
      started.set(name, pending);
      // A chunk that failed to arrive is asked for again next time instead of staying broken.
      pending.then((value) => void loaded.set(name, value), () => undefined);
      pending.catch(() => {
        if (started.get(name) === pending) started.delete(name);
      });
    }
    return pending;
  }
  const names = Object.keys(sources) as K[];
  return {
    load,
    /** The module if it has already arrived, so a caller can draw it without suspending. */
    peek: (name: K): T | undefined => loaded.get(name),
    /** Starts the named views now; never throws, because a preload is only an optimization. */
    preload: (first: K[]) => Promise.allSettled(first.map(load)).then(() => undefined),
    preloadRest: () => Promise.allSettled(names.map(load)).then(() => undefined),
  };
}
