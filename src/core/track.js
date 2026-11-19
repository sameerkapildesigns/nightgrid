// NIGHTGRID track generator (pure JS, no DOM / no Three.js). Moved verbatim from v5b game.html.
export const TRK = (() => {
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const clampN = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  function frameOf(psi, th, phi) {
    const T = [Math.cos(th) * Math.sin(psi), Math.sin(th), Math.cos(th) * Math.cos(psi)];
    const U0 = [-Math.sin(th) * Math.sin(psi), Math.cos(th), -Math.sin(th) * Math.cos(psi)];
    const R0 = cross(T, U0);
    const U = norm(sub(mul(U0, Math.cos(phi)), mul(R0, Math.sin(phi))));
    return { T, U };
  }
  // integrate pieces; returns raw samples (dense, 0.25 m)
  function turtle(pieces, st) {
    let p = st.p.slice(), psi = st.psi, th = st.th || 0, phi = st.phi || 0;
    const out = [];
    for (const pc of pieces) {
      const n = Math.max(1, Math.ceil(pc.len / 0.25)), ds = pc.len / n;
      const f0 = frameOf(psi, th, phi);
      const sideH = norm([f0.T[2] * -1, 0, f0.T[0]]); // horizontal right-ish for shifts
      let shiftDone = 0;
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n, r = (1 - Math.cos(2 * Math.PI * u)) / n;
        psi += (pc.yaw || 0) * r; th += (pc.pitch || 0) * r; phi += (pc.roll || 0) * r;
        const f = frameOf(psi, th, pc.bank == null ? phi : pc.bank * Math.sin(Math.PI * u) ** 2);
        p = add(p, mul(f.T, ds));
        if (pc.shift) { const S = (u2) => u2 - Math.sin(2 * Math.PI * u2) / (2 * Math.PI); const want = pc.shift * S((k + 1) / n); p = add(p, mul(sideH, (want - shiftDone))); shiftDone = want; }
        out.push({ p: p.slice(), U: f.U, sec: pc.sec, w: pc.w, tag: pc.tag || 0 });
      }
      if (Math.abs(th - Math.PI) < 0.02 && Math.abs(Math.abs(phi) - Math.PI) < 0.02) { psi += Math.PI; th = 0; phi = 0; }
      if (Math.abs(th) < 1e-3) { phi = Math.atan2(Math.sin(phi), Math.cos(phi)); if (Math.abs(phi) < 1e-3) phi = 0; }
    }
    return { out, end: { p, psi, th, phi } };
  }
  // cubic bezier connector between frames; U blended
  function connector(p0, T0, U0, p1, T1, U1, sec, w, tag, handle = 0.38, rollTurns = 0) {
    const D = len(sub(p1, p0)) * handle;
    const c1 = add(p0, mul(T0, D)), c2 = sub(p1, mul(T1, D));
    const B = t => { const it = 1 - t; return add(add(mul(p0, it * it * it), mul(c1, 3 * it * it * t)), add(mul(c2, 3 * it * t * t), mul(p1, t * t * t))); };
    const dense = []; let L = 0, prev = p0;
    for (let i = 0; i <= 4000; i++) { const t = i / 4000, q = B(t); L += len(sub(q, prev)); dense.push([t, L, q]); prev = q; }
    const n = Math.ceil(L / 0.25), out = []; let j = 0;
    for (let k = 1; k <= n; k++) {
      const target = k / n * L; while (j < dense.length - 1 && dense[j + 1][1] < target) j++;
      const a = dense[j], b = dense[Math.min(j + 1, dense.length - 1)];
      const f = b[1] > a[1] ? (target - a[1]) / (b[1] - a[1]) : 0;
      const t = a[0] + (b[0] - a[0]) * f, q = lerp3(a[2], b[2], f);
      const s = t * t * (3 - 2 * t);
      let U = lerp3(U0, U1, s);
      if (rollTurns) { // twist around tangent
        const tt = norm(sub(B(Math.min(1, t + 1e-3)), B(Math.max(0, t - 1e-3))));
        const ang = rollTurns * 2 * Math.PI * (t - Math.sin(2 * Math.PI * t) / (2 * Math.PI));
        const Rr = cross(tt, U); U = add(mul(U, Math.cos(ang)), mul(Rr, -Math.sin(ang)));
      }
      out.push({ p: q, U: norm(U), sec, w, tag });
    }
    return { out, L };
  }
  // resample dense samples to 1 m, compute frames
  function finalize(dense, closed) {
    // exact arc-length resampling
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + len(sub(dense[i].p, dense[i - 1].p)));
    const Ld = cum[cum.length - 1] + (closed ? len(sub(dense[0].p, dense[dense.length - 1].p)) : 0);
    const Nn = closed ? Math.round(Ld) : Math.round(cum[cum.length - 1]) + 1;
    const ds = closed ? Ld / Nn : cum[cum.length - 1] / (Nn - 1);
    const pts = []; let j = 0;
    for (let k = 0; k < Nn; k++) {
      const target = k * ds;
      while (j < dense.length - 2 && cum[j + 1] < target) j++;
      if (closed && target > cum[cum.length - 1]) { pts.push(dense[dense.length - 1]); continue; }
      const f = cum[j + 1] > cum[j] ? clampN((target - cum[j]) / (cum[j + 1] - cum[j])) : 0;
      const A = dense[j], B = dense[j + 1];
      pts.push({ p: lerp3(A.p, B.p, f), U: norm(lerp3(A.U, B.U, f)), sec: f < 0.5 ? A.sec : B.sec, w: f < 0.5 ? A.w : B.w, tag: f < 0.5 ? A.tag : B.tag });
    }
    const N = pts.length;
    const P = pts.map(s => s.p), T = [], U = [], R = [], sec = [], W = [], tag = [];
    for (let i = 0; i < N; i++) {
      const a = closed ? P[(i - 1 + N) % N] : P[Math.max(0, i - 1)], b = closed ? P[(i + 1) % N] : P[Math.min(N - 1, i + 1)];
      const t = norm(sub(b, a)); T.push(t);
      let u = pts[i].U; u = norm(sub(u, mul(t, dot(u, t)))); U.push(u); R.push(norm(cross(t, u)));
      sec.push(pts[i].sec); W.push(pts[i].w); tag.push(pts[i].tag);
    }
    // smooth U a little to kill tiny kinks
    for (let pass = 0; pass < 2; pass++) {
      const U2 = U.map((u, i) => { let s = [0, 0, 0]; for (let j = -3; j <= 3; j++) { const k = closed ? (i + j + N) % N : Math.min(N - 1, Math.max(0, i + j)); s = add(s, U[k]); } s = norm(sub(s, mul(T[i], dot(s, T[i])))); return s; });
      for (let i = 0; i < N; i++) { U[i] = U2[i]; R[i] = norm(cross(T[i], U[i])); }
    }
    // smooth widths
    const W2 = W.map((w, i) => { let s = 0, c = 0; for (let j = -30; j <= 30; j++) { const k = closed ? (i + j + N) % N : Math.min(N - 1, Math.max(0, i + j)); s += W[k]; c++; } return s / c; });
    // curvatures: geodesic (yaw in surface plane, + = left) and normal (+ = concave/compression)
    const KG = new Float32Array(N), KN = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const a = closed ? T[(i - 1 + N) % N] : T[Math.max(0, i - 1)], b = closed ? T[(i + 1) % N] : T[Math.min(N - 1, i + 1)];
      const dT = mul(sub(b, a), 0.5 / ds);
      KG[i] = -dot(dT, R[i]); KN[i] = dot(dT, U[i]);
    }
    return { N, P, T, U, R, sec, W: W2, tag, KG, KN, closed, ds };
  }

  // ---------------- layout ----------------
  // sectors: 0 MONZA, 1 EAU ROUGE, 2 SUZUKA, 3 MONACO, 4 PARABOLICA
  const W0 = 12, WM = 8.5, WB = 8;
  const TUNNEL = 1, NORAIL = 2, LANE = 4;
  function build(prm = {}) {
    const Q = Object.assign({ lm: 236, ls: 200, ky: 0.7, sy: -1.6, kl: 192, py: -2.061 }, prm);
    const PI = Math.PI;
    const pc = [], marks = {};
    const S = (len, o = {}) => pc.push(Object.assign({ len, sec: cur.sec, w: cur.w }, o));
    const cur = { sec: 0, w: W0 };
    // ---- MONZA ----
    S(Q.lm);
    S(55, { yaw: -1.25 }); S(30); S(55, { yaw: 1.25 });          // tight chicane (right-left)
    S(25); S(30, { pitch: 0.12 }); S(30, { pitch: -0.24 }); S(30, { pitch: 0.12 }); S(25);   // the kink: a crest that throws you airborne
    // ---- EAU ROUGE ----
    cur.sec = 1;
    S(110, { yaw: 0.5, roll: 0.15, bank: prm.inwardBanks ? 0.15 : undefined }); S(110, { yaw: -0.5, roll: -0.15, bank: prm.inwardBanks ? -0.15 : undefined });  // local inward bank, no inherited outward half
    S(70);
    S(230, { pitch: PI });                                         // climb the wall, tip over -> inverted
    S(300, { yaw: 0.0 });                                          // upside down over the city
    S(150, { roll: PI });                                          // roll back upright (normalizes)
    // KEMMEL descent
    S(90, { pitch: -0.32, yaw: Q.ky });
    S(Q.kl, { yaw: Q.ky });
    S(90, { pitch: 0.32, yaw: Q.ky * 0.7 });
    S(60);
    // ---- SUZUKA ----
    cur.sec = 2;
    S(80, { yaw: 0.7, roll: 0.3, bank: prm.inwardBanks ? 0.3 : undefined }); S(100, { yaw: -1.1, roll: -0.6, bank: prm.inwardBanks ? -0.3 : undefined }); S(80, { yaw: 0.6, roll: 0.3, bank: prm.inwardBanks ? 0.3 : undefined });
    S(Q.ls);
    S(100, { yaw: PI / 2, pitch: 0.17, roll: 0.75 });              // banked spiral climbing
    S(100, { yaw: PI / 2 });
    S(100, { yaw: PI / 2, pitch: -0.17, roll: -0.75 });
    S(104, { roll: 2 * PI });                                      // corkscrew: inverted over the crossover
    S(70, { pitch: -0.2 }); S(100); S(70, { pitch: 0.2 });
    S(120, { yaw: Q.sy, roll: -0.3 });
    // ---- MONACO ----
    cur.sec = 3; cur.w = WM;
    if(prm.fastMonaco){
      cur.w=W0;
      S(60,{roll:.3});
      S(160,{yaw:-.65});S(180,{yaw:1.3});S(160,{yaw:-.65});
      S(90);
    }else{
    S(50, { roll: 0.3, tag: TUNNEL });
    S(60, { yaw: -PI / 2, tag: TUNNEL });
    S(70, { tag: TUNNEL });
    S(95, { yaw: PI, tag: TUNNEL });                               // hairpin
    S(70, { tag: TUNNEL });
    S(60, { yaw: -PI / 2, tag: TUNNEL });
    S(40, { yaw: 0.6, tag: TUNNEL }); S(40, { yaw: -0.6, tag: TUNNEL }); // swimming-pool flick
    S(30, { tag: TUNNEL });
    }
    // ---- PARABOLICA ----
    cur.sec = 4; cur.w = W0;
    S(30);
    S(100, { tag: LANE });                                          // lane opens on the right
    marks.fork = pc.reduce((a, p) => a + p.len, 0);
    S(110, { yaw: 1.4 }); S(110); S(200, { yaw: -2.8 }); S(110); S(110, { yaw: 1.4 });   // the long way round
    marks.merge = pc.reduce((a, p) => a + p.len, 0);
    S(90, { tag: LANE });
    S(230, { yaw: Q.py, roll: -0.18 });                         // Parabolica
    S(40, { roll: 0.18 });
    const t = turtle(pc, { p: [0, 0, 0], psi: 0 });
    return { t, pieces: pc, marks };
  }
  function assemble(prm) {
    const { t, marks } = build(prm);
    // close main loop with a connector to the origin
    const e = t.end, fe = frameOf(e.psi, e.th, e.phi);
    const con = connector(e.p, fe.T, fe.U, [0, 0, 0], [0, 0, 1], [0, 1, 0], 0, W0, 0, 0.35);
    const main = finalize([{ p: [0, 0, 0], U: [0, 1, 0], sec: 0, w: W0, tag: 0 }].concat(t.out, con.out.slice(0, -1)), true);
    main.marks = marks;
    // ---- shortcut branch (right-hand lane at the fork, rejoins at merge) ----
    const sA = Math.round(marks.fork), sB = Math.round(marks.merge) + 70, off = W0 + WB;
    const p0 = add(main.P[sA], mul(main.R[sA], off));
    const T0 = main.T[sA];
    const psi0 = Math.atan2(T0[0], T0[2]);
    const bp = [
      { len: 30, sec: 4, w: WB, tag: NORAIL },
      { len: 350, pitch: 2 * Math.PI, shift: 19, sec: 4, w: WB, tag: NORAIL },
      { len: 25, sec: 4, w: WB, tag: NORAIL }
    ];
    const bt = turtle(bp, { p: p0, psi: psi0 });
    const be = bt.end, bf = frameOf(be.psi, be.th, be.phi);
    const p1 = add(main.P[sB], mul(main.R[sB], off));
    const bc = connector(be.p, bf.T, bf.U, p1, main.T[sB], main.U[sB], 4, WB, NORAIL, 0.4);
    const branch = finalize([{ p: p0, U: main.U[sA], sec: 4, w: WB, tag: NORAIL }].concat(bt.out, bc.out), false);
    branch.sA = sA; branch.sB = sB; branch.off = off;
    return { main, branch };
  }
  // separate circuits: closed loop from a piece list; closure is solved offline so the seam needs no connector
  function assembleCustom(pieces) {
    const t = turtle(pieces, { p: [0, 0, 0], psi: 0 }), W = pieces[0].w;
    let out = t.out; while (out.length && len(out[out.length - 1].p) < 0.6) out = out.slice(0, -1);
    const e = t.end, fe = frameOf(e.psi, e.th, e.phi);
    if (len(e.p) > 3) { const con = connector(e.p, fe.T, fe.U, [0, 0, 0], [0, 0, 1], [0, 1, 0], pieces[pieces.length - 1].sec, W, 0, 0.35); out = out.concat(con.out.slice(0, -1)); }
    const main = finalize([{ p: [0, 0, 0], U: [0, 1, 0], sec: 0, w: W, tag: 0 }].concat(out), true);
    main.marks = {}; return { main, branch: null };
  }
  const PI = Math.PI, H = PI / 2;
  function mk(list, w) { return list.map(([len, o = {}, sec = 0, ww = w]) => Object.assign({ len, sec, w: ww }, o)); }
  const DEFS = {
    // HIGH-SPEED: wide, four big banked sweepers (r_min > 110 m), crest, S-kink, vertical loop, barrel roll. No hairpins.
    velocity: () => mk([
      [360, {}, 0],                                   // 0 start straight (solver)
      [380, { yaw: H, roll: 0.5 }, 0],                // C1 banked sweeper
      [300, {}, 0],                                   // 2 (solver)
      [130, { pitch: 0.09 }, 0], [130, { pitch: -0.18 }, 0], [130, { pitch: 0.09 }, 0],   // fast crest
      [260, { yaw: -0.8, roll: -0.3 }, 0], [260, { yaw: 0.8, roll: 0.3 }, 0],       // flat-out S-kink
      [400, { yaw: H, roll: 0.6 }, 1],                // C2
      [682, {}, 1],
      [360, { pitch: 2 * PI, shift: 26 }, 1],         // SKY LOOP
      [150, {}, 1],
      [440, { yaw: H, roll: 0.7 }, 1],                // C3 steep carousel
      [116, {}, 2],
      [260, { yaw: 0.7, roll: 0.3 }, 2], [260, { yaw: -0.7, roll: -0.3 }, 2],
      [150, {}, 2],
      [250, { roll: 2 * PI }, 2],                     // BARREL ROLL
      [150, {}, 2],
      [400, { yaw: H, roll: 0.5 }, 2],                // C4
      // final straight (300 m): unwind the +2.3 rad of corner bank that C1-C4 accumulate (v5b left it, so the road sat at
      // ~132 deg bank here and snapped upright across the seam at 21 deg/m). Roll changes U only: positions,
      // lap length and closure are unchanged. M7 fix; tests/unit/track-continuity.test.mjs.
      // unwind (peak 1.2 deg/m), then 80 m level into the line. shift closes v5b's 0.142 m lateral closure residual
      // (was a 4 deg/m heading kink at the line that made Assisted/AI lift ~40-70 km/h before the finish).
      [220, { roll: -2.3 }, 2], [80, { shift: -0.1417 }, 2],
    ], 14),
    // TECHNICAL: narrow, heavy brake zones, chicanes, a 180° hairpin complex, esses. Deliberately slow rhythm.
    technical: () => mk([
      [187, {}, 0],                                   // 0 start straight / brake zone (solved)
      [62, { yaw: H }, 0],                            // T1 heavy brake 90°
      [373, {}, 0],                                   // 2 (solved)
      [34, { yaw: 0.95 }, 0], [16, {}, 0], [34, { yaw: -0.95 }, 0],   // chicane
      [150, {}, 0],
      [92, { yaw: H, roll: 0.1 }, 1],                 // T2 medium
      [150, { pitch: 0.06 }, 1], [150, { pitch: -0.12 }, 1], [150, { pitch: 0.06 }, 1],           // rise & fall
      [76, { yaw: PI }, 1],                           // HAIRPIN 180°
      [100, {}, 1],
      [60, { yaw: -H }, 1],                           // right-hander
      [150, {}, 2],
      [46, { yaw: -0.85 }, 2], [46, { yaw: 1.7 }, 2], [46, { yaw: -0.85 }, 2],   // esses
      [140, {}, 2],
      [34, { yaw: 0.85 }, 2], [16, {}, 2], [34, { yaw: -0.85 }, 2],   // last chicane
      [90, {}, 2],
      [84, { yaw: H }, 2],                            // T-last onto main straight
      [100, { shift: -0.2695 }, 2],                   // M7: closes v5b's 0.27 m lateral closure residual (7.9 deg/m kink at the line)
    ], 10.5),
  };
  
  
  return { DEFS, assemble, assembleCustom, turtle, connector, finalize, build, frameOf, W0, WM, WB, TUNNEL, NORAIL, LANE, v: { add, sub, mul, dot, cross, len, norm } };
})();
