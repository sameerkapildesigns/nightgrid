import { defineConfig } from 'vite';
import { computeBuildId } from './scripts/build-id.mjs';
// GLBs are imported via new URL(..., import.meta.url) and emitted as hashed binary files.
// __NG_BUILD__: must equal the room server's build id (see scripts/build-id.mjs).
// Dev: /api (room HTTP + WebSocket) is proxied to the local room server (npm run mp:server).
const BUILD = computeBuildId();
// public build manifest (no secrets): lets a deploy check that the Vercel frontend and the workers.dev
// backend run the same build id (scripts/check-deploy.mjs)
const buildManifest = () => ({ name: 'ng-build-manifest', apply: 'build', generateBundle() {
  this.emitFile({ type: 'asset', fileName: 'ng-build.json', source: JSON.stringify({ build: BUILD, mpApiBase: process.env.VITE_MP_API_BASE || null }) + '\n' }); } });
export default defineConfig({
  plugins: [buildManifest()],
  base: './',
  assetsInclude: ['**/*.glb'],
  define: { __NG_BUILD__: JSON.stringify(BUILD) },
  build: { target: 'es2020', assetsInlineLimit: 0, chunkSizeWarningLimit: 1200, sourcemap: false },
  server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } } },
  preview: { host: '127.0.0.1' }
});
