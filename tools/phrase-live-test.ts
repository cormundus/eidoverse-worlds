// phrase-live-test — the phrase plane over REAL websockets on an owned scratch
// sequencer (design rev 5 §2.3, §2.4, §2.5, §4.1, §4.3; acceptance A4, A9,
// and the stateful half of Mica's multi-bar suite, IMPLEMENTATION-CARRY 8).
//
//   bun tools/drum-scratch.mjs --label phrase-live -- bun tools/phrase-live-test.ts
//
// Fast grid: bpm 240, meter 2, subdivision 1 → step 250 ms, bar 500 ms,
// 2 steps per bar. The test runs on the same machine as the server, so its
// Date.now() is the server's clock (the browser uses serverNow(); here the
// two coincide by construction).

const URL = process.env.WORLD_URL ?? "ws://localhost:8993/ws";
const TOKEN = process.env.JOIN_TOKEN ?? "test-door";
const BAR = 500, STEP = 250;

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sock = { msgs: any[]; errors: string[]; send(m: any): void; next(p: (m: any) => boolean, ms?: number): Promise<any>;
  verb(v: string, a: any): void; req(m: any, id: string): Promise<any>; close(): void };
function open(joinMsg: Record<string, unknown>): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const s: Sock = {
      msgs: [], errors: [],
      send(m) { ws.send(JSON.stringify(m)); },
      next(pred, ms = 4000) {
        return new Promise((res, rej) => {
          const hit = s.msgs.find(pred); if (hit) return res(hit);
          const t0 = Date.now();
          const iv = setInterval(() => { const m = s.msgs.find(pred); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`no match in ${ms}ms`)); } }, 15);
        });
      },
      verb(verb, args) { ws.send(JSON.stringify({ type: "verb", verb, args })); },
      req(m, reqId) { ws.send(JSON.stringify({ ...m, reqId })); return s.next((x) => x.reqId === reqId); },
      close() { try { ws.close(); } catch { /* fine */ } },
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, ...joinMsg }));
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); s.msgs.push(m); if (m.type === "error") s.errors.push(m.error); };
    ws.onerror = (e) => reject(e);
    s.next((m) => m.type === "snapshot").then(() => resolve(s), reject);
  });
}
const receipt = (s: Sock, n: number, after = 0) => s.next((m) => m.type === "phrase-receipt" && m.n === n && s.msgs.indexOf(m) >= after);
const relays = (s: Sock, pred: (m: any) => boolean = () => true) => s.msgs.filter((m) => m.type === "phrase" && pred(m));

const W = `drumphrase-${Math.random().toString(36).slice(2, 8)}`;
console.log(`\nthe phrase plane, live — world "${W}"\n`);
const alice = await open({ id: "alice", world: W });
await sleep(300);
alice.verb("spawn", { id: "drums", lib: "deco/drum.glb", pos: [0, 0, 0] });
alice.verb("spawn", { id: "hand", lib: "deco/drum.glb", pos: [1, 0, 0] });
await sleep(150);
alice.verb("circle-set", { id: "drums", op: "start", bpm: 240, meter: 2, subdivision: 1, countIn: 1 });
alice.verb("instrument-set", { id: "hand", circle: "drums", name: "hand", synth: "drum-v1",
  strokes: { B: { f0: 80, drop: 2, dropMs: 120, decayMs: 400, noise: 0.1, cutoff: 1200 }, S: { f0: 400, drop: 1.2, dropMs: 20, decayMs: 120, noise: 0.7, cutoff: 3800 } } });
const circleE = (await alice.next((m) => m.type === "log" && m.entry?.verb === "circle-set")).entry.args;
const t0 = circleE.t0, gen = circleE.gen;
const bob = await open({ id: "bob", world: W });
const carol = await open({ id: "carol", world: W });
const eye = await open({ id: "eye", world: W, spectate: true });
const base = { type: "phrase", circle: "drums", gen, voice: "hand", voiceGen: 1 };
const curBar = () => Math.floor((Date.now() - t0) / BAR);

console.log("1. the count-in, and the initiator");
let r = (bob.send({ ...base, bar: 0, pattern: "B.", n: 1 }), await receipt(bob, 1));
check("bob's bar 0 is refused: count-in — the circle opens at bar 1", !r.ok && r.why === "count-in — the circle opens at bar 1", JSON.stringify(r));
r = (alice.send({ ...base, bar: 0, pattern: "BS", n: 1 }), await receipt(alice, 1));
check("alice (the initiator) plays bar 0", r.ok && r.bar === 0, JSON.stringify(r));
await sleep(Math.max(0, t0 + BAR - Date.now()) + 100);   // past the count-in

console.log("\n2. a planned passage: receipt to the sender, relay to everyone else");
const mark = bob.msgs.length;
bob.send({ ...base, bar: "next", bars: 2, pattern: "B.|.S", n: 10, author: "mallory", legGen: 999 });
r = await receipt(bob, 10, mark);
check("accepted, with bar, bars, acceptedAt and scheduledAt", r.ok && r.bars === 2 && Number.isInteger(r.bar) && typeof r.scheduledAtServerMs === "number" && typeof r.acceptedAtServerMs === "number", JSON.stringify(r));
check("scheduledAt is that bar's step 0 on the grid", Math.abs(r.scheduledAtServerMs - (t0 + r.bar * BAR)) < 1e-6);
// wait on n alone: a predicate that also matched author would HANG on the
// very defect this check exists to catch (the author-from-client mutant
// "survived" exactly that way), instead of reporting it
const rel = await carol.next((m) => m.type === "phrase" && m.n === 10);
check("carol hears it: author = bob (the client's 'mallory' ignored), legGen from the server (not 999)", rel.author === "bob" && Number.isInteger(rel.legGen) && rel.legGen !== 999, JSON.stringify(rel));
check("the relayed pattern has its `|` removed", rel.pattern === "B..S");
check("the spectator hears it too (a performance is watchable)", !!(await eye.next((m) => m.type === "phrase" && m.n === 10)));
await sleep(150);
check("bob is NOT sent his own relay (he schedules from his receipt)", relays(bob, (m) => m.n === 10).length === 0);
const firstBar = r.bar;

console.log("\n3. idempotent resend, and a retry after a drop (the receipt window)");
const relayCount = () => relays(carol, (m) => m.author === "bob").length;
const before = relayCount();
const m2 = bob.msgs.length;
bob.send({ ...base, bar: "next", bars: 2, pattern: "B.|.S", n: 10 });
const dup = await receipt(bob, 10, m2);
check("a resend of n 10 returns the ORIGINAL receipt, marked dup", dup.dup === true && dup.bar === firstBar && dup.acceptedAtServerMs === r.acceptedAtServerMs, JSON.stringify(dup));
await sleep(200);
check("…and relays nothing", relayCount() === before);
bob.send({ ...base, bar: firstBar + 6, pattern: "S.", n: 12 });
await receipt(bob, 12);
bob.send({ ...base, bar: firstBar + 7, pattern: "S.", n: 11 });
const r11 = await receipt(bob, 11);
check("n 11 after n 12 (as if 11 had been dropped and retried) is judged as new — never 'old n'", r11.ok && !r11.dup, JSON.stringify(r11));

console.log("\n4. planned slots: one per (author, voice, gen, bar)");
const sb = firstBar + 10;
bob.send({ ...base, bar: sb, pattern: "B.", n: 20 });
check("bob claims bar " + sb, (await receipt(bob, 20)).ok);
bob.send({ ...base, bar: sb, pattern: ".B", n: 21 });
const s21 = await receipt(bob, 21);
check("a second planned phrase for the same bar is refused, never swapped in", !s21.ok && /already taken/.test(s21.why), s21.why);
bob.send({ ...base, bar: sb - 1, bars: 3, pattern: "B.|.B|B.", n: 22 });
const s22 = await receipt(bob, 22);
check("a 3-bar passage overlapping only its MIDDLE bar is refused whole", !s22.ok && new RegExp(`bar ${sb}`).test(s22.why), s22.why);
carol.send({ ...base, bar: sb, pattern: "B.", n: 1 });
check("the same bar from a SECOND author on the same drum is permitted (slots are author-scoped)", (await receipt(carol, 1)).ok);

console.log("\n5. live hits: the server's half of the timing");
const k = (curBar() + 3) * 2;   // a step comfortably ahead, chosen as a synced client would
bob.send({ ...base, live: true, step: k, stroke: "B", n: 30 });
const lh = await receipt(bob, 30);
check("a synced live hit is accepted, basis client-step", lh.ok && lh.basis === "client-step" && Math.abs(lh.scheduledAtServerMs - (t0 + k * STEP)) < 1e-6, JSON.stringify(lh));
check("…arrivalToGridMs = scheduledAt − acceptedAt, and no press time is claimed",
  Math.abs(lh.arrivalToGridMs - (lh.scheduledAtServerMs - lh.acceptedAtServerMs)) < 1e-6 && !("pressToGridMs" in lh));
bob.send({ ...base, live: true, step: "next", stroke: "S", n: 31 });
const ln = await receipt(bob, 31);
check("an unsynced 'next' is placed at least L after arrival, basis arrival", ln.ok && ln.basis === "arrival" && ln.arrivalToGridMs >= 150 && ln.arrivalToGridMs < 150 + STEP, JSON.stringify(ln));
bob.send({ ...base, live: true, step: 2, stroke: "B", n: 32 });
const lp = await receipt(bob, 32);
check("a step already past is refused (local only), never moved", !lp.ok && /too late/.test(lp.why), lp.why);
bob.send({ ...base, live: true, step: k, stroke: "B", n: 33 });
check("live hits are additive: a second hit on the same step is accepted", (await receipt(bob, 33)).ok);

console.log("\n6. refusals are receipts, never silence");
eye.send({ ...base, bar: "next", pattern: "B.", n: 1 });
const se = await receipt(eye, 1);
check("a spectator gets a receipt: can't play", !se.ok && /spectators/.test(se.why), JSON.stringify(se));
const burst = bob.msgs.length;
for (let i = 0; i < 20; i++) bob.send({ ...base, bar: "next", pattern: "Q.", n: 100 + i });   // invalid letter; rate matters here
await sleep(600);
const burstR = bob.msgs.slice(burst).filter((m) => m.type === "phrase-receipt" && m.n >= 100 && m.n < 120);
check("all 20 burst messages are receipted", burstR.length === 20, String(burstR.length));
check("past 16 per second, the refusal names the phrase rate", burstR.some((m) => /phrase rate/.test(m.why)), JSON.stringify(burstR.map((m) => m.why).slice(14)));
check("a letter outside the alphabet is refused by name", burstR.some((m) => /letter "Q"/.test(m.why)));

console.log("\n7. too old to verify");
await sleep(1100);
for (let i = 0; i < 64; i++) { bob.send({ ...base, bar: "next", pattern: "Q.", n: 200 + i }); if (i % 12 === 11) await sleep(1050); }
await receipt(bob, 263, 0);
bob.send({ ...base, bar: "next", pattern: "B.", n: 50 });
const old = await receipt(bob, 50);
check("with the window full (64), an n older than all of it is refused: too old to verify", !old.ok && old.why === "too old to verify", JSON.stringify(old));

console.log("\n8. end, then restart: the tables clear, the generation continues");
alice.verb("circle-set", { id: "drums", op: "end" });
await sleep(300);
bob.send({ ...base, bar: "next", pattern: "B.", n: 300 });
check("after end, a phrase is refused: the circle has ended", /ended/.test((await receipt(bob, 300)).why ?? ""));
alice.verb("circle-set", { id: "drums", op: "start", bpm: 240, meter: 2, subdivision: 1, countIn: 1 });
const restart = (await alice.next((m) => m.type === "log" && m.entry?.verb === "circle-set" && m.entry.args.op === "start" && m.entry.args.gen > gen)).entry.args;
check("the restart continues the generation", restart.gen === gen + 2 || restart.gen === gen + 1, JSON.stringify(restart));
await sleep(Math.max(0, restart.t0 + BAR - Date.now()) + 100);
const m10 = bob.msgs.length;
bob.send({ ...base, gen: restart.gen, bar: "next", pattern: "B.", n: 10 });
const fresh = await receipt(bob, 10, m10);
check("n 10 again, in the restarted circle: a FRESH receipt, never the old one marked dup", fresh.ok && !fresh.dup && fresh.gen === restart.gen, JSON.stringify(fresh));

console.log("\n9. no retention (A9): nothing in the world log records a phrase");
const hist = await alice.req({ type: "history", limit: 1000 }, "h-all");
const verbs = new Set((hist.entries ?? []).map((e: any) => e.verb));
check("the log holds circle-set and instrument-set, and NO phrase", verbs.has("circle-set") && verbs.has("instrument-set") && !verbs.has("phrase") && ![...verbs].some((v) => String(v).includes("phrase")),
  [...verbs].join(","));

for (const s of [alice, bob, carol, eye]) s.close();
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
