import { useSyncExternalStore } from 'react';

/** Minimal external store (no dependencies). Game writes, React reads. */
export interface Store<T> {
  get(): T;
  set(partial: Partial<T> | ((s: T) => Partial<T>)): void;
  subscribe(listener: () => void): () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(partial) {
      const patch = typeof partial === 'function' ? partial(state) : partial;
      let changed = false;
      for (const k in patch) {
        if (!Object.is((patch as T)[k], state[k as keyof T])) {
          changed = true;
          break;
        }
      }
      if (!changed) return;
      state = { ...state, ...patch };
      listeners.forEach((l) => l());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T, S>(store: Store<T>, selector: (s: T) => S): S {
  return useSyncExternalStore(store.subscribe, () => selector(store.get()), () => selector(store.get()));
}
