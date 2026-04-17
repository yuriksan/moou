import { ref, watch } from 'vue';
import type { Ref } from 'vue';

/**
 * Like `ref()` but persists to localStorage under `key`.
 * The URL query param takes precedence on first load (pass `urlValue`),
 * falling back to localStorage, then to `defaultValue`.
 */
export function usePersistedRef<T>(key: string, defaultValue: T, urlValue?: T | null): Ref<T> {
  function load(): T {
    if (urlValue !== undefined && urlValue !== null) return urlValue;
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch {}
    return defaultValue;
  }

  const r = ref<T>(load()) as Ref<T>;

  watch(r, (val) => {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  }, { deep: true });

  return r;
}
