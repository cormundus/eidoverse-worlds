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
