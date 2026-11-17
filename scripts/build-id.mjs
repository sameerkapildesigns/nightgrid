// Build id = short SHA-256 over everything that must match between a browser and a room server
// (pure core, net protocol, authoritative room server). Used by Vite (define __NG_BUILD__), the local
// Node runtime and the Worker deploy (wrangler --define). A client with another id is refused with a
// "reload to update" message, so mixed versions never race each other.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export function buildFiles(root = ROOT) {
  const out = [];
  for (const d of ['src/core', 'src/net']) for (const f of readdirSync(join(root, d)).sort()) if (f.endsWith('.js')) out.push(`${d}/${f}`);
  out.push('server/room-server.js', 'package.json'); return out;
}
export function computeBuildId(root = ROOT) {
  const h = createHash('sha256');
  for (const f of buildFiles(root)) { h.update(f + '\0'); h.update(readFileSync(join(root, f))); h.update('\0'); }
  return h.digest('hex').slice(0, 12);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) console.log(computeBuildId());
