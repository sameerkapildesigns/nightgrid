// Where the browser finds the multiplayer backend (pure; unit-tested).
// Production: the frontend stays on Vercel (https://nightgrid.sameerkapil.com); the room backend is a
// separate Cloudflare Worker on workers.dev, given at BUILD time as VITE_MP_API_BASE (a public URL, not
// a secret). Rules:
//  - production build: multiplayer is enabled ONLY with an https:// base that is not localhost/private;
//    otherwise it is disabled with a reason (no silent same-origin or localhost fallback)
//  - dev/test builds: an explicit base is used if given (http allowed for local tests); without one the
//    page's own origin is used (Vite proxy / local Node runtime / wrangler dev)
// Share/invite links always point at the FRONTEND page, never at the backend.
const PRIVATE = /^(localhost|127\.|0\.0\.0\.0|\[::1\]|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
export function resolveMpConfig({ mode, apiBase, pageUrl }) {
  const prod = mode === 'production';
  const raw = (apiBase || '').trim();
  if (!raw) {
    if (prod) return { enabled: false, reason: 'no-backend-configured' };
    const u = new URL('./', pageUrl);
    return { enabled: true, http: u.origin + u.pathname.replace(/\/$/, ''), ws: (u.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + u.host + u.pathname.replace(/\/$/, ''), crossOrigin: false };
  }
  let u; try { u = new URL(raw); } catch (e) { return { enabled: false, reason: 'bad-backend-url' }; }
  if (u.search || u.hash || u.username || u.password) return { enabled: false, reason: 'bad-backend-url' };
  if (prod && (u.protocol !== 'https:' || PRIVATE.test(u.hostname))) return { enabled: false, reason: 'insecure-backend-url' };
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { enabled: false, reason: 'bad-backend-url' };
  const base = u.origin + u.pathname.replace(/\/+$/, '');
  return { enabled: true, http: base, ws: base.replace(/^http/, 'ws'), crossOrigin: u.origin !== new URL(pageUrl).origin };
}
export function inviteLink(pageUrl, code) { const u = new URL(pageUrl); u.search = ''; u.hash = ''; u.searchParams.set('room', code); return u.toString(); }
