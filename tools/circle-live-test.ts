// circle-live-test — the drum circle's two verbs over REAL websockets, on an
// owned scratch sequencer (design rev 5 §2.1, §2.2, §2.6; acceptance A11).
//
//   bun tools/drum-scratch.mjs --label circle-live -- bun tools/circle-live-test.ts
//
// (drum-scratch passes WORLD_URL and JOIN_TOKEN.) A fast grid keeps the
// waits short: bpm 240, meter 2, subdivision 1 → beat 250 ms, bar 500 ms.
//
// The door stamps t0/gen/initiator from the SERVER's clock; the test can only
// see the server's clock through the entry's own `ts` (stamped at commit, a
// hair after the door ran), so timing checks are written against `ts`.

const URL = process.env.WORLD_URL ?? "ws://localhost:8993/ws";
const TOKEN = process.env.JOIN_TOKEN ?? "test-door";
const HTTP = URL.replace(/^ws/, "http").replace(/\/ws$/, "");
const BAR = 500;   // bpm 240, meter 2, subdivision 1: 2 × 250 ms

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

type Sock = {
  msgs: any[]; errors: string[];
  next(pred: string | ((m: any) => boolean), ms?: number): Promise<any>;
  verb(verb: string, args: any): void;
  req(msg: any, reqId: string): Promise<any>;
  settle(ms?: number): Promise<void>;
  close(): void;
};
function open(joinMsg: Record<string, unknown>): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const s: Sock = {
      msgs: [], errors: [],
      next(pred, ms = 4000) {
        const want = typeof pred === "string" ? (m: any) => m.type === pred : pred;
        return new Promise((res, rej) => {
          const hit = s.msgs.find(want); if (hit) return res(hit);
          const t0 = Date.now();
          const iv = setInterval(() => {
            const m = s.msgs.find(want);
            if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`no match in ${ms}ms`)); }
          }, 20);
        });
      },
      verb(verb, args) { ws.send(JSON.stringify({ type: "verb", verb, args })); },
      req(msg, reqId) { ws.send(JSON.stringify({ ...msg, reqId })); return s.next((m) => m.reqId === reqId); },
      settle(ms = 300) { return new Promise((r) => setTimeout(r, ms)); },
      close() { try { ws.close(); } catch { /* fine */ } },
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, ...joinMsg }));
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); s.msgs.push(m); if (m.type === "error") s.errors.push(m.error); };
    ws.onerror = (e) => reject(e);
    s.next("snapshot").then(() => resolve(s), reject);
  });
}
const logOf = (s: Sock, verb: string, pred: (a: any) => boolean = () => true) =>
  s.next((m) => m.type === "log" && m.entry?.verb === verb && pred(m.entry.args));
const lastErr = (s: Sock) => s.errors[s.errors.length - 1] ?? "";
async function errAfter(s: Sock, fn: () => void, ms = 400) {
  const before = s.errors.length; fn(); await s.settle(ms);
  return s.errors.length > before ? s.errors[s.errors.length - 1] : null;
}

const W = `drumlive-${Math.random().toString(36).slice(2, 8)}`;
console.log(`\ndrum circle verbs, live — world "${W}"\n`);

const alice = await open({ id: "alice", world: W });
await alice.settle();   // first joiner: auto-owner grant
alice.verb("spawn", { id: "drums", lib: "deco/drum.glb", pos: [0, 0, 0] });
alice.verb("spawn", { id: "drum2", lib: "deco/drum.glb", pos: [2, 0, 0] });
await alice.settle();

console.log("1. start: the server stamps t0, gen and initiator");
alice.verb("circle-set", { id: "drums", op: "start", bpm: 240, meter: 2, subdivision: 1, t0: 1, gen: 99, initiator: { id: "mallory" } });
const startE = (await logOf(alice, "circle-set", (a) => a.op === "start")).entry.args;
const startEntry = alice.msgs.find((m) => m.type === "log" && m.entry?.verb === "circle-set").entry;
check("a client's gen 99 is dropped: gen 1", startE.gen === 1, JSON.stringify(startE));
check("a client's initiator is dropped: alice", startE.initiator?.id === "alice");
check("t0 ≈ acceptance + one bar (500 ms), on the server's clock", Math.abs(startE.t0 - (startEntry.ts + BAR)) < 50,
  `t0 − ts = ${startE.t0 - startEntry.ts}`);
check("countIn defaults to 1", startE.countIn === 1);
// inside the one bar of grace (t0 is 500 ms after acceptance), so this lands
// BEFORE the circle has started
let e = await errAfter(alice, () => alice.verb("circle-set", { id: "drums", op: "change", bpm: 120 }), 100);
check("a change before the circle has started is refused", !!e && /hasn't started/.test(e), String(e));

console.log("\n2. who may retime");
// an owned world defaults drop-in guests to builder; bob is explicitly demoted
// (comptest's own pattern) so the rank gate is what refuses him
alice.verb("grant", { id: "bob", role: "visitor" });
alice.verb("grant", { id: "carol", role: "builder" });
await alice.settle();
const bob = await open({ id: "bob", world: W });
e = await errAfter(bob, () => bob.verb("circle-set", { id: "drums", op: "change", bpm: 120 }));
check("a visitor is refused (builder rank)", !!e && /builder rights/.test(e), String(e));
const carol = await open({ id: "carol", world: W });
e = await errAfter(carol, () => carol.verb("circle-set", { id: "drums", op: "change", bpm: 120 }));
check("a builder who is not the initiator is refused", !!e && /only alice/.test(e), String(e));
await alice.settle(BAR + 200);   // well past t0
e = await errAfter(alice, () => alice.verb("circle-set", { id: "drums", op: "change", bpm: 120, lead: 15 }));
check("lead 15 (< H = 16) is refused", !!e && /at least 16 bars/.test(e), String(e));

console.log("\n3. a change, with lead time");
const before = alice.msgs.length;
alice.verb("circle-set", { id: "drums", op: "change", bpm: 120 });
const chEntry = (await alice.next((m) => alice.msgs.indexOf(m) >= before && m.type === "log" && m.entry?.verb === "circle-set" && m.entry.args.op === "change")).entry;
const ch = chEntry.args;
const barAtTs = Math.floor((chEntry.ts - startE.t0) / BAR);
check("gen 1 → 2", ch.gen === 2);
check("lead defaults to 16", ch.lead === 16);
check("atBar = current bar + 17 (the door ran at or just before ts)", ch.atBar - barAtTs === 17 || ch.atBar - barAtTs === 16,
  `atBar ${ch.atBar}, bar at ts ${barAtTs}`);
check("new t0 = old t0 + atBar × 500", Math.abs(ch.t0 - (startE.t0 + ch.atBar * BAR)) < 1e-6);
e = await errAfter(alice, () => alice.verb("circle-set", { id: "drums", op: "change", bpm: 100 }));
check("a second change while one is pending is refused, naming its bar", !!e && new RegExp(`bar ${ch.atBar}`).test(e), String(e));
const late = await open({ id: "dana", world: W });
const snap = late.msgs.find((m) => m.type === "snapshot");
const folded = snap?.state?.entities?.drums?.comp?.circle;
check("a fresh joiner's snapshot carries the folded circle with prev", folded?.gen === 2 && folded?.prev?.gen === 1 && folded?.prev?.until === ch.t0,
  JSON.stringify(folded));

console.log("\n4. one writer path");
e = await errAfter(alice, () => alice.verb("comp", { id: "drums", type: "circle", data: { bpm: 60, gen: 9 } }));
check("even the owner's comp of type circle is refused", !!e && /circle-set/.test(e), String(e));
e = await errAfter(alice, () => alice.verb("comp", { id: "drums", type: "instrument", data: { voiceGen: 9 } }));
check("comp of type instrument is refused", !!e && /instrument-set/.test(e), String(e));
e = await errAfter(alice, () => alice.verb("circle-set", { id: "nowhere", op: "start", bpm: 90, meter: 4, subdivision: 4 }));
check("a circle-set naming a missing entity is refused", !!e && /not here/.test(e), String(e));

console.log("\n5. instruments, guard and lock");
const STROKES = { B: { f0: 80, drop: 2, dropMs: 120, decayMs: 400, noise: 0.1, cutoff: 1200 } };
carol.verb("instrument-set", { id: "drums", circle: "drums", name: "low", synth: "drum-v1", strokes: STROKES, voiceGen: 40 });
const i1 = (await logOf(carol, "instrument-set")).entry.args;
check("instrument-set: voiceGen 1 (a client's 40 dropped)", i1.voiceGen === 1, JSON.stringify(i1));
e = await errAfter(carol, () => carol.verb("instrument-set", { id: "drums", circle: "drums", name: "low", synth: "drum-v2", strokes: STROKES }));
check("an unknown synth is refused", !!e && /unknown synth/.test(e), String(e));
alice.verb("comp", { id: "drums", type: "guard", data: true });
await alice.settle();
e = await errAfter(carol, () => carol.verb("instrument-set", { id: "drums", circle: "drums", name: "low", synth: "drum-v1", strokes: STROKES }));
check("a builder who isn't the placer is refused on a GUARDED drum (GUARD_AUTHORED)", !!e && /guarded/.test(e), String(e));
alice.verb("comp", { id: "drum2", type: "lock", data: true });
await alice.settle();
e = await errAfter(carol, () => carol.verb("instrument-set", { id: "drum2", circle: "drums", name: "hand", synth: "drum-v1", strokes: STROKES }));
check("…but MAY tune a LOCKED, unguarded drum (off LOCK_GUARDED)", e === null, String(e));

console.log("\n6. scripts may not emit the server-stamped verbs (§2.6)");
const src = `world.on('say', (e) => { if (e.text === 'drum it') world.emit('circle-set', { id: 'drum2', op: 'start', bpm: 120, meter: 4, subdivision: 4 }); });`;
const up = await fetch(`${HTTP}/upload?as=script&token=${TOKEN}&by=circle-live-test`, { method: "POST", body: src });
const path = up.ok ? (await up.json()).path : "";
check("script uploads", /^store\/scripts\//.test(path), `${up.status}`);
alice.verb("comp", { id: "drum2", type: "lock", data: null });
alice.verb("behavior", { id: "forger", src: path, attach: "drum2", caps: { verbs: ["circle-set", "say"] } });
await alice.settle(800);
alice.verb("say", { text: "drum it" });
await alice.settle(800);
const dbg = await alice.req({ type: "debug", kinds: ["script-error"], limit: 50 }, "dbg-forge");
check("the emit is refused by name", dbg.events.some((x: any) => /script emits may not "circle-set"/.test(String(x.error))), JSON.stringify(dbg.events));
const fresh = await open({ id: "erin", world: W });
check("…and drum2 has no circle", !fresh.msgs.find((m) => m.type === "snapshot")?.state?.entities?.drum2?.comp?.circle);

console.log("\n7. end, then start again: the generation continues");
alice.verb("circle-set", { id: "drums", op: "end" });
const endE = (await logOf(alice, "circle-set", (a) => a.op === "end")).entry.args;
check("end keeps gen 2", endE.gen === 2, JSON.stringify(endE));
alice.verb("comp", { id: "drums", type: "guard", data: null });
await alice.settle();
carol.verb("circle-set", { id: "drums", op: "start", bpm: 100, meter: 4, subdivision: 4, countIn: 2 });
const re = (await logOf(carol, "circle-set", (a) => a.op === "start" && a.bpm === 100)).entry.args;
check("a new start continues: gen 3, never 1", re.gen === 3, JSON.stringify(re));
check("…with carol as its initiator, and countIn 2", re.initiator?.id === "carol" && re.countIn === 2);

for (const s of [alice, bob, carol, late, fresh]) s.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
