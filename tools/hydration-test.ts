// hydration-test — the drum circle's hydration contract (design rev 5, §4.7;
// acceptance A12, Mica's nine points), with no server.
//
//   bun tools/hydration-test.ts
//
// The SERVER side folds a nontrivial world through the real shared fold. The
// snapshot crosses a JSON round-trip, as it would on the wire. Then:
//   - the BROWSER path is the real client/lib/state.js hydrate();
//   - the AGENT path is the exact sequence mcpl/agent.ts runs on join:
//     stateToEntries (with the agent's flags) → foldEntry each →
//     seedProtected → the tail. The REAL WorldAgent is exercised over a live
//     socket in tools/hydration-live-test.ts.
// Hand-computed grid: bpm 90 → bar 2,666.67 ms; bpm 120 → bar 2,000 ms.
import { foldEntry, emptyState, stateToEntries, seedProtected, PROTECTED_COMPS } from "../shared/fold.js";
import { stampCircleSet, normalizeCircleSetArgs, stampInstrumentSet, normalizeInstrumentSetArgs, barAt, stepTime } from "../shared/circle.js";
import { hydrate, state as browserState, reset as browserReset } from "../client/lib/state.js";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const canon = (v: any): string => v === undefined ? "undefined" : JSON.stringify(v, (_k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const same = (a: any, b: any) => canon(a) === canon(b);
const T = 1_000_000;
const ADAM = { id: "adam" };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

// ---- the server's folded world ---------------------------------------------
const st = emptyState();
let seq = 1;
const commit = (verb: string, args: any, actor = "adam") => {
  const e = { seq: seq++, ts: T + seq, actor, verb, args };
  foldEntry(st, e); return e;
};
const circle = (id: string) => (st.entities as any)[id]?.comp?.circle;
const door = (id: string, a: any, now: number) => {
  const n = normalizeCircleSetArgs({ id, ...a });
  const r = stampCircleSet(circle(id), n.ok ? n.args : {}, { now, who: ADAM, mayRetime: true });
  if (!r.ok) throw new Error(`door refused ${JSON.stringify(a)}: ${r.why}`);
  return commit("circle-set", r.args);
};
for (const id of ["drums", "drum2"]) commit("spawn", { id, lib: "deco/drum.glb", pos: [0, 0, 0] });
// drums: start (gen 1) → end → start (gen 2) → change to 120 (gen 3), pending
door("drums", { op: "start", bpm: 90, meter: 4, subdivision: 4 }, T - 50_000);
door("drums", { op: "end" }, T - 40_000);
door("drums", { op: "start", bpm: 90, meter: 4, subdivision: 4 }, T - 2666.6666666666665);   // t0 = T exactly
const changeEntry = door("drums", { op: "change", bpm: 120 }, T + 10_000);
// drum2: start → end (an ended marker)
door("drum2", { op: "start", bpm: 100, meter: 3, subdivision: 2, countIn: 2 }, T);
door("drum2", { op: "end" }, T + 5_000);
// an instrument edited to voiceGen 3
const HAND = { circle: "drums", name: "hand", synth: "drum-v1",
  strokes: { B: { f0: 80, drop: 2, dropMs: 120, decayMs: 400, noise: 0.1, cutoff: 1200 } } };
for (const vol of [0.8, 0.6, 0.5]) {
  const n = normalizeInstrumentSetArgs({ id: "drums", ...HAND, volume: vol });
  commit("instrument-set", stampInstrumentSet((st.entities as any).drums?.comp?.instrument, n.ok ? n.args : {}).args);
}

console.log("\n0. the server's folded world (hand-computed)");
const srv = circle("drums");
check("drums: gen 3 at 120 BPM, t0 = T + 20 × 2,666.67 = T + 53,333.33", srv?.gen === 3 && srv?.bpm === 120 && near(srv.t0 - T, 160000 / 3), JSON.stringify(srv));
check("…with a live prev: gen 2, 90 BPM, t0 = T, until = the new t0", srv?.prev?.gen === 2 && srv.prev.t0 === T && srv.prev.until === srv.t0);
check("drum2: ended, gen 1", circle("drum2")?.ended === true && circle("drum2")?.gen === 1);
check("drums' instrument: voiceGen 3, volume 0.5", (st.entities as any).drums.comp.instrument.voiceGen === 3 && (st.entities as any).drums.comp.instrument.volume === 0.5);

// ---- the snapshot, and the two joiners ----------------------------------------
const snapshot = JSON.parse(JSON.stringify(st));
const AGENT_FLAGS = { roles: false, behaviors: false, collide: false, bodyMountRel: "seat", bodyMountActor: "rider" };
function agentJoin(snap: any, tail: any[] = []) {
  const a = emptyState();
  for (const e of stateToEntries(snap, AGENT_FLAGS as any)) foldEntry(a, e);
  const diag = seedProtected(a, snap);
  for (const e of tail) foldEntry(a, e);
  return { st: a, diag };
}
function browserJoin(snap: any, tail: any[] = []) {
  browserReset?.();
  hydrate(snap, tail, -1);
  return browserState.st;
}
const agent = agentJoin(snapshot).st;
const browser = browserJoin(snapshot);
const bag = (s: any, id: string, t: string) => s?.entities?.[id]?.comp?.[t];

console.log("\n1–5. both joiners hold the server's bags exactly");
check("stateToEntries emits no comp of a protected type",
  !stateToEntries(snapshot, AGENT_FLAGS as any).some((e: any) => e.verb === "comp" && PROTECTED_COMPS.includes(e.args.type)));
for (const [id, t] of [["drums", "circle"], ["drums", "instrument"], ["drum2", "circle"]]) {
  check(`${id}.${t}: agent = server`, same(bag(agent, id, t), bag(st, id, t)), `${canon(bag(agent, id, t))} vs ${canon(bag(st, id, t))}`);
  check(`${id}.${t}: browser = server`, same(bag(browser, id, t), bag(st, id, t)), canon(bag(browser, id, t)));
}
const spans = (s: any) => {
  const c = bag(s, "drums", "circle");
  return { prevEnd: c.prev.until, prevBars: Math.round((c.prev.until - c.prev.t0) / (8000 / 3)), newBarAt: barAt(c, T + 10_000) };
};
check("spans agree: prev runs 20 bars, the pending grid's bar at the request is −22 on both",
  same(spans(agent), spans(browser)) && spans(agent).prevBars === 20 && spans(agent).newBarAt === -22, canon(spans(agent)));

console.log("\n6. queued phrase admission agrees (the span half; full admission arrives with the phrase plane)");
const inSpan = (s: any, gen: number, b: number) => {
  const c = bag(s, "drums", "circle");
  const g = c.gen === gen ? c : c.prev?.gen === gen ? c.prev : null;
  if (!g) return "stale";
  const t = stepTime(g, b, 0);
  return t >= g.t0 && (g.until === undefined || t < g.until) ? "in-span" : "past-span";
};
for (const [gen, b] of [[2, 19], [2, 20], [3, 0], [1, 0]]) {
  check(`gen ${gen} bar ${b}: agent "${inSpan(agent, gen, b)}" = browser "${inSpan(browser, gen, b)}"`, inSpan(agent, gen, b) === inSpan(browser, gen, b));
}
check("…and the verdicts are the hand-computed ones (19 in, 20 past, gen 3 bar 0 in, gen 1 stale)",
  inSpan(agent, 2, 19) === "in-span" && inSpan(agent, 2, 20) === "past-span" && inSpan(agent, 3, 0) === "in-span" && inSpan(agent, 1, 0) === "stale");

console.log("\n7. end markers survive, and the generation continues");
for (const [name, s] of [["agent", agent], ["browser", browser]] as const) {
  const r = stampCircleSet(bag(s, "drum2", "circle"), { id: "drum2", op: "start", bpm: 90, meter: 4, subdivision: 4, countIn: 1 }, { now: T + 9_000, who: ADAM, mayRetime: false });
  check(`${name}: drum2 hydrates ended, and the next start stamps gen 2`, bag(s, "drum2", "circle")?.ended === true && r.ok && r.args.gen === 2, JSON.stringify(r));
}

console.log("\n8–9. authored entries stay refused after hydration");
for (const [name, s] of [["agent", agent], ["browser", browser]] as const) {
  const before = canon(bag(s, "drums", "circle"));
  foldEntry(s, { seq: 900, ts: T + 900, actor: "mallory", verb: "comp", args: { id: "drums", type: "circle", data: { bpm: 40, gen: 9 } } });
  check(`${name}: an untrusted comp of type circle stays refused`, canon(bag(s, "drums", "circle")) === before);
  foldEntry(s, { seq: 901, ts: T + 901, actor: "mallory", verb: "circle-set", args: { ...changeEntry.args, gen: 7 } });
  check(`${name}: a hand-edited non-successor circle-set stays refused`, canon(bag(s, "drums", "circle")) === before);
}

console.log("\n+ the overlap, and failing closed");
{
  const a = agentJoin(snapshot, [changeEntry]).st;
  const b = browserJoin(snapshot, [changeEntry]);
  check("a tail entry the snapshot already covers folds to nothing (agent)", same(bag(a, "drums", "circle"), srv));
  check("…and on the browser", same(bag(b, "drums", "circle"), srv));
  const bad = JSON.parse(JSON.stringify(snapshot));
  bad.entities.drums.comp.circle.gen = "x";
  bad.entities.drums.comp.instrument.synth = "drum-v2";
  const aj = agentJoin(bad);
  const bj = browserJoin(bad);
  check("a malformed circle bag is DROPPED on the agent (fails closed)", bag(aj.st, "drums", "circle") === undefined);
  check("…and on the browser", bag(bj, "drums", "circle") === undefined);
  check("an instrument bag naming an unknown synth is dropped on both", bag(aj.st, "drums", "instrument") === undefined && bag(bj, "drums", "instrument") === undefined);
  check("the diagnostics name the entity and type only — no payload", aj.diag.dropped.length === 2
    && !/bpm|t0|strokes|drum-v2|"x"/.test(JSON.stringify(aj.diag.dropped)), JSON.stringify(aj.diag.dropped));
  check("an intact sibling bag still seeds", bag(aj.st, "drum2", "circle")?.ended === true);
}

console.log("\nNOTE the caption variant (not counted; Weft and Ra's call):");
{
  const c = emptyState();
  foldEntry(c, { seq: 1, ts: T, actor: "ra", verb: "spawn", args: { id: "screen", lib: "x.glb", pos: [0, 0, 0] } });
  foldEntry(c, { seq: 2, ts: T, actor: "ra", verb: "caption", args: { id: "screen", session: "2026-10-01T12:00:00.000Z-abc123", n: 1, t0: 0, t1: 2, text: "hello", gen: 3 } });
  const snap = JSON.parse(JSON.stringify(c));
  const a = agentJoin(snap).st, b = browserJoin(snap);
  console.log(`  captions after late join — browser: ${bag(b, "screen", "captions") ? "PRESENT" : "MISSING"}, agent: ${bag(a, "screen", "captions") ? "PRESENT" : "MISSING"}`);
  console.log("  (red on main too — probes/probe-caption-latejoin.mjs; it turns green only if captions join PROTECTED_COMPS)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
