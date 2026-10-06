// circle-test — the drum circle's meaning module and fold, against numbers
// worked BY HAND (design rev 5, §3; Mica's method: expectations first, never
// read off the implementation). No server: shared/circle.js and the real
// shared/fold.js, nothing else.
//
//   bun tools/circle-test.ts
//
// The worked grid throughout: bpm 90, meter 4, subdivision 4.
//   beat = 60,000 ÷ 90 = 666.67 ms; step = 666.67 ÷ 4 = 166.67 ms;
//   bar = 16 × 166.67 = 2,666.67 ms.
// Times are written as T + x, with T an arbitrary server epoch.
import { DRUM_POLICY, gridOf, barStart, stepTime, barAt, normalizeCircleSetArgs, stampCircleSet,
  foldCircleSet, normalizeInstrumentSetArgs, stampInstrumentSet, foldInstrumentSet } from "../shared/circle.js";
import { foldEntry, emptyState, PROTECTED_COMPS } from "../shared/fold.js";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const T = 1_000_000;
const G90 = { t0: T, bpm: 90, meter: 4, subdivision: 4 };

console.log("\n1. grid math (§3)");
{
  const g = gridOf(G90);
  check("step = 166.67 ms", near(g.stepMs, 500 / 3), String(g.stepMs));
  check("bar = 2,666.67 ms", near(g.barMs, 8000 / 3), String(g.barMs));
  check("16 steps per bar", g.steps === 16);
  check("bar 3 step 5 sounds at T + 8,833.33", near(stepTime(G90, 3, 5) - T, 26500 / 3), String(stepTime(G90, 3, 5) - T));
  check("T + 10,000 falls in bar 3", barAt(G90, T + 10_000) === 3);
  check("before t0 the bar is NEGATIVE, never clamped", barAt(G90, T - 1) === -1);
}

console.log("\n2. the door: start (§2.1)");
const ADAM = { id: "adam" };
let started: any;
{
  const n = normalizeCircleSetArgs({ id: "drums", op: "start", bpm: 90, meter: 4, subdivision: 4,
    t0: 5, gen: 99, initiator: { id: "mallory" } });
  check("shape drops a client's t0, gen and initiator", n.ok && !("t0" in n.args) && !("gen" in n.args) && !("initiator" in n.args), JSON.stringify(n));
  check("countIn defaults to 1", n.ok && n.args.countIn === 1);
  const r = stampCircleSet(undefined, n.args, { now: T, who: ADAM, mayRetime: false });
  started = r.args;
  check("start: t0 = acceptance + one bar = T + 2,666.67", r.ok && near(r.args.t0 - T, 8000 / 3), JSON.stringify(r));
  check("start: gen 1 on a fresh entity", r.ok && r.args.gen === 1);
  check("start: the server stamps the initiator", r.ok && r.args.initiator?.id === "adam");
  check("start on a running circle is refused",
    !stampCircleSet({ ...G90, gen: 1 }, n.args, { now: T, who: ADAM, mayRetime: true }).ok);
  check("start wants bpm, meter and subdivision", !normalizeCircleSetArgs({ id: "d", op: "start", bpm: 90 }).ok);
  check("bpm outside 40–240 is refused", !normalizeCircleSetArgs({ id: "d", op: "start", bpm: 300, meter: 4, subdivision: 4 }).ok);
  check("countIn outside 1–4 is refused", !normalizeCircleSetArgs({ id: "d", op: "start", bpm: 90, meter: 4, subdivision: 4, countIn: 5 }).ok);
}

console.log("\n3. the door: change with lead time (§2.1, §3's worked example)");
// The design's example: a running circle at gen 2, t0 = T, bpm 90 — a change
// to 120 BPM requested at T + 10,000 (bar 3) with H = 16.
const RUN = { ...G90, gen: 2, countIn: 1, initiator: ADAM };
let changed: any;
{
  const n = normalizeCircleSetArgs({ id: "drums", op: "change", bpm: 120 });
  const r = stampCircleSet(RUN, n.ok ? n.args : {}, { now: T + 10_000, who: ADAM, mayRetime: true });
  changed = r.args;
  check("lead defaults to H = 16", r.ok && r.args.lead === 16, JSON.stringify(r));
  check("the change lands at bar 3 + 16 + 1 = 20", r.ok && r.args.atBar === 20);
  check("new t0 = T + 20 × 2,666.67 = T + 53,333.33", r.ok && near(r.args.t0 - T, 160000 / 3), String(r.args?.t0 - T));
  check("gen 2 → 3", r.ok && r.args.gen === 3);
  check("lead 15 (< H) is refused", !stampCircleSet(RUN, { ...n.args, lead: 15 }, { now: T + 10_000, who: ADAM, mayRetime: true }).ok);
  check("a change must alter something", !normalizeCircleSetArgs({ id: "drums", op: "change" }).ok);
  const stranger = stampCircleSet(RUN, n.args, { now: T + 10_000, who: { id: "carol" }, mayRetime: false });
  check("a non-initiator may not change it", !stranger.ok && /only adam/.test(stranger.why), stranger.why);
  check("before the circle has started (and no prior change), a change is refused",
    !stampCircleSet(RUN, n.args, { now: T - 1, who: ADAM, mayRetime: true }).ok);
  check("change or end with no running circle is refused",
    !stampCircleSet(undefined, n.args, { now: T, who: ADAM, mayRetime: true }).ok
    && !stampCircleSet({ ...RUN, ended: true }, { id: "drums", op: "end" }, { now: T, who: ADAM, mayRetime: true }).ok);
}

console.log("\n4. the fold (§2.1, §2.5)");
{
  const afterStart = foldCircleSet(undefined, started);
  check("start folds", afterStart?.gen === 1 && afterStart?.bpm === 90 && afterStart?.initiator?.id === "adam", JSON.stringify(afterStart));
  check("a start with a non-successor gen folds to nothing", foldCircleSet(undefined, { ...started, gen: 2 }) === undefined);
  const afterChange = foldCircleSet(RUN, changed);
  check("change folds: bpm 120, gen 3, t0 T + 53,333.33",
    afterChange?.bpm === 120 && afterChange?.gen === 3 && near(afterChange?.t0 - T, 160000 / 3), JSON.stringify(afterChange));
  check("the FOLD derives prev from the folded grid: gen 2, bpm 90, until = the new t0",
    afterChange?.prev?.gen === 2 && afterChange?.prev?.bpm === 90 && afterChange?.prev?.t0 === T && afterChange?.prev?.until === afterChange?.t0,
    JSON.stringify(afterChange?.prev));
  check("a change with the wrong gen folds to nothing", foldCircleSet(RUN, { ...changed, gen: 4 }) === undefined);
  check("a change whose t0 is not after the folded t0 folds to nothing", foldCircleSet(RUN, { ...changed, t0: T }) === undefined);
  // The pending grid (gen 3, bpm 120, bar 2,000 ms) during the lead:
  const pending = { t0: changed.t0, bpm: 120, meter: 4, subdivision: 4 };
  check("pending grid's bar at the request is ⌊(10,000 − 53,333.33) ÷ 2,000⌋ = −22 (never clamped)",
    barAt(pending, T + 10_000) === -22, String(barAt(pending, T + 10_000)));
  check("its bar 0 enters the horizon at T + 21,333.33 (current bar −16; −16 + 16 = 0)",
    barAt(pending, T + 21333.34) === -16 && barAt(pending, T + 21333.32) === -17);
  const second = stampCircleSet(afterChange, { id: "drums", op: "change", bpm: 100 }, { now: T + 20_000, who: ADAM, mayRetime: true });
  check("a second change while one is pending is refused, naming bar 20", !second.ok && /bar 20/.test(second.why), second.why);
  const ended = foldCircleSet(afterChange, { id: "drums", op: "end", gen: 3 });
  check("end keeps gen and marks ended", ended?.ended === true && ended?.gen === 3);
  check("an end with the wrong gen folds to nothing", foldCircleSet(afterChange, { id: "drums", op: "end", gen: 2 }) === undefined);
  const restart = stampCircleSet(ended, { id: "drums", op: "start", bpm: 100, meter: 4, subdivision: 4, countIn: 2 }, { now: T + 90_000, who: { id: "bea" }, mayRetime: false });
  check("after end, a new start continues the generation: gen 4, never 1", restart.ok && restart.args.gen === 4, JSON.stringify(restart));
  check("a restart stamped gen 1 (a reset) folds to nothing", foldCircleSet(ended, { ...restart.args, gen: 1 }) === undefined);
  const refolded = foldCircleSet(ended, restart.args);
  check("the restart folds with the new initiator and no stale prev", refolded?.gen === 4 && refolded?.initiator?.id === "bea" && !refolded?.prev && !refolded?.ended);
}

console.log("\n5. instruments (§2.2)");
const HAND = { id: "hand", circle: "drums", name: "hand", synth: "drum-v1",
  strokes: { B: { f0: 80, drop: 2, dropMs: 120, decayMs: 400, noise: 0.1, cutoff: 1200 },
             T: { f0: 220, drop: 1.5, dropMs: 40, decayMs: 180, noise: 0.3, cutoff: 3000 },
             S: { f0: 400, drop: 1.2, dropMs: 20, decayMs: 120, noise: 0.7, cutoff: 3800 } } };
{
  const n = normalizeInstrumentSetArgs({ ...HAND, voiceGen: 50 });
  check("shape drops a client's voiceGen", n.ok && !("voiceGen" in n.args));
  check("defaults: polyphony 8, volume 0.8, radius 15", n.ok && n.args.polyphony === 8 && n.args.volume === 0.8 && n.args.radius === 15);
  check("an unknown synth is refused at the door", !normalizeInstrumentSetArgs({ ...HAND, synth: "drum-v2" }).ok);
  check("a stroke letter must be one uppercase letter", !normalizeInstrumentSetArgs({ ...HAND, strokes: { b: HAND.strokes.B } }).ok);
  check("a stroke parameter out of range is refused", !normalizeInstrumentSetArgs({ ...HAND, strokes: { B: { ...HAND.strokes.B, cutoff: 30 } } }).ok);
  const s1 = stampInstrumentSet(undefined, n.args);
  check("first edit: voiceGen 1", s1.ok && s1.args.voiceGen === 1);
  const b1 = foldInstrumentSet(undefined, s1.args);
  const s2 = stampInstrumentSet(b1, { ...n.args, volume: 0.5 });
  check("every edit bumps voiceGen: 1 → 2", s2.ok && s2.args.voiceGen === 2);
  check("a non-successor voiceGen folds to nothing", foldInstrumentSet(b1, { ...s2.args, voiceGen: 3 }) === undefined);
  check("an unknown synth folds to nothing (fails closed)", foldInstrumentSet(b1, { ...s2.args, synth: "drum-v2" }) === undefined);
  const b2 = foldInstrumentSet(b1, s2.args);
  const e = stampInstrumentSet(b2, { id: "hand", end: true });
  const b3 = foldInstrumentSet(b2, e.args);
  check("end keeps voiceGen 2 and marks ended", b3?.ended === true && b3?.voiceGen === 2, JSON.stringify(b3));
  const s4 = stampInstrumentSet(b3, n.args);
  check("after end, the next edit continues: voiceGen 3, never 1", s4.args.voiceGen === 3 && foldInstrumentSet(b3, s4.args)?.voiceGen === 3);
}

console.log("\n6. through the real shared fold (foldEntry)");
{
  const st = emptyState();
  let seq = 1;
  const e = (verb: string, args: any, actor = "adam") => ({ seq: seq++, ts: T + seq, actor, verb, args });
  foldEntry(st, e("spawn", { id: "drums", lib: "deco/drum.glb", pos: [0, 0, 0] }));
  foldEntry(st, e("circle-set", started));
  check("circle-set folds into comp.circle", st.entities.drums?.comp?.circle?.gen === 1);
  foldEntry(st, e("comp", { id: "drums", type: "circle", data: { t0: 0, bpm: 240, meter: 2, subdivision: 1, gen: 99 } }));
  check("a plain comp of type circle folds to nothing", st.entities.drums?.comp?.circle?.gen === 1 && st.entities.drums?.comp?.circle?.bpm === 90);
  foldEntry(st, e("comp", { id: "drums", type: "instrument", data: { voiceGen: 7 } }));
  check("a plain comp of type instrument folds to nothing", st.entities.drums?.comp?.instrument === undefined);
  check("PROTECTED_COMPS is exactly circle and instrument", JSON.stringify(PROTECTED_COMPS) === '["circle","instrument"]');
  foldEntry(st, e("circle-set", { ...started, gen: 5 }));
  check("a hand-edited non-successor circle-set folds to nothing", st.entities.drums.comp.circle.gen === 1);
  foldEntry(st, e("circle-set", { id: "nowhere", ...started }));
  check("a circle-set on a missing entity folds to nothing", !st.entities.nowhere);
}

console.log("\n7. policy is not protocol (Mica: changing L/F/H must not alter protocol identity)");
{
  check("the policy object is labelled PROVISIONAL_TEST_VALUE", DRUM_POLICY.status === "PROVISIONAL_TEST_VALUE");
  check("…and frozen in one place", Object.isFrozen(DRUM_POLICY));
  const n = normalizeCircleSetArgs({ id: "drums", op: "change", bpm: 120 });
  const a = stampCircleSet(RUN, n.ok ? n.args : {}, { now: T + 10_000, who: ADAM, mayRetime: true });
  const b = stampCircleSet(RUN, n.ok ? n.args : {}, { now: T + 10_000, who: ADAM, mayRetime: true, policy: { ...DRUM_POLICY, H_BARS: 24 } });
  check("H = 24 moves the change to bar 3 + 24 + 1 = 28", b.ok && b.args.atBar === 28, JSON.stringify(b));
  check("…but the entry's SHAPE is identical (same keys)", JSON.stringify(Object.keys(a.args).sort()) === JSON.stringify(Object.keys(b.args).sort()));
  const fa = foldCircleSet(RUN, a.args), fb = foldCircleSet(RUN, b.args);
  check("…and both fold by the same rule (same bag keys; each t0 is its own stamp)",
    JSON.stringify(Object.keys(fa).sort()) === JSON.stringify(Object.keys(fb).sort()) && fa.t0 === a.args.t0 && fb.t0 === b.args.t0);
  const foldSrc = String(foldCircleSet) + String(foldInstrumentSet);
  check("the fold reads neither the clock nor policy", !/DRUM_POLICY|policy|Date\.now|performance/.test(foldSrc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
