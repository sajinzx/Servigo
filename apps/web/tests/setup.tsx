import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => cleanup());

// jsdom has no layout or WebGL: the map is replaced by a labelled placeholder in tests
vi.mock('@/map/Map', () => ({
  MapView: ({ ariaLabel }: { ariaLabel?: string }) => <div role="application" aria-label={ariaLabel ?? 'Map'} />,
}));

// jsdom lacks matchMedia
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    }),
  });
}
