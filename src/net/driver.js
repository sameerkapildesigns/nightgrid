// Scripted line-follower used by tests (headless clients and the test-build autodrive). Not an opponent AI
// and not shipped behaviour: production builds never enable it.
export function driveLine(pred, wob = 0) {
  const r = pred && pred.me; if (!r) return { up: 0, down: 0, left: 0, right: 0, boost: 0, drift: 0 };
  const kg = pred.sim.kgAt(r.path, r.s + 10 + r.speed * 0.3);
  const st = Math.max(-1, Math.min(1, (r.d - wob * 4) * 0.03 + r.psi * 3 - 30 * kg));
  return { up: 1, down: 0, right: st > 0 ? st : 0, left: st < 0 ? -st : 0, boost: r.meter > 0.6 ? 1 : 0, drift: 0 };
}
