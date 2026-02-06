import '@testing-library/jest-dom/vitest';

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }),
});

const localStore = new Map<string, string>();
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => (localStore.has(key) ? localStore.get(key)! : null),
    setItem: (key: string, value: string) => {
      localStore.set(key, String(value));
    },
    removeItem: (key: string) => {
      localStore.delete(key);
    },
    clear: () => {
      localStore.clear();
    },
    key: (index: number) => Array.from(localStore.keys())[index] ?? null,
    get length() {
      return localStore.size;
    },
  },
});
