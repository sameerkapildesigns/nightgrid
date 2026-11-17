import { defineConfig } from 'vite';
// GLBs are imported via new URL(..., import.meta.url) and emitted as hashed binary files.
export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb'],
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200, sourcemap: false },
  server: { host: '127.0.0.1' },
  preview: { host: '127.0.0.1' }
});
