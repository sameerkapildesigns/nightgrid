// Cloudflare Workers + Durable Objects adaptor (production runtime; NOT deployed by this branch).
// One SQLite-backed Durable Object per private room (class Room) wraps the same RoomServer used by the
// local runtime. One singleton Durable Object (class Registry) holds the shared free-tier budget, so the
// daily allowance is enforced across ALL rooms (each room is admitted, heart-beats and is released).
// Static files: Workers static assets (wrangler.toml [assets]). Free plan only: SQLite-backed DOs.
// WebSockets use the Hibernation API (ctx.acceptWebSocket) so an idle lobby can hibernate; a running
// race keeps a 20 Hz interval and cannot hibernate (documented in docs/M4-DEPLOY-FREE.md).
import { DurableObject } from 'cloudflare:workers';
import { RoomServer } from './room-server.js';
import { createBudget } from '../src/net/budget.js';
import { makeRoomCode, validCode, normalizeCode } from '../src/net/protocol.js';

const BUILD = typeof __NG_BUILD__ !== 'undefined' ? __NG_BUILD__ : 'dev';   // wrangler deploy --define __NG_BUILD__:'"<id>"'
const random = b => crypto.getRandomValues(b);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const num = (v, d) => (v != null && v !== '' && isFinite(+v) ? +v : d);
function budgetCfg(env) {
  return { dailyRoomMs: num(env.DAILY_ROOM_MINUTES, 240) * 60e3, maxActiveRooms: num(env.MAX_ACTIVE_ROOMS, 3), roomMaxLifetimeMs: num(env.ROOM_MAX_MINUTES, 60) * 60e3, safety: num(env.BUDGET_SAFETY, 0.85), maxCreatesPerDay: num(env.MAX_CREATES_PER_DAY, 200) };
}
function originOk(req, env) {
  const o = req.headers.get('origin'); if (!o) return true;   // non-browser client
  const allow = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  try { return allow.length ? allow.includes(o) : new URL(o).host === new URL(req.url).host; } catch (e) { return false; }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    if (!originOk(req, env)) return json(403, { ok: false, error: 'origin' });
    const registry = env.REGISTRY.get(env.REGISTRY.idFromName('global'));
    if (url.pathname === '/api/rooms' && req.method === 'POST') {
      for (let i = 0; i < 4; i++) {
        const code = makeRoomCode(random);
        const a = await registry.admit(code); if (!a.ok && a.error === 'exists') continue; if (!a.ok) return json(503, { ok: false, error: a.error });
        await env.ROOMS.get(env.ROOMS.idFromName(code)).init(code);
        return json(201, { ok: true, code });
      }
      return json(503, { ok: false, error: 'capacity' });
    }
    if (url.pathname === '/api/health') return json(200, { ok: true, build: BUILD, budget: await registry.report() });
    const m = url.pathname.match(/^\/api\/rooms\/([A-Za-z0-9]+)(\/ws)?$/);
    if (m) {
      const code = normalizeCode(m[1]); if (!validCode(code)) return json(404, { ok: false, error: 'no-room' });
      const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
      if (m[2]) { if (req.headers.get('upgrade') !== 'websocket') return json(426, { ok: false, error: 'upgrade-required' }); return stub.fetch(req); }
      const info = await stub.info(); return info ? json(200, { ok: true, ...info }) : json(404, { ok: false, error: 'no-room' });
    }
    return json(404, { ok: false, error: 'not-found' });
  }
};

// ---- shared budget (singleton) ----
export class Registry extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.env = env; ctx.blockConcurrencyWhile(async () => { this.b = createBudget(budgetCfg(env), (await ctx.storage.get('budget')) || null); }); }
  async save() { await this.ctx.storage.put('budget', this.b.state); }
  async admit(code) { const r = this.b.admit(code, Date.now()); if (r.ok) await this.save(); return r; }
  async beat(code) { const r = this.b.beat(code, Date.now()); await this.save(); return r; }
  async canRace(code) { return this.b.canRace(code, Date.now()); }
  async release(code) { this.b.release(code, Date.now()); await this.save(); return { ok: true }; }
  async report() { return this.b.report(Date.now()); }
}

// ---- one private room ----
export class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.env = env; this.conns = new Map();   // WebSocket -> conn wrapper
    ctx.blockConcurrencyWhile(async () => { const meta = await ctx.storage.get('meta'); if (meta) this.boot(meta.code, meta); });
  }
  registry() { return this.env.REGISTRY.get(this.env.REGISTRY.idFromName('global')); }
  boot(code, meta = null) {
    const ctx = this.ctx;
    const timers = { now: () => Date.now(), setInterval, clearInterval, setTimeout, clearTimeout, wake: ms => { ctx.storage.setAlarm(Date.now() + ms); } };
    this.srv = new RoomServer({ code, build: BUILD, timers, random, cfg: {},
      budget: { beat: c => this.registry().beat(c), canRace: c => this.registry().canRace(c), release: c => this.registry().release(c) },
      persist: m => ctx.storage.put('meta', m),
      onClose: () => { ctx.storage.deleteAlarm(); ctx.storage.deleteAll(); this.srv = null; },
      restored: meta && meta.seats ? meta : null });
    for (const ws of ctx.getWebSockets()) { const a = ws.deserializeAttachment() || {}; this.srv.adopt(this.wrap(ws), a.id); }   // woke from hibernation
  }
  wrap(ws) {
    let c = this.conns.get(ws);
    if (!c) { c = { ws, send: t => ws.send(t), close: (code, r) => { try { ws.close(code, r); } catch (e) { } } }; this.conns.set(ws, c); }
    return c;
  }
  async init(code) { if (!this.srv) { this.boot(code); await this.ctx.storage.put('meta', { code }); } return { ok: true }; }
  async info() { return this.srv ? { phase: this.srv.room.phase, seats: this.srv.room.seats.length } : null; }
  async fetch(req) {
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    if (!this.srv) { server.send(JSON.stringify({ t: 'error', error: 'no-room', fatal: true })); server.close(4004, 'no-room'); return new Response(null, { status: 101, webSocket: client }); }
    this.srv.connect(this.wrap(server));
    return new Response(null, { status: 101, webSocket: client });
  }
  async webSocketMessage(ws, msg) {
    if (!this.srv || typeof msg !== 'string') return;
    const c = this.wrap(ws); if (!this.srv.conns.has(c)) this.srv.connect(c);
    this.srv.message(c, msg);
    const st = this.srv.conns.get(c); if (st && st.id && !c.tagged) { ws.serializeAttachment({ id: st.id }); c.tagged = true; }   // survives hibernation (no token stored here)
  }
  async webSocketClose(ws) { const c = this.conns.get(ws); this.conns.delete(ws); if (c && this.srv) this.srv.close(c); }
  async webSocketError(ws) { return this.webSocketClose(ws); }
  async alarm() { if (this.srv) this.srv.housekeep(); }
}
