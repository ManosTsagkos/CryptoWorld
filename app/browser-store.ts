type StorageAccess = Pick<Storage, "getItem" | "setItem">;
type StoreOptions<T> = {
  key: string;
  initial: T;
  sanitize: (value: unknown) => T;
  storage: () => StorageAccess | null;
  onStorageChange: (reload: () => void) => () => void;
};

/** A cached snapshot for React, with memory-only behavior when storage is blocked. */
export function createBrowserStore<T>({
  key,
  initial,
  sanitize,
  storage,
  onStorageChange,
}: StoreOptions<T>) {
  let current = initial;
  let serialized = JSON.stringify(initial);
  let hydrated = false;
  let stopListening: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (value: unknown) => {
    const next = sanitize(value);
    const nextSerialized = JSON.stringify(next);
    if (nextSerialized === serialized) return;
    current = next;
    serialized = nextSerialized;
    listeners.forEach((listener) => listener());
  };

  const reload = () => {
    let saved: string | null | undefined;
    try {
      saved = storage()?.getItem(key);
    } catch {
      // A private browser session may reject storage access entirely.
      // Retain the last useful in-memory value in that case.
      return;
    }
    let value: unknown = initial;
    try {
      if (saved) value = JSON.parse(saved);
    } catch {
      /* invalid stored JSON resets to defaults */
    }
    publish(value);
  };

  const getSnapshot = () => {
    if (!hydrated) {
      hydrated = true;
      reload();
    }
    return current;
  };

  return {
    getSnapshot,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!stopListening) {
        stopListening = onStorageChange(reload);
        reload();
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          stopListening?.();
          stopListening = null;
        }
      };
    },
    update(updater: (value: T) => T) {
      const next = sanitize(updater(getSnapshot()));
      try {
        storage()?.setItem(key, JSON.stringify(next));
      } catch {
        /* keep the session usable */
      }
      publish(next);
    },
  };
}
