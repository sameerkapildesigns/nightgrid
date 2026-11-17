// Pre-commit secret/PII scan over tracked + staged text files. Exit 1 on any finding.
// Usage: npm run scan
import { execSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
const files = execSync('git ls-files -co --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
const RULES = [
  ['private key', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['GitHub token', /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}/],
  ['AWS key', /\bAKIA[0-9A-Z]{16}\b/],
  ['Google API key', /\bAIza[0-9A-Za-z_\-]{35}\b/],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ['Anthropic/OpenAI key', /\b(sk-ant-[A-Za-z0-9_\-]{20,}|sk-[A-Za-z0-9]{32,})\b/],
  ['Cloudflare token assignment', /(CF|CLOUDFLARE)_(API_)?TOKEN\s*[=:]\s*['"]?[A-Za-z0-9_\-]{20,}/i],
  ['JWT', /\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/],
  ['generic secret assignment', /\b(api[_-]?key|secret|passw(or)?d|token)\b\s*[=:]\s*['"][^'"\s]{12,}['"]/i],
  ['email address', /\b[A-Za-z0-9._%+-]+@(?!anthropic\.com\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
  ['private link', /(claude\.ai\/(chat|share|code\/session)|docs\.google\.com\/[^\s'"]*\/d\/|drive\.google\.com\/(file|drive))/],
  ['local home path', /\/home\/(?!user\/nightgrid\b)[a-z][\w-]*\/|C:\\Users\\/]
];
const SKIP = /\.(glb|png|jpe?g|webp|ico|woff2?)$|^package-lock\.json$/;
const ALLOW = [/three@0\.170\.0/];   // e.g. npm-style version tags that look like emails
let n = 0;
// local runtime state / env files must never be tracked (workerd state holds local session data)
for (const f of files) if (/^\.wrangler\/|(^|\/)\.dev\.vars$|(^|\/)\.env(\.(?!example$)[^/]*)?$/.test(f)) { n++; console.log(`${f}: forbidden path (local state / env file)`); }
for (const f of files) {
  if (SKIP.test(f)) continue;
  let txt; try { if (statSync(f).size > 2e6) continue; txt = readFileSync(f, 'utf8'); } catch (e) { continue; }
  txt.split('\n').forEach((line, i) => {
    for (const [name, re] of RULES) { const m = line.match(re); if (m && !ALLOW.some(a => a.test(m[0]))) { n++; console.log(`${f}:${i + 1}: ${name}: ${m[0].slice(0, 60)}`); } }
  });
}
console.log(n ? `\n${n} finding(s)` : `secret scan: 0 findings in ${files.length} files`);
process.exit(n ? 1 : 0);
