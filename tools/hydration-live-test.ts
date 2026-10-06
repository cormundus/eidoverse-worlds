// hydration-live-test — the hydration contract with the REAL headless agent
// (mcpl/agent.ts WorldAgent) over a live socket, on an owned scratch world
// (design rev 5, §4.7 and §4.4; acceptance A12).
//
//   bun tools/drum-scratch.mjs --label hydration-live --env FOLD_EVERY=1 -- bun tools/hydration-live-test.ts
//
// FOLD_EVERY=1 is REQUIRED: it makes the world fold after every entry, so a
// joiner's tail is empty and the agent's bags can only come from the snapshot.
//
// A builder takes a circle to gen 3 with a live `prev` (start → end → start →
// change), a drum to voiceGen 3, and a second circle to an ended marker. Then
// a FRESH WorldAgent joins: its seeded bags must equal the server's snapshot,
// and must equal what the real browser hydrate() makes of that same snapshot.
// A live edit after the join must fold onto the seeded generation. And a leave
// must carry the departing leg's generation, increasing across two legs.
// Fast grid: bpm 240, meter 2, subdivision 1 → bar 500 ms.
import { WorldAgent } from "../mcpl/agent.ts";
import { hydrate, state as browserState, reset as browserReset } from "../client/lib/state.js";

const URL = process.env.WORLD_URL ?? "ws://localhost:8993/ws";
const TOKEN = process.env.JOIN_TOKEN ?? "test-door";
process.env.WORLD_TOKEN = TOKEN;   // WorldAgent's join reads WORLD_TOKEN
const BAR = 500;

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const canon = (v: any): string => v === undefined ? "undefined" : JSON.stringify(v, (_k, x) =>
  x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x);
const same = (a: any, b: any) => canon(a) === canon(b);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sock = { msgs: any[]; errors: string[]; next(p: (m: any) => boolean, ms?: number): Promise<any>; verb(v: string, a: any): void; close(): void };
function open(joinMsg: Record<string, unknown>): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const s: Sock = {
      msgs: [], errors: [],
      next(pred, ms = 4000) {
        return new Promise((res, rej) => {
          const hit = s.msgs.find(pred); if (hit) return res(hit);
          const t0 = Date.now();
          const iv = setInterval(() => { const m = s.msgs.find(pred); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`no match in ${ms}ms`)); } }, 20);
        });
      },
      verb(verb, args) { ws.send(JSON.stringify({ type: "verb", verb, args })); },
      close() { try { ws.close(); } catch { /* fine */ } },
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, ...joinMsg }));
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); s.msgs.push(m); if (m.type === "error") s.errors.push(m.error); };
    ws.onerror = (e) => reject(e);
    s.next((m) => m.type === "snapshot").then(() => resolve(s), reject);
  });
}

const W = `drumhydr-${Math.random().toString(36).slice(2, 8)}`;
console.log(`\nhydration with the real agent — world "${W}"\n`);
const alice = await open({ id: "alice", world: W });
await sleep(300);
alice.verb("spawn", { id: "drums", lib: "deco/drum.glb", pos: [0, 0, 0] });
alice.verb("spawn", { id: "drum2", lib: "deco/drum.glb", pos: [2, 0, 0] });
await sleep(200);
const FAST = { bpm: 240, meter: 2, subdivision: 1 };
alice.verb("circle-set", { id: "drums", op: "start", ...FAST });
await sleep(150);
alice.verb("circle-set", { id: "drums", op: "end" });
await sleep(150);
alice.verb("circle-set", { id: "drums", op: "start", ...FAST });
await sleep(BAR + 200);                         // past its t0
alice.verb("circle-set", { id: "drums", op: "change", bpm: 120 });   // gen 3, prev = gen 2 for ~8.5 s
alice.verb("circle-set", { id: "drum2", op: "start", ...FAST, countIn: 2 });
await sleep(150);
alice.verb("circle-set", { id: "drum2", op: "end" });
const STROKES = { B: { f0: 80, drop: 2, dropMs: 120, decayMs: 400, noise: 0.1, cutoff: 1200 } };
for (const volume of [0.8, 0.6, 0.5]) alice.verb("instrument-set", { id: "drums", circle: "drums", name: "hand", synth: "drum-v1", strokes: STROKES, volume });
await sleep(500);
check("the builder's script ran without refusals", alice.errors.length === 0, alice.errors.join("; "));

console.log("\n1. the server's truth (a fresh spectator's snapshot)");
const eye = await open({ id: "eye", world: W, spectate: true });
const snap = eye.msgs.find((m) => m.type === "snapshot").state;
const srvC = snap.entities.drums.comp.circle, srvI = snap.entities.drums.comp.instrument;
check("drums: gen 3 with a live prev at gen 2 (mid-handover)", srvC?.gen === 3 && srvC?.prev?.gen === 2 && srvC?.prev?.until === srvC?.t0 && Date.now() < srvC.t0, canon(srvC));
check("drums: voiceGen 3", srvI?.voiceGen === 3 && srvI?.volume === 0.5);
check("drum2: ended at gen 1", snap.entities.drum2.comp.circle?.ended === true && snap.entities.drum2.comp.circle?.gen === 1);

// The join must exercise the SNAPSHOT path: if the tail still carried the
// circle's own entries, an agent could fold them and pass without seeding at
// all (found the hard way: on the parent commit this test passed for exactly
// that reason). Run under FOLD_EVERY=1 so the world folds after every entry,
// and prove the tail is empty of the circle's history.
const tail = eye.msgs.find((m) => m.type === "snapshot").entries ?? [];
check("the join tail carries none of the circle's history (the world has folded) — the bags can only come from the snapshot",
  !tail.some((e: any) => e.verb === "circle-set" || e.verb === "instrument-set"),
  `tail verbs: ${tail.map((e: any) => e.verb).join(",")} — run with --env FOLD_EVERY=1`);

console.log("\n2. a FRESH real WorldAgent joins");
const agent = new WorldAgent({ url: URL, world: W, name: "resident" });
await agent.connect();
await sleep(400);
const ast: any = (agent as any).st;
for (const [id, t] of [["drums", "circle"], ["drums", "instrument"], ["drum2", "circle"]]) {
  check(`agent ${id}.${t} = server`, same(ast?.entities?.[id]?.comp?.[t], snap.entities[id].comp[t]), canon(ast?.entities?.[id]?.comp?.[t]));
}
browserReset?.();
hydrate(snap, [], -1);
for (const [id, t] of [["drums", "circle"], ["drums", "instrument"], ["drum2", "circle"]]) {
  check(`browser hydrate ${id}.${t} = agent`, same((browserState.st as any).entities?.[id]?.comp?.[t], ast?.entities?.[id]?.comp?.[t]));
}

console.log("\n3. the tail folds onto the seeded generations");
alice.verb("instrument-set", { id: "drums", circle: "drums", name: "hand", synth: "drum-v1", strokes: STROKES, volume: 0.4 });
await sleep(500);
check("a live edit after the join reaches the agent as voiceGen 4", ast?.entities?.drums?.comp?.instrument?.voiceGen === 4 && ast.entities.drums.comp.instrument.volume === 0.4,
  canon(ast?.entities?.drums?.comp?.instrument));
alice.verb("comp", { id: "drums", type: "circle", data: { bpm: 40, gen: 9 } });
await sleep(300);
check("a forged comp of type circle is refused and the agent's bag is unchanged", ast.entities.drums.comp.circle.gen === 3 && ast.entities.drums.comp.circle.bpm === 120);

console.log("\n4. a leave carries the departing leg's generation (additive `gen`)");
const leaves = () => alice.msgs.filter((m) => m.type === "leave" && m.id === "carol");
let carol = await open({ id: "carol", world: W });
carol.close();
await alice.next((m) => m.type === "leave" && m.id === "carol");
carol = await open({ id: "carol", world: W });
carol.close();
await sleep(600);
const [l1, l2] = leaves();
check("leave carries an integer gen", Number.isInteger(l1?.gen), JSON.stringify(l1));
check("a later leg of the same identity leaves with a higher gen", Number.isInteger(l2?.gen) && l2.gen > l1.gen, `${l1?.gen} → ${l2?.gen}`);

agent.close(); alice.close(); eye.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
