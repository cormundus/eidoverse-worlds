// instruments — the browser realizer for the drum circle (design rev 5, §7):
// the folded `circle` and `instrument` bags (written only by circle-set and
// instrument-set; read here from the SHADOW STATE, client/lib/state.js — no
// `comp` bus event fires for them), the phrases others play, and the hitter's
// own pad.
//
// Rules:
//   1. ONE AudioContext and ONE world bus (worldbus.js): every voice ends in
//      the listener's `world volume`, the same path as `sound`.
//   2. The clock is the SERVER's. A step's server time becomes context time at
//      scheduling: ctxTime = ctx.currentTime + (stepServerMs − serverNow())/1000.
//   3. NEVER LATE. Steps wait in a queue and are handed to WebAudio only inside
//      a short window ahead (SCHEDULE_AHEAD_MS); a step whose time has passed is
//      SKIPPED, never shifted. Waiting in the queue is also what lets a step be
//      voided before it sounds: a leave, a tempo change's span end, a drum's
//      new voiceGen, a world reset.
//   4. Two events per live hit (§2.4): the hitter hears and sees the LOCAL
//      event at once; everyone else hears the SHARED event at the grid step.
//      The shared copy is never replayed to the hitter (the relay skips the
//      sender, and this module never schedules its own hit from a receipt).
//   5. The hitter always knows which of three states a hit is in: shared
//      (accepted), local only (refused, with the reason), or sharing unknown
//      (no receipt by the deadline — synced: the step's time + 1 s on
//      serverNow(); unsynced: the press + L + one step + 1 s on the local
//      clock). One retry with the same n is allowed; it never sounds twice.
//   6. Bounded polyphony per drum, oldest voice stolen; ONE panner per drum.
//   7. Teardown is total: a removed drum, an ended circle, `world-reset`.
//   8. Only the embodied `world` surface renders. The browser client never
//      joins as an aux leg (aux legs are other programs), so this holds by
//      construction here.
import { THREE, camera } from './core.js';
import { bus } from './base.js';
import { entities } from './world.js';
import { audioContext } from './audioctx.js';
import { worldGain } from './worldbus.js';
import { serverNow, clockSynced } from './remotes.js';
import { state, onWorldChange } from './state.js';
import { net, sendPhrase } from './net.js';
import { strike } from './drumsynth.js';
import { DRUM_POLICY, gridOf, stepTime, gridForGen, circleRunning, chooseLiveStep, sharingUnknownDeadline,
  newStruckWindow, noteStruck, describeCircle } from '../../shared/circle.js';

const SCHEDULE_AHEAD_MS = 200;     // the scheduling window (design: 100–300 ms)
const LATE_EPS_MS = 5;             // a step this far past is skipped, never played late
const PAD_RADIUS = 4;              // metres: the pad appears when you stand at a drum

const queue = [];                  // pending steps, by server time
const voices = new Map();          // instrument id → [{handle, t}]
const panners = new Map();         // instrument id → PannerNode
const windows = new Map();         // circle id → struck window
const hits = new Map();            // my live hits: n → record
let nextN = 1;
/** Counters for probes: what this page actually did with the steps it saw. */
const stats = { played: 0, local: 0, stolen: 0, skippedLate: 0, voided: 0, peakVoices: {} };
const _pos = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3();

const ents = () => state.st?.entities ?? {};
const circleOf = (id) => ents()[id]?.comp?.circle;
const instOf = (id) => ents()[id]?.comp?.instrument;

function pannerFor(voice) {
  let p = panners.get(voice);
  if (!p) {
    const ctx = audioContext();
    p = ctx.createPanner();
    p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 1.5; p.rolloffFactor = 1.5;
    p.maxDistance = instOf(voice)?.radius ?? 15;
    p.connect(worldGain());
    panners.set(voice, p);
  }
  return p;
}

/** A relayed phrase (someone else's) → steps in the queue. */
function enqueuePhrase(ph) {
  const c = circleOf(ph.circle), inst = instOf(ph.voice);
  const g = gridForGen(c, ph.gen);
  if (!g || !inst || inst.voiceGen !== ph.voiceGen) return;   // stale on arrival: nothing to play
  const { steps } = gridOf(g);
  const win = windows.get(ph.circle) ?? newStruckWindow();
  windows.set(ph.circle, win);
  noteStruck(win, ph, { steps });
  const now = serverNow();
  const base = { circle: ph.circle, voice: ph.voice, author: ph.author, legGen: ph.legGen, gen: ph.gen, voiceGen: ph.voiceGen };
  const push = (bar, s, stroke, vel) => {
    const t = stepTime(g, bar, s);
    if (t < now - LATE_EPS_MS) return;   // rule 3: never late
    queue.push({ ...base, t, stroke, vel });
  };
  if (ph.live) push(ph.bar, ph.step, ph.stroke, ph.velocity ?? 7);
  else {
    for (let i = 0; i < ph.pattern.length; i++) {
      const ch = ph.pattern[i];
      if (ch === '.') continue;
      push(ph.bar + Math.floor(i / steps), i % steps, ch, ph.velocity ? Number(ph.velocity[i]) : 7);
    }
  }
  queue.sort((a, b) => a.t - b.t);
}

/** Is a queued step still playable? (Not yet begun — rule 3's voiding.) */
function stillValid(q) {
  const c = circleOf(q.circle), inst = instOf(q.voice);
  if (!circleRunning(c) || !inst || inst.ended || inst.voiceGen !== q.voiceGen) return false;
  const g = gridForGen(c, q.gen);
  if (!g) return false;
  return g.until === undefined || q.t < g.until;   // a voice sounds only inside its own grid's span
}

function sound(voice, stroke, ctxWhen, vel) {
  const inst = instOf(voice);
  const s = inst?.strokes?.[stroke];
  if (!s) return;
  const ctx = audioContext();
  const list = voices.get(voice) ?? [];
  // rule 6: bounded polyphony, oldest stolen
  for (let i = list.length - 1; i >= 0; i--) if (list[i].handle.isDone() || list[i].handle.ends < ctx.currentTime) list.splice(i, 1);
  while (list.length >= (inst.polyphony ?? 8)) { list.shift().handle.stop(); stats.stolen++; }
  const peak = (vel / 9) * (s.gain ?? 1) * (inst.volume ?? 0.8);
  list.push({ handle: strike(ctx, s, ctxWhen, peak, pannerFor(voice)), t: ctxWhen });
  voices.set(voice, list);
  stats.peakVoices[voice] = Math.max(stats.peakVoices[voice] ?? 0, list.length);
  flash(voice, ctxWhen);
}

/** Visible strikes: a short pulse above the drum at the strike's time. */
const flashGeo = new THREE.SphereGeometry(0.08, 8, 6);
const flashMat = new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9 });
function flash(voice, ctxWhen) {
  const delay = Math.max(0, (ctxWhen - audioContext().currentTime) * 1000);
  setTimeout(() => {
    const root = entities.get(voice);
    if (!root) return;
    const m = new THREE.Mesh(flashGeo, flashMat);
    m.position.set(0, 1.1, 0);
    root.add(m);
    setTimeout(() => { root.remove(m); }, 120);
  }, delay);
}

/** Per-frame (registerSystem 'instruments'): listener, panners, the window. */
export function tickInstruments() {
  if (!queue.length && !panners.size && !hits.size) return;
  const ctx = audioContext();
  const now = serverNow();
  // the listener follows the camera (the same math as sounds.js tickSounds)
  const L = ctx.listener;
  camera.getWorldPosition(_pos); camera.getWorldDirection(_fwd); _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  if (L.positionX) {
    L.positionX.value = _pos.x; L.positionY.value = _pos.y; L.positionZ.value = _pos.z;
    L.forwardX.value = _fwd.x; L.forwardY.value = _fwd.y; L.forwardZ.value = _fwd.z;
    L.upX.value = _up.x; L.upY.value = _up.y; L.upZ.value = _up.z;
  }
  for (const [voice, p] of panners) {
    const root = entities.get(voice);
    if (!root) continue;
    root.getWorldPosition(_pos);
    if (p.positionX) { p.positionX.value = _pos.x; p.positionY.value = _pos.y; p.positionZ.value = _pos.z; }
  }
  // hand steps inside the window to WebAudio; skip the late; void the invalid
  while (queue.length && queue[0].t <= now + SCHEDULE_AHEAD_MS) {
    const q = queue.shift();
    if (q.t < now - LATE_EPS_MS || ctx.state !== 'running') { stats.skippedLate++; continue; }
    if (!stillValid(q)) { stats.voided++; continue; }
    sound(q.voice, q.stroke, ctx.currentTime + (q.t - now) / 1000, q.vel);
    stats.played++;
  }
  // rule 5: deadlines for my hits
  for (const h of hits.values()) {
    if (h.state !== 'pending') continue;
    const due = h.deadline.clock === 'server' ? serverNow() >= h.deadline.at : performance.now() >= h.deadline.at;
    if (!due) continue;
    if (!h.retried) { h.retried = true; sendPhrase(h.msg); h.deadline = deadlineFor(h); continue; }   // one retry, same n
    h.state = 'unknown'; h.label = 'sharing unknown'; render();
  }
}

function deadlineFor(h) {
  return sharingUnknownDeadline({ synced: h.synced, scheduledAtServerMs: h.scheduledAt,
    pressedAtLocalMs: performance.now(), stepMs: h.stepMs });
}

/** A press on the pad: the LOCAL event now, the shared one through the server. */
export function press(voice, stroke) {
  const inst = instOf(voice);
  const circleId = inst?.circle;
  const c = circleOf(circleId);
  if (!inst || !circleRunning(c)) return null;
  const ctx = audioContext();
  sound(voice, stroke, ctx.currentTime, 7);   // rule 4: the hitter hears their own hand at once
  stats.local++;
  const synced = clockSynced();
  const n = nextN++;
  const base = { live: true, circle: circleId, voice, voiceGen: inst.voiceGen, stroke, n };
  let msg, scheduledAt = null, stepMs;
  if (synced) {
    const sel = chooseLiveStep(c, serverNow());
    const g = gridForGen(c, sel.gen);
    stepMs = gridOf(g).stepMs;
    scheduledAt = g.t0 + sel.step * stepMs;
    msg = { ...base, gen: sel.gen, step: sel.step };
  } else {
    stepMs = gridOf(c).stepMs;
    msg = { ...base, gen: c.gen, step: 'next' };
  }
  const h = { n, msg, synced, scheduledAt, stepMs, pressServer: serverNow(), state: 'pending', label: 'sending…', retried: false };
  h.deadline = deadlineFor(h);
  hits.set(n, h);
  if (!sendPhrase(msg)) { h.state = 'local'; h.label = 'local only — not shared: not connected'; }
  while (hits.size > 32) hits.delete(hits.keys().next().value);
  render();
  return n;
}

bus.on('phrase', (ph) => { if (ph.author !== net.myId) enqueuePhrase(ph); });
bus.on('phrase-receipt', (r) => {
  const h = hits.get(r.n);
  if (!h || (h.state !== 'pending' && h.state !== 'unknown')) return;
  if (r.ok) {
    h.state = 'shared';
    const own = r.scheduledAtServerMs - h.pressServer;   // the SENDER's own measurement, never the server's claim
    h.label = `in the circle at bar ${r.bar} step ${r.step} (+${Math.round(own)} ms from your press, your own measurement${r.basis === 'arrival' ? '; placed by arrival' : ''})`;
    const win = windows.get(h.msg.circle) ?? newStruckWindow();
    windows.set(h.msg.circle, win);
    const g = gridForGen(circleOf(h.msg.circle), r.gen);
    if (g) noteStruck(win, { ...h.msg, bar: r.bar, step: r.step, author: net.myId }, { steps: gridOf(g).steps, mine: true });
  } else {
    h.state = 'local';
    h.label = `local only — not shared: ${r.why}`;
  }
  render();
});
// a leave drops ONLY that leg's not-yet-begun steps (§4.4); no gen = every leg
bus.on('leave', ({ id, gen }) => {
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].author === id && (gen === undefined || queue[i].legGen === gen)) queue.splice(i, 1);
});
bus.on('entity', ({ id, kind }) => { if (kind === 'remove') dropVoice(id); });
bus.on('world-reset', () => clearInstruments());
onWorldChange((ev) => { if (ev.type === 'reset' || ev.type === 'hydrated') { queue.length = 0; windows.clear(); } });

function dropVoice(id) {
  for (const v of voices.get(id) ?? []) v.handle.stop();
  voices.delete(id);
  const p = panners.get(id);
  if (p) { try { p.disconnect(); } catch { /* gone */ } panners.delete(id); }
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].voice === id) queue.splice(i, 1);
}
/** Rule 7: nothing left behind — voices, nodes, panners, queue, windows. */
export function clearInstruments() {
  for (const id of [...new Set([...voices.keys(), ...panners.keys()])]) dropVoice(id);
  queue.length = 0; windows.clear(); hits.clear(); render();
}

// ---- the pad: the hitter's drum, and what it knows -------------------------------
let padEl = null, padVoice = null;
function nearestDrum() {
  camera.getWorldPosition(_pos);
  let best = null, bestD = PAD_RADIUS;
  for (const [id, e] of Object.entries(ents())) {
    const inst = e?.comp?.instrument;
    if (!inst || inst.ended || !circleRunning(circleOf(inst.circle))) continue;
    const root = entities.get(id);
    if (!root) continue;
    const d = root.getWorldPosition(new THREE.Vector3()).distanceTo(_pos);
    if (d < bestD) { best = id; bestD = d; }
  }
  return best;
}
function render() {
  if (typeof document === 'undefined') return;
  const voice = padVoice;
  if (!voice) { if (padEl) padEl.style.display = 'none'; return; }
  if (!padEl) {
    padEl = document.createElement('div');
    padEl.id = 'ew-drum-pad';
    padEl.style.cssText = 'position:fixed;right:12px;bottom:84px;z-index:30;max-width:430px;padding:10px 12px;border-radius:10px;background:rgba(20,16,12,.86);color:#f3e6d2;font:12px/1.35 ui-monospace,monospace;white-space:pre-wrap';
    document.body.appendChild(padEl);
  }
  padEl.style.display = 'block';
  const inst = instOf(voice), c = circleOf(inst?.circle);
  const letters = Object.keys(inst?.strokes ?? {});
  const text = describeCircle(c, Object.fromEntries(Object.entries(ents()).map(([k, e]) => [k, e?.comp?.instrument]).filter(([, v]) => v)),
    windows.get(inst?.circle), { now: serverNow() });
  const recent = [...hits.values()].slice(-5).reverse().map((h) => `${h.msg.stroke}  ${h.label}`).join('\n');
  padEl.innerHTML = '';
  const head = document.createElement('div'); head.textContent = `${inst?.name ?? voice} — strike:`; padEl.appendChild(head);
  for (const L of letters) {
    const b = document.createElement('button');
    b.textContent = L; b.dataset.stroke = L;
    b.style.cssText = 'margin:4px 6px 6px 0;padding:6px 12px;font:600 14px ui-monospace,monospace;cursor:pointer';
    b.onclick = () => press(voice, L);
    padEl.appendChild(b);
  }
  const g = document.createElement('div'); g.textContent = text; g.style.marginTop = '4px'; padEl.appendChild(g);
  if (recent) { const r = document.createElement('div'); r.textContent = `your hits:\n${recent}`; r.style.marginTop = '6px'; padEl.appendChild(r); }
}
let padTick = 0;
/** Slower system: find the drum you stand at, and refresh the pad text. */
export function tickPad() {
  const v = nearestDrum();
  if (v !== padVoice || ++padTick % 15 === 0) { padVoice = v; render(); }
}

/** For probes (tools/drum-probe.mjs): state, and the press. */
export const _drums = {
  queue, voices, panners, hits, windows, press, clearInstruments, stats,
  activeVoices: (id) => (voices.get(id) ?? []).filter((v) => !v.handle.isDone() && v.handle.ends >= audioContext().currentTime).length,
  describe: (circleId) => describeCircle(circleOf(circleId), {}, windows.get(circleId), { now: serverNow() }),
  setPad: (voice) => { padVoice = voice; render(); },
};
