// Web Worker entry: the multiplayer connection, input timeline and prediction live here, off the
// rendering thread (logic in worker-host.js, tested in Node). Page-side proxy: src/client/net-proxy.js.
import { createWorkerHost } from './worker-host.js';
const host = createWorkerHost({ post: m => self.postMessage(m), WebSocketImpl: WebSocket, now: () => performance.now(), timeOrigin: performance.timeOrigin,
  allowAutodrive: import.meta.env.MODE === 'test' });   // scripted test driver: test builds only
self.onmessage = e => host.onMessage(e.data);
