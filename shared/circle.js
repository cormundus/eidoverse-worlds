// circle — what the drum circle's two verbs MEAN, and the bags they fold into.
// Shared verbatim between the sequencer (the door and the fold), the browser,
// and the mcpl agent, so no two of them can disagree about a grid or a drum.
//
//   circle-set {id, op: "start", bpm, meter, subdivision, countIn?, look?}
//   circle-set {id, op: "change", bpm?, meter?, subdivision?, lead?}
//   circle-set {id, op: "end"}
//   instrument-set {id, circle, name, synth, strokes, polyphony?, volume?, radius?, look?}
//   instrument-set {id, end: true}
//
// fold into the entity's comp bag, SERVER-WRITTEN (a client's `comp {type:
// "circle"|"instrument"}` is refused by the door AND the fold, the captions
// precedent):
//
//   comp.circle = {t0, bpm, meter, subdivision, gen, countIn, initiator, look?,
//                  prev?: {t0, bpm, meter, subdivision, gen, until}, ended?: true}
//   comp.instrument = {circle, name, synth, strokes, polyphony, volume, radius,
//                      voiceGen, look?, ended?: true}
//
// The design is DESIGN-instruments rev 5 (approved privately by Mica,
// 2026-10-01); section numbers below refer to it. Rung zero: one circle, two
// drums. A PROTOCOL AMENDMENT (AGENTS.md: "New verbs are protocol
// amendments"), proposed on the fork only and not house vocabulary until the
// house's reviewers rule on it.
//
// WHO STAMPS WHAT. The DOOR (the verb's validator, server-side) stamps the
// server-owned fields: a circle's `t0` and `gen` and `initiator`, an
// instrument's `voiceGen`. Any value a client sends for them is dropped. The
// FOLD reads those stamps back from the entry and refuses an entry whose
// generation is not exactly the successor of the folded one, so a hand-edited
// log stays total (the caption precedent, fold.js). The fold never reads the
// clock and never reads policy: a log folds the same on every machine, under
// any provisional constants.
//
// TIME. Every time here is SERVER time in ms. The door stamps `t0` from the
// server's own clock; clients convert with serverNow(). No client's
// Date.now() is ever circle authority (the clock amendment, 2026-10-05).

/** PROVISIONAL_TEST_VALUE — every number here is a proposal, executable so
 *  the scratch specimen can run, and NOTHING here is house policy. The
 *  decision belongs to antra-tess and Ra, from the A3 measurements (§10 Q5;
 *  Mica's standing, 2026-10-05: "label them PROVISIONAL_TEST_VALUE, keep them
 *  in one policy location"). This object is that one location. Changing a
 *  value changes what the DOOR accepts and stamps; it never changes the
 *  protocol's shapes or what the fold does with an entry. */
export const DRUM_POLICY = Object.freeze({
  status: 'PROVISIONAL_TEST_VALUE',
  L_MS: 150,             // lookahead margin: "next" lands at least this far after acceptance
  F_MS: 50,              // delivery floor: a named bar or step must begin at least this far after acceptance
  H_BARS: 16,            // horizon: a phrase's last bar ≤ currentBar + H; a tempo change's minimum lead
  PHRASE_RATE_PER_S: 16, // per-leg phrase budget, refused WITH a receipt
  RECEIPT_WINDOW: 64,    // stored receipts per (leg, circle), for idempotent resends
  QUIET_MS: 60_000,      // perception only: a circle unstruck this long after its last step is "quiet" (§5's one line per window)
});

export const BPM_MIN = 40, BPM_MAX = 240;
export const METER_MIN = 2, METER_MAX = 12;
export const SUBDIVISION_MIN = 1, SUBDIVISION_MAX = 8;
export const COUNT_IN_MIN = 1, COUNT_IN_MAX = 4, COUNT_IN_DEFAULT = 1;
export const LEAD_MAX = 256;
export const LOOK_MAX = 200;
export const NAME_MAX = 32;
export const ID_MAX = 64;

/** The synthesis algorithms this build knows (§6). A bag naming any other
 *  fails CLOSED: refused at the door, folded to nothing. */
export const KNOWN_SYNTHS = Object.freeze(['drum-v1']);

/** One stroke of `drum-v1` (§6): a sine swept f0 → f0/drop over dropMs, plus
 *  `noise` through a lowpass at `cutoff`, under an exponential decay. */
export const STROKE_RANGES = Object.freeze({
  f0: [20, 2000], drop: [1, 16], dropMs: [1, 2000], decayMs: [10, 5000],
  noise: [0, 1], cutoff: [50, 20000], gain: [0, 2],
});
export const STROKE_REQUIRED = Object.freeze(['f0', 'drop', 'dropMs', 'decayMs', 'noise', 'cutoff']);
export const POLYPHONY_DEFAULT = 8, POLYPHONY_MAX = 32;
export const VOLUME_DEFAULT = 0.8;
export const RADIUS_DEFAULT = 15, RADIUS_MAX = 100;

const isInt = (n) => Number.isInteger(n);
const inRange = (n, [lo, hi]) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const cleanText = (s, max) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, max) : undefined);
const cleanId = (s) => String(s ?? '').slice(0, ID_MAX);

// ---- grid math (§3) -------------------------------------------------------

/** The grid's derived lengths. `bpm 90, meter 4, subdivision 4` → step
 *  166.67 ms, bar 2,666.67 ms, 16 steps. */
export function gridOf(g) {
  const steps = g.meter * g.subdivision;
  const stepMs = 60000 / g.bpm / g.subdivision;
  return { steps, stepMs, barMs: steps * stepMs };
}
/** Server time at which bar `b` (step 0) begins. Bars count from the grid's
 *  own t0, so a new grid's bar numbers restart at 0 (§2.1). */
export const barStart = (g, b) => g.t0 + b * gridOf(g).barMs;
/** Server time of bar `b`, step `s`. */
export const stepTime = (g, b, s) => barStart(g, b) + s * gridOf(g).stepMs;
/** The bar sounding at server time `t`. NEGATIVE before the grid's t0 — a
 *  pending grid's current bar is negative during a change's lead, and it must
 *  NEVER be clamped to 0: that would silently widen the horizon (Mica, rev-5
 *  approval, carried as IMPLEMENTATION-CARRY note 6). */
export const barAt = (g, t) => Math.floor((t - g.t0) / gridOf(g).barMs);

// ---- circle-set: shape, door, fold ----------------------------------------

/** Shape only: drops anything the client may not author (t0, gen,
 *  initiator, prev, ended). Resolves {ok, args} or {ok: false, why}. */
export function normalizeCircleSetArgs(a) {
  const want = 'circle-set wants {id, op: "start", bpm, meter, subdivision, countIn?, look?}, {id, op: "change", bpm?, meter?, subdivision?, lead?} or {id, op: "end"}';
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, why: want };
  const id = cleanId(a.id);
  if (!id) return { ok: false, why: 'circle-set wants an entity id' };
  const op = a.op;
  if (op === 'end') return { ok: true, args: { id, op } };
  if (op !== 'start' && op !== 'change') return { ok: false, why: want };
  const args = { id, op };
  for (const [k, lo, hi] of [['bpm', BPM_MIN, BPM_MAX], ['meter', METER_MIN, METER_MAX], ['subdivision', SUBDIVISION_MIN, SUBDIVISION_MAX]]) {
    if (a[k] === undefined) { if (op === 'start') return { ok: false, why: `circle-set start wants ${k}` }; continue; }
    if (k === 'bpm' ? !inRange(a[k], [lo, hi]) : !(isInt(a[k]) && a[k] >= lo && a[k] <= hi)) {
      return { ok: false, why: `${k} must be ${k === 'bpm' ? 'a number' : 'an integer'} from ${lo} to ${hi}` };
    }
    args[k] = a[k];
  }
  if (op === 'start') {
    const ci = a.countIn ?? COUNT_IN_DEFAULT;
    if (!(isInt(ci) && ci >= COUNT_IN_MIN && ci <= COUNT_IN_MAX)) return { ok: false, why: `countIn must be an integer from ${COUNT_IN_MIN} to ${COUNT_IN_MAX} bars` };
    args.countIn = ci;
    const look = cleanText(a.look, LOOK_MAX);
    if (look) args.look = look;
  } else {
    if (args.bpm === undefined && args.meter === undefined && args.subdivision === undefined) {
      return { ok: false, why: 'circle-set change must alter at least one of bpm, meter and subdivision' };
    }
    if (a.lead !== undefined) {
      if (!(isInt(a.lead) && a.lead >= 1 && a.lead <= LEAD_MAX)) return { ok: false, why: `lead must be an integer number of bars, 1 to ${LEAD_MAX}` };
      args.lead = a.lead;
    }
  }
  return { ok: true, args };
}

/** Is this circle running (folded, and not ended)? */
export const circleRunning = (c) => !!c && typeof c === 'object' && !c.ended;

/** THE DOOR (§2.1): stamp a normalized circle-set against the folded circle.
 *  `now` = the server's clock at acceptance; `who` = {id, sub?} of the
 *  author; `mayRetime` = the author is the initiator, the world's owner or an
 *  operator (the server decides that — rights live server-side). Resolves
 *  {ok, args} (the stamped entry args) or {ok: false, why}. */
export function stampCircleSet(folded, args, { now, who, mayRetime, policy = DRUM_POLICY }) {
  const running = circleRunning(folded);
  if (args.op === 'start') {
    if (running) return { ok: false, why: 'a circle is already running — change or end it' };
    const grid = { bpm: args.bpm, meter: args.meter, subdivision: args.subdivision };
    const t0 = now + gridOf(grid).barMs;           // a bar of grace; then the count-in
    const gen = (folded && Number.isInteger(folded.gen) ? folded.gen : 0) + 1;   // never resets on an entity (§2.5)
    const initiator = { id: String(who.id), ...(who.sub ? { sub: String(who.sub) } : {}) };
    return { ok: true, args: { ...args, t0, gen, initiator } };
  }
  if (!running) return { ok: false, why: 'no circle is running here' };
  if (!mayRetime) {
    const by = folded.initiator?.id ?? 'its initiator';
    return { ok: false, why: `only ${by} (who started this circle), the world's owner, or an operator may ${args.op} it` };
  }
  if (args.op === 'end') return { ok: true, args: { ...args, gen: folded.gen } };
  // change (§2.1): lead time of at least H, one pending change at a time
  if (now < folded.t0) {
    if (folded.prev) {
      const atBar = Math.round((folded.t0 - folded.prev.t0) / gridOf(folded.prev).barMs);
      return { ok: false, why: `a change is already scheduled for bar ${atBar}` };
    }
    return { ok: false, why: "the circle hasn't started — end it and start again" };
  }
  const lead = args.lead ?? policy.H_BARS;
  if (lead < policy.H_BARS) return { ok: false, why: `a tempo change needs at least ${policy.H_BARS} bars of lead (the horizon), so nothing already queued is voided; ${lead} is too few` };
  const currentBar = barAt(folded, now);
  const atBar = currentBar + lead + 1;
  const t0 = barStart(folded, atBar);
  return { ok: true, args: { ...args, lead, atBar, t0, gen: folded.gen + 1 } };
}

/** THE FOLD: the next circle bag from the folded one and an entry's args, or
 *  `undefined` when the entry folds to nothing (a hand-edited or otherwise
 *  illegal entry — the log stays total). Pure: no clock, no policy. */
export function foldCircleSet(folded, a) {
  const n = normalizeCircleSetArgs(a);
  if (!n.ok) return undefined;
  const args = n.args;
  const running = circleRunning(folded);
  const gen = a?.gen;
  if (!isInt(gen)) return undefined;
  if (args.op === 'start') {
    const priorGen = folded && isInt(folded.gen) ? folded.gen : 0;
    if (running || gen !== priorGen + 1) return undefined;
    if (typeof a.t0 !== 'number' || !Number.isFinite(a.t0)) return undefined;
    const init = a.initiator;
    if (!init || typeof init.id !== 'string' || !init.id) return undefined;
    return {
      t0: a.t0, bpm: args.bpm, meter: args.meter, subdivision: args.subdivision, gen,
      countIn: args.countIn, initiator: { id: init.id, ...(typeof init.sub === 'string' && init.sub ? { sub: init.sub } : {}) },
      ...(args.look ? { look: args.look } : {}),
    };
  }
  if (!running) return undefined;
  if (args.op === 'end') {
    if (gen !== folded.gen) return undefined;
    return { ...folded, ended: true };
  }
  // change: the fold derives `prev` itself from the folded grid — the entry
  // only carries the new t0 and the successor generation
  if (gen !== folded.gen + 1) return undefined;
  if (typeof a.t0 !== 'number' || !Number.isFinite(a.t0) || a.t0 <= folded.t0) return undefined;
  const { prev: _oldPrev, ...cur } = folded;
  return {
    ...cur,
    bpm: args.bpm ?? folded.bpm, meter: args.meter ?? folded.meter, subdivision: args.subdivision ?? folded.subdivision,
    t0: a.t0, gen,
    prev: { t0: folded.t0, bpm: folded.bpm, meter: folded.meter, subdivision: folded.subdivision, gen: folded.gen, until: a.t0 },
  };
}

/** A FOLDED circle bag, validated for trusted snapshot hydration (§4.7):
 *  the bag itself, rebuilt from its known fields, or undefined (fails closed).
 *  Deterministic and side-effect free (IMPLEMENTATION-CARRY note 2). */
export function normalizeCircleBag(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return undefined;
  const grid = (g) => typeof g.t0 === 'number' && Number.isFinite(g.t0)
    && inRange(g.bpm, [BPM_MIN, BPM_MAX]) && isInt(g.meter) && g.meter >= METER_MIN && g.meter <= METER_MAX
    && isInt(g.subdivision) && g.subdivision >= SUBDIVISION_MIN && g.subdivision <= SUBDIVISION_MAX
    && isInt(g.gen) && g.gen >= 1;
  if (!grid(b)) return undefined;
  if (!(isInt(b.countIn) && b.countIn >= COUNT_IN_MIN && b.countIn <= COUNT_IN_MAX)) return undefined;
  const init = b.initiator;
  if (!init || typeof init.id !== 'string' || !init.id) return undefined;
  const out = { t0: b.t0, bpm: b.bpm, meter: b.meter, subdivision: b.subdivision, gen: b.gen, countIn: b.countIn,
    initiator: { id: init.id, ...(typeof init.sub === 'string' && init.sub ? { sub: init.sub } : {}) } };
  const look = cleanText(b.look, LOOK_MAX);
  if (look) out.look = look;
  if (b.prev !== undefined) {
    const p = b.prev;
    if (!p || typeof p !== 'object' || !grid(p) || !(typeof p.until === 'number' && p.until === b.t0) || p.gen !== b.gen - 1) return undefined;
    out.prev = { t0: p.t0, bpm: p.bpm, meter: p.meter, subdivision: p.subdivision, gen: p.gen, until: p.until };
  }
  if (b.ended !== undefined) { if (b.ended !== true) return undefined; out.ended = true; }
  return out;
}

/** A FOLDED instrument bag, validated for trusted snapshot hydration; same
 *  contract as normalizeCircleBag. */
export function normalizeInstrumentBag(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return undefined;
  const n = normalizeInstrumentSetArgs({ ...b, id: 'bag' });
  if (!n.ok || n.args.end) return undefined;
  if (!(isInt(b.voiceGen) && b.voiceGen >= 1)) return undefined;
  const { id: _id, ...bag } = n.args;
  const out = { ...bag, voiceGen: b.voiceGen };
  if (b.ended !== undefined) { if (b.ended !== true) return undefined; out.ended = true; }
  return out;
}

// ---- phrases: admission (§2.3, §2.4) -----------------------------------------
// Pure judges, shared so the sequencer, the tests and the mcpl `play` tool
// cannot disagree about what a phrase means. The sequencer adds what needs
// state (dedupe window, planned-slot claims, the per-leg rate) around them.

export const PHRASE_BARS_MAX = 8;

/** The grid a phrase names by its circle generation: the current one, the
 *  outgoing `prev` (during a handover), or null (stale). Each carries its span
 *  end `until` (undefined for the current grid). */
export function gridForGen(c, gen) {
  if (!circleRunning(c)) return null;
  if (gen === c.gen) return { t0: c.t0, bpm: c.bpm, meter: c.meter, subdivision: c.subdivision, gen: c.gen, until: undefined, initial: !c.prev };
  if (c.prev && gen === c.prev.gen) return { ...c.prev, initial: false };
  return null;
}
/** The bar of grid `g` at which its span ends (the scheduled change), or
 *  undefined when it has none. */
export const changeBarOf = (g) => (g.until === undefined ? undefined : Math.round((g.until - g.t0) / gridOf(g).barMs));

/** Validate a pattern (and optional velocity) for `bars` bars of `steps`
 *  steps against an alphabet. `|` is allowed ONLY at bar boundaries and is
 *  removed. Resolves {ok, pattern, velocity?} or {ok: false, why}. */
export function normalizePattern(pattern, velocity, { steps, bars, alphabet }) {
  const strip = (s, what, cell) => {
    if (typeof s !== 'string') return { why: `${what} must be a string` };
    const segs = s.includes('|') ? s.split('|') : null;
    if (segs && (segs.length !== bars || segs.some((x) => x.length !== steps))) {
      return { why: `${what}: a "|" may only separate whole bars of ${steps} steps (${bars} bar${bars > 1 ? 's' : ''})` };
    }
    const flat = segs ? segs.join('') : s;
    if (flat.length !== steps * bars) return { why: `${what} must be exactly ${steps * bars} steps (${bars} × ${steps}); got ${flat.length}` };
    for (const ch of flat) if (!cell(ch)) return { why: `${what}: "${ch}" is not allowed here` };
    return { flat };
  };
  const p = strip(pattern, 'pattern', (ch) => ch === '.' || alphabet.includes(ch));
  if (p.why) {
    const bad = typeof pattern === 'string' ? [...pattern.replace(/\|/g, '')].find((ch) => ch !== '.' && !alphabet.includes(ch)) : undefined;
    return { ok: false, why: bad && /not allowed/.test(p.why) ? `letter "${bad}" is not a stroke this drum declares (${alphabet.join('')})` : p.why };
  }
  if (velocity === undefined) return { ok: true, pattern: p.flat };
  const v = strip(velocity, 'velocity', (ch) => ch >= '1' && ch <= '9');
  if (v.why) return { ok: false, why: v.why };
  return { ok: true, pattern: p.flat, velocity: v.flat };
}

/** Is this circle + drum pair playable at all? Shared by both judges. */
function playable(c, inst, msg) {
  if (!circleRunning(c)) return { why: 'the circle has ended or does not exist' };
  if (!inst || inst.ended) return { why: 'that drum has been ended or does not exist' };
  if (inst.circle !== msg.circle) return { why: `that drum plays in "${inst.circle}", not "${msg.circle}"` };
  if (!KNOWN_SYNTHS.includes(inst.synth)) return { why: `unknown synth "${inst.synth}"` };
  if (msg.voiceGen !== inst.voiceGen) return { why: `stale voice generation — the drum is at voiceGen ${inst.voiceGen}` };
  return null;
}
const staleGen = (c, gen) => `stale generation — the circle is at gen ${c.gen}${c.prev ? ` (gen ${c.prev.gen} until its span ends)` : ''}; ${gen} is not playable`;

/** PLANNED phrase (§2.3): whole future bars, the pattern never affects
 *  admission. `now` = server time at acceptance; `isInitiator` decides the
 *  count-in. Resolves {ok, bar, bars, pattern, velocity?, scheduledAtServerMs}
 *  or {ok: false, why}. Pure. */
export function judgePlanned(c, inst, msg, { now, isInitiator, policy = DRUM_POLICY }) {
  const p = playable(c, inst, msg); if (p) return { ok: false, why: p.why };
  const g = gridForGen(c, msg.gen); if (!g) return { ok: false, why: staleGen(c, msg.gen) };
  const bars = msg.bars ?? 1;
  if (!(isInt(bars) && bars >= 1 && bars <= PHRASE_BARS_MAX)) return { ok: false, why: `bars must be 1 to ${PHRASE_BARS_MAX}` };
  const { steps, barMs } = gridOf(g);
  const pat = normalizePattern(msg.pattern, msg.velocity, { steps, bars, alphabet: Object.keys(inst.strokes) });
  if (!pat.ok) return { ok: false, why: pat.why };
  const countInEnd = g.initial && !isInitiator ? c.countIn : 0;   // bars 0…countIn−1 are the initiator's (§2.1)
  const changeBar = changeBarOf(g);
  let bar = msg.bar;
  if (bar === 'next') {
    const earliest = Math.ceil((now + policy.L_MS - g.t0) / barMs);   // first bar whose step 0 ≥ now + L
    bar = Math.max(earliest, countInEnd, 0);
    if (changeBar !== undefined && bar >= changeBar) return { ok: false, why: `gen ${g.gen}'s span ends at bar ${changeBar}; the circle is at gen ${c.gen}` };
  } else if (!isInt(bar) || bar < 0) {
    return { ok: false, why: 'bar must be a non-negative integer or "next"' };
  } else {
    const begins = barStart(g, bar) - now;
    if (begins < policy.F_MS) {
      const nextOpen = Math.max(Math.ceil((now + policy.F_MS - g.t0) / barMs), countInEnd, 0);
      return { ok: false, why: begins < 0
        ? `bar ${bar} began ${Math.round(-begins)} ms ago; next open bar is ${nextOpen}`
        : `bar ${bar} begins in ${+begins.toFixed(2)} ms, too close to relay; next open bar is ${nextOpen}` };
    }
  }
  const last = bar + bars - 1;
  // bars are contiguous, so a passage touches the count-in iff its first bar does
  if (bar < countInEnd) return { ok: false, why: `count-in — the circle opens at bar ${countInEnd}` };
  if (changeBar !== undefined && bar >= changeBar) return { ok: false, why: `bar ${bar} is past gen ${g.gen}'s span (it ends at bar ${changeBar}); the circle is at gen ${c.gen}` };
  if (changeBar !== undefined && last >= changeBar) return { ok: false, why: `crosses the tempo change at bar ${changeBar}` };
  const horizon = barAt(g, now) + policy.H_BARS;   // NEGATIVE current bar for a pending grid — never clamped
  if (last > horizon) return { ok: false, why: `too far ahead: bar ${last} is past the horizon (bar ${horizon} for now)` };
  return { ok: true, bar, bars, pattern: pat.pattern, ...(pat.velocity ? { velocity: pat.velocity } : {}), scheduledAtServerMs: barStart(g, bar) };
}

/** LIVE hit (§2.4): one stroke on one step. `step` is the step index counted
 *  from the named grid's t0 (bar × steps + s), chosen by a synced client, or
 *  "next", resolved here against ARRIVAL (basis "arrival"). Resolves {ok, bar,
 *  step (within bar), stepIndex, scheduledAtServerMs, arrivalToGridMs, basis}
 *  or {ok: false, why}. Pure. */
export function judgeLive(c, inst, msg, { now, isInitiator, policy = DRUM_POLICY }) {
  const p = playable(c, inst, msg); if (p) return { ok: false, why: p.why };
  const g = gridForGen(c, msg.gen); if (!g) return { ok: false, why: staleGen(c, msg.gen) };
  if (typeof msg.stroke !== 'string' || !(msg.stroke in inst.strokes)) {
    return { ok: false, why: `stroke "${String(msg.stroke ?? '')}" is not one this drum declares (${Object.keys(inst.strokes).join('')})` };
  }
  if (msg.velocity !== undefined && !(isInt(msg.velocity) && msg.velocity >= 1 && msg.velocity <= 9)) return { ok: false, why: 'velocity must be a digit 1–9' };
  const { steps, stepMs } = gridOf(g);
  let k, basis;
  if (msg.step === 'next') { k = Math.max(0, Math.ceil((now + policy.L_MS - g.t0) / stepMs)); basis = 'arrival'; }
  else if (isInt(msg.step) && msg.step >= 0) { k = msg.step; basis = 'client-step'; }
  else return { ok: false, why: 'step must be a non-negative integer step index or "next"' };
  const at = g.t0 + k * stepMs;
  const bar = Math.floor(k / steps);
  if (g.until !== undefined && at >= g.until) return { ok: false, why: `outside gen ${g.gen}'s span; gen ${c.gen} starts at its bar 0` };
  if (basis === 'client-step' && at - now < policy.F_MS) return { ok: false, why: `step ${k} ${at < now ? 'began' : 'begins in'} ${Math.round(Math.abs(at - now))} ms${at < now ? ' ago' : ''}; too late to relay` };
  const countInEnd = g.initial && !isInitiator ? c.countIn : 0;
  if (bar < countInEnd) return { ok: false, why: `count-in — the circle opens at bar ${countInEnd}` };
  const horizon = barAt(g, now) + policy.H_BARS;
  if (bar > horizon) return { ok: false, why: `too far ahead: bar ${bar} is past the horizon` };
  return { ok: true, bar, step: k - bar * steps, stepIndex: k, scheduledAtServerMs: at, arrivalToGridMs: at - now, basis };
}

// ---- the hitter's side of a live hit (§2.4) ----------------------------------

/** A SYNCED client's choice of step for a live press at server time `now`:
 *  the next step at least L ahead ON THE TIMELINE AS IT WILL SOUND — the
 *  outgoing `prev` grid's steps up to its `until`, then the current grid's.
 *  Resolves {gen, step} (step = index from that grid's t0), or null when no
 *  circle runs. Pure; the server judges the result (judgeLive). */
export function chooseLiveStep(c, now, policy = DRUM_POLICY) {
  if (!circleRunning(c)) return null;
  const target = now + policy.L_MS;
  const pick = (g) => Math.max(0, Math.ceil((target - g.t0) / gridOf(g).stepMs));
  if (c.prev && target < c.prev.until) {
    const k = pick(c.prev);
    if (c.prev.t0 + k * gridOf(c.prev).stepMs < c.prev.until) return { gen: c.prev.gen, step: k };
  }
  return { gen: c.gen, step: pick(c) };
}

/** When a hit with no receipt becomes "sharing unknown" (§2.4): a synced
 *  hitter knows its step, so its scheduled time + 1 s on its serverNow(); an
 *  unsynced hitter sent "next" and cannot know it, so the press + L + one step
 *  + 1 s on its own local clock. Resolves {clock: "server"|"local", at}. */
export function sharingUnknownDeadline({ synced, scheduledAtServerMs, pressedAtLocalMs, stepMs, policy = DRUM_POLICY }) {
  return synced
    ? { clock: 'server', at: scheduledAtServerMs + 1000 }
    : { clock: 'local', at: pressedAtLocalMs + policy.L_MS + stepMs + 1000 };
}

// ---- what was struck: one description for every species (§5) -----------------

/** A per-voice window of the bars OBSERVED since arrival: what was struck or
 *  queued, never what was heard. `win` is a plain object; noteStruck mutates
 *  it. Keyed by circle generation so a tempo change never mixes grids. */
export function newStruckWindow(observedFrom = null) { return { observedFrom, voices: {} }; }
export function noteStruck(win, ph, { steps, keepBars = 4, mine = false } = {}) {
  const key = `${ph.voice}`;
  const v = (win.voices[key] ??= { authors: new Set(), bars: {} });
  if (ph.author) v.authors.add(ph.author);
  const put = (bar, cells) => {
    const k = `${ph.gen}:${bar}`;
    const prev = v.bars[k]?.cells ?? '.'.repeat(steps);
    const merged = [...prev].map((ch, i) => (cells[i] && cells[i] !== '.' ? cells[i] : ch)).join('');
    v.bars[k] = { gen: ph.gen, bar, cells: merged, queued: !!mine };
  };
  if (ph.live) put(ph.bar, '.'.repeat(ph.step) + ph.stroke + '.'.repeat(Math.max(0, steps - ph.step - 1)));
  else for (let i = 0; i < (ph.bars ?? 1); i++) put(ph.bar + i, ph.pattern.slice(i * steps, (i + 1) * steps));
  if (win.observedFrom === null) win.observedFrom = { gen: ph.gen, bar: ph.bar };
  const keys = Object.keys(v.bars).sort((a, b) => (v.bars[a].gen - v.bars[b].gen) || (v.bars[a].bar - v.bars[b].bar));
  while (keys.length > keepBars) delete v.bars[keys.shift()];
}

/** The circle in words — the SAME string on every client from the same data
 *  (browser grid, Lite, the mcpl look line). Says what was struck or queued
 *  and over which observed bars; never that anyone heard it; never implies a
 *  history from before the observer arrived. */
export function describeCircle(c, instruments, win, { now, initiatorPresent = true } = {}) {
  if (!c) return '';
  const meterWord = `${c.meter}/4 in ${['', 'quarters', 'eighths', 'triplets', 'sixteenths', 'quintuplets', 'sextuplets', 'septuplets', '32nds'][c.subdivision] ?? `${c.subdivision} steps per beat`}`;
  if (c.ended) return `a drum circle (ended at gen ${c.gen})`;
  const lines = [`a drum circle, ${c.bpm} BPM, ${meterWord} (gen ${c.gen}), started by ${c.initiator?.id ?? 'someone'}`];
  if (!initiatorPresent) lines.push(`  the initiator has left; only the owner or an operator can change or end this circle`);
  if (now !== undefined) {
    const cur = barAt(c, now);
    if (!c.prev && cur < c.countIn) lines.push(`  count-in by ${c.initiator?.id ?? 'the initiator'}, bars 0–${c.countIn - 1}; open from bar ${c.countIn}`);
    if (c.prev && now < c.t0) {
      const at = changeBarOf({ ...c.prev });
      lines.push(`  tempo → ${c.bpm} BPM at bar ${at} (the new grid's bar 0); now at bar ${barAt(c.prev, now)} of gen ${c.prev.gen}`);
    } else lines.push(`  now at bar ${cur}`);
  }
  const vs = Object.entries(win?.voices ?? {});
  if (!vs.length) { lines.push(`  nothing struck or queued since you arrived`); return lines.join('\n'); }
  const span = vs.flatMap(([, v]) => Object.values(v.bars).map((b) => b.bar));
  lines.push(`  struck/queued, bars ${Math.min(...span)}–${Math.max(...span)} (observed since you arrived):`);
  for (const [voice, v] of vs) {
    const name = instruments?.[voice]?.name ?? voice;
    const who = [...v.authors].join(', ') || '—';
    const bars = Object.values(v.bars).sort((a, b) => (a.gen - b.gen) || (a.bar - b.bar));
    lines.push(`    ${name} (${who}): ${bars.map((b) => b.cells + (b.queued ? '*' : '')).join('  ')}`);
  }
  if (vs.some(([, v]) => Object.values(v.bars).some((b) => b.queued))) lines.push(`  (* = yours, queued)`);
  return lines.join('\n');
}

/** The ONE eidoverse:circle line (§5): a circle within a resident's radius
 *  began playing, went quiet, ended, or was removed. Who plays it and its grid;
 *  never a pattern, never what was heard (what was struck is look()'s). `c`
 *  may be null (a removed circle). Pure. */
export function circleLifecycleLine(id, c, how, authors) {
  const who = authors?.length ? authors.join(', ') : 'someone';
  if (how === 'began') {
    const grid = c && !c.ended ? ` (${c.bpm} BPM, ${c.meter}/4)` : '';
    return `a drum circle near you began playing [${id}]${grid}: ${who}. What is struck is in look().`;
  }
  const what = how === 'quiet' ? 'went quiet' : how === 'ended' ? 'ended' : 'was removed';
  return `the drum circle [${id}] near you ${what} (played by ${who})`;
}

// ---- instrument-set: shape, door, fold --------------------------------------

/** Shape only: drops voiceGen and ended. Resolves {ok, args} or {ok:false, why}. */
export function normalizeInstrumentSetArgs(a) {
  const want = 'instrument-set wants {id, circle, name, synth, strokes, polyphony?, volume?, radius?, look?} or {id, end: true}';
  if (!a || typeof a !== 'object' || Array.isArray(a)) return { ok: false, why: want };
  const id = cleanId(a.id);
  if (!id) return { ok: false, why: 'instrument-set wants an entity id' };
  if (a.end === true) return { ok: true, args: { id, end: true } };
  const circle = cleanId(a.circle);
  if (!circle) return { ok: false, why: 'instrument-set wants the id of the circle it plays in' };
  const name = cleanText(a.name, NAME_MAX);
  if (!name) return { ok: false, why: `instrument-set wants a name (≤${NAME_MAX} chars)` };
  if (!KNOWN_SYNTHS.includes(a.synth)) return { ok: false, why: `unknown synth "${String(a.synth ?? '')}" — this build knows ${KNOWN_SYNTHS.join(', ')}` };
  if (!a.strokes || typeof a.strokes !== 'object' || Array.isArray(a.strokes)) return { ok: false, why: 'instrument-set wants strokes: {LETTER: {f0, drop, dropMs, decayMs, noise, cutoff, gain?}, …}' };
  const strokes = {};
  const letters = Object.keys(a.strokes);
  if (!letters.length) return { ok: false, why: 'an instrument needs at least one stroke' };
  for (const L of letters) {
    if (!/^[A-Z]$/.test(L)) return { ok: false, why: `stroke "${L}" must be a single uppercase letter A–Z (the pattern alphabet)` };
    const s = a.strokes[L];
    if (!s || typeof s !== 'object') return { ok: false, why: `stroke ${L} wants {f0, drop, dropMs, decayMs, noise, cutoff, gain?}` };
    const out = {};
    for (const k of STROKE_REQUIRED) {
      if (!inRange(s[k], STROKE_RANGES[k])) return { ok: false, why: `stroke ${L}.${k} must be a number from ${STROKE_RANGES[k][0]} to ${STROKE_RANGES[k][1]}` };
      out[k] = s[k];
    }
    if (s.gain !== undefined) {
      if (!inRange(s.gain, STROKE_RANGES.gain)) return { ok: false, why: `stroke ${L}.gain must be a number from 0 to 2` };
      out.gain = s.gain;
    }
    strokes[L] = out;
  }
  const polyphony = a.polyphony ?? POLYPHONY_DEFAULT;
  if (!(isInt(polyphony) && polyphony >= 1 && polyphony <= POLYPHONY_MAX)) return { ok: false, why: `polyphony must be an integer from 1 to ${POLYPHONY_MAX}` };
  const volume = a.volume ?? VOLUME_DEFAULT;
  if (!inRange(volume, [0, 1])) return { ok: false, why: 'volume must be a number from 0 to 1' };
  const radius = a.radius ?? RADIUS_DEFAULT;
  if (!inRange(radius, [1, RADIUS_MAX])) return { ok: false, why: `radius must be a number from 1 to ${RADIUS_MAX}` };
  const look = cleanText(a.look, LOOK_MAX);
  return { ok: true, args: { id, circle, name, synth: a.synth, strokes, polyphony, volume, radius, ...(look ? { look } : {}) } };
}

/** THE DOOR (§2.2): stamp voiceGen against the folded instrument. Every edit
 *  bumps it; `end` keeps it (the marker the next edit continues from). */
export function stampInstrumentSet(folded, args) {
  const prior = folded && isInt(folded.voiceGen) ? folded.voiceGen : 0;
  if (args.end) {
    if (!folded || folded.ended) return { ok: false, why: 'no instrument is set here' };
    return { ok: true, args: { ...args, voiceGen: prior } };
  }
  return { ok: true, args: { ...args, voiceGen: prior + 1 } };
}

/** THE FOLD for instrument-set: next bag, or undefined (folds to nothing). */
export function foldInstrumentSet(folded, a) {
  const n = normalizeInstrumentSetArgs(a);
  if (!n.ok) return undefined;
  const vg = a?.voiceGen;
  if (!isInt(vg)) return undefined;
  const prior = folded && isInt(folded.voiceGen) ? folded.voiceGen : 0;
  if (n.args.end) {
    if (!folded || folded.ended || vg !== prior) return undefined;
    return { ...folded, ended: true };
  }
  if (vg !== prior + 1) return undefined;
  const { id: _id, ...bag } = n.args;
  return { ...bag, voiceGen: vg };
}
