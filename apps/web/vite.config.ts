import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        // maps and charts are only needed on a few screens; keep them out of the first load
        manualChunks: {
          maplibre: ['maplibre-gl'],
          h3: ['h3-js'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['tests/setup.ts'],
    css: false,
  },
});
