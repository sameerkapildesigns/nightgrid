// Private-room lobby UI (DOM only). Talks to the room through the NetClient passed in; the server
// validates everything (host-only actions are also refused server-side). No chat, accounts or
// matchmaking: create a room, share the 6-character code or join link, race.
import { ERROR_TEXT, normalizeCode, validCode, CODE_LEN } from '../net/protocol.js';
import { inviteLink } from '../net/mp-config.js';
import { MAPS, MAP_KEYS } from '../core/maps.js';
import { SHORT, PAINTS, RIVAL_LIV } from '../core/roster.js';

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NAME_KEY = 'nightgrid_mp_name';
const LOCAL_TEXT = { 'server-timeout': 'The race server did not answer within 10 s. Check your connection and try again.' };
export const errorText = code => { const c = String(code || ''); if (LOCAL_TEXT[c]) return LOCAL_TEXT[c]; if (ERROR_TEXT[c]) return ERROR_TEXT[c]; if (/^http-\d+$/.test(c)) return 'The race server answered with an error (' + c.slice(5) + '). Try again in a minute.'; if (c.startsWith('room-closed')) { const why = c.split(':')[1]; return why === 'daily-budget' ? ERROR_TEXT['daily-budget'] : why === 'budget-unavailable' ? ERROR_TEXT['budget-unavailable'] : ERROR_TEXT['room-closed']; } return 'Something went wrong (' + c + ').'; };

export function createLobbyUI({ el, onCreate, onJoin, onLeave, getNet, onOpenChange }) {
  const ui = { open: false, busy: false, err: '', note: '', codeIn: '', copied: 0 };
  let name = ''; try { name = localStorage.getItem(NAME_KEY) || ''; } catch (e) { }
  const saveName = n => { name = n.slice(0, 16); try { localStorage.setItem(NAME_KEY, name); } catch (e) { } };
  function show(on) { ui.open = on; el.classList.toggle('hide', !on); document.body.classList.toggle('mpopen', on); if (onOpenChange) onOpenChange(on); render(); }
  function seatRow(s, room, you) {
    const liv = s.kind === 'bot' ? RIVAL_LIV[s.name] : PAINTS[s.paint || 0];
    const col = liv ? liv.neon : '#0ff', car = (SHORT[s.car] || [s.car])[0];
    const tags = [s.id === room.hostId ? '<b class="tg host" title="Host">HOST</b>' : '', s.kind === 'bot' ? '<b class="tg bot">BOT</b>' : '', s.id === you ? '<b class="tg you">YOU</b>' : '', !s.connected && s.kind === 'human' ? '<b class="tg dc">RECONNECTING</b>' : ''].join('');
    const st = s.kind === 'bot' ? '<span class="rdy on">Ready</span>' : s.ready ? '<span class="rdy on">Ready</span>' : '<span class="rdy">Not ready</span>';
    const rm = room.hostId === you && s.kind === 'bot' && room.phase === 'lobby' ? `<button class="chip sm" data-act="rmbot" data-bot="${esc(s.id)}" aria-label="Remove ${esc(s.name)}">Remove</button>` : '';
    return `<li><i class="sw" style="background:${col};box-shadow:0 0 8px ${col}"></i><span class="nm">${esc(s.name)}</span>${tags}<span class="car">${esc(car)}</span>${st}${rm}</li>`;
  }
  function render() {
    const net = getNet(), room = net && net.room, you = net && net.you;
    const entry = document.getElementById('mpBtn'); if (entry) entry.textContent = room ? `Room ${room.code} · ${room.seats.length}/${room.maxSeats} · open` : 'Race friends · private room';
    if (!ui.open) return;
    let h = `<div class="sh"><span>Race friends</span><button class="chip" data-act="close" aria-label="Close multiplayer">Close</button></div>`;
    if (!room) {
      // busy until the room's welcome (or a failure clears the connection), not just until the HTTP create:
      // a second tap in that window used to allocate a second room and leave a socket in the first
      const busy = ui.busy || !!(net && net.status !== 'closed' && net.status !== 'idle');
      h += `<p class="lead">Private room for 2 to 4 racers. Bots can fill empty seats.</p>
        <label class="glbl" for="mpName">Your name</label><input id="mpName" class="tin" maxlength="16" autocomplete="nickname" placeholder="Player" value="${esc(name)}">
        <button class="btn mpbtn" data-act="create" ${busy ? 'disabled' : ''}>${busy ? 'Connecting…' : 'Create room'}</button>
        <div class="or">or join with a code</div>
        <div class="joinrow"><input id="mpCode" class="tin code" maxlength="${CODE_LEN + 2}" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ABC123" value="${esc(ui.codeIn)}" aria-label="Room code"><button class="btn mpbtn sm" data-act="join" ${busy ? 'disabled' : ''}>Join</button></div>`;
    } else {
      // in a room: sticky header (code, seats, copy, close) / scrolling body / sticky footer (ready, start, status)
      // so the code, seats and the main action stay visible on 390 px tall phones
      const host = room.hostId === you, me = room.seats.find(s => s.id === you), lobby = room.phase === 'lobby';
      const copied = ui.copied && Date.now() - ui.copied < 2500;
      h = `<div class="mphead"><div class="hc"><div class="glbl">Room code</div><div class="code" id="mpRoomCode">${esc(room.code)}</div></div>
        <span class="cnt" id="mpCount" title="Racers">${room.seats.length}/${room.maxSeats}${room.phase !== 'lobby' ? ' · ' + (room.phase === 'results' ? 'results' : 'racing') : ''}</span>
        <button class="chip" data-act="copylink">${copied ? 'Copied ✓' : 'Copy link'}</button><button class="chip" data-act="close" aria-label="Close room panel">Close</button></div>
        <div class="mpbody"><ul class="seats" id="mpSeats">${room.seats.map(s => seatRow(s, room, you)).join('')}${Array.from({ length: room.maxSeats - room.seats.length }, () => '<li class="empty">Open seat</li>').join('')}</ul>`;
      if (host && lobby) h += `<div class="hostrow"><button class="chip" data-act="addbot" ${room.seats.length >= room.maxSeats ? 'disabled' : ''}>Add bot</button><button class="chip" data-act="rmlastbot" ${room.seats.some(s => s.kind === 'bot') ? '' : 'disabled'}>Remove bot</button><button class="chip" data-act="copycode">Copy code</button></div>`;
      h += `<div class="glbl">Circuit${host ? '' : ' (host picks)'}</div><div class="seg" id="mpMaps">${MAP_KEYS.map(k => `<button class="${room.map === k ? 'on' : ''}" data-act="map" data-map="${k}" ${host && lobby ? '' : 'disabled'}>${MAPS[k].short}<small>${MAPS[k].laps} laps</small></button>`).join('')}</div>
        <div class="glbl">Driving mode (same for everyone)</div><div class="seg" id="mpModes">${[['assisted', 'Assisted'], ['expert', 'Expert']].map(([k, n]) => `<button class="${room.mode === k ? 'on' : ''}" data-act="mode" data-mode="${k}" ${host && lobby ? '' : 'disabled'}>${n}</button>`).join('')}</div>
        <p class="hint">Your car and paint come from the garage behind this panel.</p>
        <button class="ghost leave" data-act="leave">Leave room</button></div><div class="mpfoot">`;
      if (lobby && me) h += `<button class="btn mpbtn ${me.ready ? 'on' : ''}" data-act="ready">${me.ready ? 'Ready ✓ (tap to undo)' : "I'm ready"}</button>`;
      if (host && lobby) h += `<button class="btn mpbtn go" data-act="start" ${room.canStart ? '' : 'disabled'}>Start race</button><div class="why">${room.canStart ? 'Everyone is ready.' : esc(errorText(room.blocker))}</div>`;
      else if (lobby) h += `<div class="why">${room.canStart ? 'Waiting for the host to start.' : esc(errorText(room.blocker))}</div>`;
      if (room.phase === 'results' && host) h += `<button class="btn mpbtn" data-act="tolobby">Back to lobby now</button>`;
      else if (room.phase === 'results') h += `<div class="why">The host can return everyone to the lobby.</div>`;
      if (net.status === 'reconnecting') h += `<div class="warn">Connection lost, reconnecting…</div>`;
      if (ui.note) h += `<div class="note">${esc(ui.note)}</div>`;
      if (ui.err) h += `<div class="err" role="alert">${esc(ui.err)}</div>`;
      h += `<div class="portraitNote">Turn your phone sideways to race.</div></div>`;
      el.classList.add('inroom');
      return finish(h);
    }
    h += `<div class="portraitNote">Turn your phone sideways to race.</div>`;
    if (ui.note) h += `<div class="note">${esc(ui.note)}</div>`;
    if (ui.err) h += `<div class="err" role="alert">${esc(ui.err)}</div>`;
    el.classList.remove('inroom');
    finish(h);
  }
  function finish(h) {
    const focus = document.activeElement && document.activeElement.id, selS = focus && document.activeElement.selectionStart;
    const b0 = el.querySelector('.mpbody'), sc = b0 ? b0.scrollTop : 0;   // keep the scroll position across live updates
    el.innerHTML = h;
    const b1 = el.querySelector('.mpbody'); if (b1) b1.scrollTop = sc;
    if (focus && (focus === 'mpName' || focus === 'mpCode')) { const f = document.getElementById(focus); if (f) { f.focus(); try { f.setSelectionRange(selS, selS); } catch (e) { } } }
  }
  function joinLink(code) { return inviteLink(location.href, code); }   // the frontend page, never the backend
  async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); let ok = false; try { ok = document.execCommand('copy'); } catch (x) { } t.remove(); return ok; } }
  el.addEventListener('input', e => { if (e.target.id === 'mpName') saveName(e.target.value); if (e.target.id === 'mpCode') ui.codeIn = e.target.value; });
  el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.id === 'mpCode') act('join'); if (e.key === 'Escape') show(false); });
  el.addEventListener('keyup', e => e.stopPropagation());
  el.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) act(b.dataset.act, b.dataset); });
  async function act(a, d = {}) {
    const net = getNet(); ui.err = '';
    switch (a) {
      case 'close': show(false); return;
      case 'create': ui.busy = true; render(); try { await onCreate(name || 'Player'); } finally { ui.busy = false; } break;
      case 'join': { const c = normalizeCode(ui.codeIn); if (!validCode(c)) { ui.err = errorText('bad-code'); break; } ui.busy = true; render(); try { await onJoin(c, name || 'Player'); } finally { ui.busy = false; } break; }
      case 'copylink': if (net && net.room) { const ok = await copy(joinLink(net.room.code)); if (ok) ui.copied = Date.now(); else ui.note = joinLink(net.room.code); } break;
      case 'copycode': if (net && net.room) { const ok = await copy(net.room.code); ui.note = ok ? 'Code copied: ' + net.room.code : 'Copy failed. Room code: ' + net.room.code; } break;
      case 'addbot': net.addBot(); break;
      case 'rmbot': net.removeBot(d.bot); break;
      case 'rmlastbot': { const b = net.room.seats.filter(s => s.kind === 'bot').pop(); if (b) net.removeBot(b.id); break; }
      case 'map': net.config({ map: d.map }); break;
      case 'mode': net.config({ mode: d.mode }); break;
      case 'ready': { const me = net.me; net.ready(!(me && me.ready)); break; }
      case 'start': net.start(); break;
      case 'tolobby': net.toLobby(); break;
      case 'leave': onLeave(); break;
    }
    render();
  }
  return { show, render, get open() { return ui.open; }, setError(code) { ui.err = code ? errorText(code) : ''; render(); }, setNote(t) { ui.note = t || ''; render(); }, setCode(c) { ui.codeIn = c; render(); }, joinLink };
}
