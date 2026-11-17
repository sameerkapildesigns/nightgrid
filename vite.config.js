import { defineConfig } from 'vite';
import { computeBuildId } from './scripts/build-id.mjs';
// GLBs are imported via new URL(..., import.meta.url) and emitted as hashed binary files.
// __NG_BUILD__: must equal the room server's build id (see scripts/build-id.mjs).
// Dev: /api (room HTTP + WebSocket) is proxied to the local room server (npm run mp:server).
export default defineConfig({
  base: './',
  assetsInclude: ['**/*.glb'],
  define: { __NG_BUILD__: JSON.stringify(computeBuildId()) },
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200, sourcemap: false },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  preview: { host: '127.0.0.1' }
});
