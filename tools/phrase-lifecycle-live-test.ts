// phrase-lifecycle-live-test — the phrase tables stay bounded on the PRODUCT
// path (Mica's packet review 2026-10-07, blocker 1): real sockets on an owned
// scratch sequencer, legs dying every way a leg can die (close, takeover,
// travel, kick), and a long-running circle. The table SIZES are read through
// the debug request, which answers only when DRUM_PHRASE_STATS=1.
//
//   bun tools/drum-scratch.mjs --label phrase-lifecycle --env DRUM_PHRASE_STATS=1 --env WORLD_ADMIN=admin \
//     -- bun tools/phrase-lifecycle-live-test.ts
//
// Grid: 240 BPM, 2 beats, 1 step a beat → bar 500 ms, step 250 ms; count-in 1.
// The churning legs play LIVE hits: a live hit opens a receipt window and
// claims no slot, so the leg tables are measured on their own. The long-running
// player plays planned passages, which claim slots.
const URL = process.env.WORLD_URL ?? "ws://localhost:8993/ws";
const TOKEN = process.env.JOIN_TOKEN ?? "test-door";
const BAR = 500, H = 16;   // H: DRUM_POLICY.H_BARS (PROVISIONAL)

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Sock = { ws: WebSocket; msgs: any[]; errors: string[]; send(m: any): void; next(p: (m: any) => boolean, ms?: number): Promise<any>; verb(v: string, a: any): void; close(): void };
function open(id: string, world: string): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const s: Sock = {
      ws, msgs: [], errors: [],
      send(m) { ws.send(JSON.stringify(m)); },
      next(pred, ms = 4000) {
        return new Promise((res, rej) => {
          const t0 = Date.now();
          const iv = setInterval(() => { const m = s.msgs.find(pred); if (m) { clearInterval(iv); res(m); } else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`no match in ${ms}ms`)); } }, 10);
        });
      },
      verb(verb, args) { ws.send(JSON.stringify({ type: "verb", verb, args })); },
      close() { try { ws.close(); } catch { /* fine */ } },
    };
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, id, world }));
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); s.msgs.push(m); if (m.type === "error") s.errors.push(m.error); };
    ws.onerror = (e) => reject(e);
    s.next((m) => m.type === "snapshot").then(() => resolve(s), reject);
  });
}

const W = `drumlife-${Math.random().toString(36).slice(2, 8)}`, W2 = `${W}-b`;
console.log(`\nthe phrase tables on the product path — world "${W}"\n`);
const admin = await open("admin", W);
let q = 0;
const stats = async () => {
  const reqId = `s${++q}`;
  admin.send({ type: "debug", phrases: true, reqId });
  const r = await admin.next((m) => m.type === "debug" && m.reqId === reqId);
  // No `phrases` in the answer means the server never measured: NaN, so every
  // comparison fails. (Read as zeros, a server without the repair passed "0 legs
  // left after 120 closes" vacuously, the first time this ran on the base.)
  if (!r.phrases || typeof r.phrases !== "object") return { legs: NaN, receipts: NaN, gens: NaN, bars: NaN, claims: NaN };
  return r.phrases.drums ?? { legs: 0, receipts: 0, gens: 0, bars: 0, claims: 0 };   // a circle with no tables yet
};
const settle = async (want: (s: any) => boolean, ms = 3000) => {   // a close is handled asynchronously
  const t0 = Date.now(); let s = await stats();
  while (!want(s) && Date.now() - t0 < ms) { await sleep(50); s = await stats(); }
  return s;
};

const STROKES = { B: { f0: 80, drop: 2, dropMs: 100, decayMs: 300, noise: 0.1, cutoff: 1200 } };
admin.verb("spawn", { id: "drums", lib: "deco/drum.glb", pos: [0, 0, 0] });
admin.verb("spawn", { id: "hand", lib: "deco/drum.glb", pos: [1, 0, 0] });
await sleep(300);
admin.verb("circle-set", { id: "drums", op: "start", bpm: 240, meter: 2, subdivision: 1, countIn: 1 });
admin.verb("instrument-set", { id: "hand", circle: "drums", name: "hand", synth: "drum-v1", strokes: STROKES });
const circleE = (await admin.next((m) => m.type === "log" && m.entry?.verb === "circle-set")).entry.args;
await admin.next((m) => m.type === "log" && m.entry?.verb === "instrument-set");
const T0 = circleE.t0;
await sleep(Math.max(0, T0 + BAR + 100 - Date.now()));   // past the count-in (bar 0)
check("the debug request answers with table sizes (DRUM_PHRASE_STATS=1)", Number.isFinite((await stats()).legs));
const hit = (s: Sock, n: number) => { s.send({ type: "phrase", live: true, circle: "drums", gen: 1, voice: "hand", voiceGen: 1, stroke: "B", n, step: "next" }); return s.next((m) => m.type === "phrase-receipt" && m.n === n); };

console.log("1. 120 legs join, play, and CLOSE");
let ok1 = 0;
for (let i = 0; i < 120; i++) {
  const s = await open(`c${i}`, W);
  if ((await hit(s, 1)).ok) ok1++;
  s.close();
}
const s1 = await settle((s) => s.legs === 0);
check("all 120 hits accepted", ok1 === 120, `${ok1}`);
check("after 120 closed legs, no receipt window is left (was 120 before the repair)", s1.legs === 0 && s1.receipts === 0, JSON.stringify(s1));

console.log("\n2. 20 TAKEOVERS of one identity");
let tk: Sock | null = null, fresh = 0;
for (let i = 0; i < 20; i++) {
  tk = await open("tk", W);   // each join retires the previous leg of "tk"
  const r = await hit(tk, 1);
  if (r.ok && !r.dup) fresh++;
}
const s2 = await settle((s) => s.legs === 1);
check("each new leg's n 1 is judged fresh, never a dup of a retired leg's n 1", fresh === 20, `${fresh}/20`);
check("after 20 takeovers, only the live leg keeps a window: 1 leg", s2.legs === 1 && s2.receipts === 1, JSON.stringify(s2));

console.log("\n3. a leg TRAVELS to another world");
const tv = await open("tv", W);
await hit(tv, 1);
const s3a = await stats();
tv.send({ type: "join", token: TOKEN, id: "tv", world: W2 });
await tv.next((m) => m.type === "snapshot" && tv.msgs.filter((x) => x.type === "snapshot").length >= 2);
const s3 = await settle((s) => s.legs === 1);
check("before travel: 2 legs (tk, tv); after: 1 — the traveller's window left with it", s3a.legs === 2 && s3.legs === 1, `${s3a.legs} → ${s3.legs}`);

console.log("\n4. a leg is KICKED");
const kx = await open("kx", W);
await hit(kx, 1);
const s4a = await stats();
admin.verb("kick", { id: "kx", reason: "lifecycle test" });
const s4 = await settle((s) => s.legs === 1);
check("before the kick: 2 legs; after: 1 — the expelled leg's window is released", s4a.legs === 2 && s4.legs === 1, `${s4a.legs} → ${s4.legs}`);

console.log("\n5. a long-running circle: one player keeps booking two bars ahead for 40 bars");
const lr = await open("lr", W);
let lastBar = -1, n = 0, maxBars = 0, maxClaims = 0, refused = 0;
const curBar = () => Math.floor((Date.now() - T0) / BAR);
const startBar = curBar();
while (curBar() < startBar + 40) {
  if (lastBar - curBar() > 2) { await sleep(60); continue; }
  const bar = lastBar < 0 ? curBar() + 2 : lastBar + 1;
  lr.send({ type: "phrase", circle: "drums", gen: 1, voice: "hand", voiceGen: 1, bar, bars: 2, pattern: "B.B.", n: ++n });
  const r = await lr.next((m) => m.type === "phrase-receipt" && m.n === n);
  if (r.ok) lastBar = r.bar + r.bars - 1; else { refused++; lastBar = -1; }
  const s = await stats();
  maxBars = Math.max(maxBars, s.bars); maxClaims = Math.max(maxClaims, s.claims);
}
check("the player kept the circle going: passages accepted, ~20 of them", n >= 15 && refused === 0, `${n} sent, ${refused} refused`);
check(`claimed bars stay unbegun and inside the horizon: at most H = ${H} at any time (here a few)`, maxBars <= H && maxBars >= 2 && maxClaims === maxBars, `max ${maxBars} bars, ${maxClaims} claims`);
const dupR = (lr.send({ type: "phrase", circle: "drums", gen: 1, voice: "hand", voiceGen: 1, bar: lastBar - 1, bars: 2, pattern: "B.B.", n }), await lr.next((m) => m.type === "phrase-receipt" && m.n === n && m.dup === true));
check("a resend of the last n still returns the original receipt, marked dup", dupR.dup === true && dupR.ok === true, JSON.stringify(dupR));
lr.send({ type: "phrase", circle: "drums", gen: 1, voice: "hand", voiceGen: 1, bar: lastBar - 1, bars: 2, pattern: "B.B.", n: ++n });
const takenR = await lr.next((m) => m.type === "phrase-receipt" && m.n === n);
check("the same bars under a new n are still refused by name: the slot is taken", takenR.ok === false && /already taken/.test(takenR.why ?? ""), JSON.stringify(takenR));

console.log("\n6. everyone leaves");
tk?.close(); lr.close();
const s6 = await settle((s) => s.legs === 0);
check("with every player gone, no receipt window is left", s6.legs === 0 && s6.receipts === 0, JSON.stringify(s6));
check("the admin's verbs drew no refusals", admin.errors.length === 0, admin.errors.join("; "));

admin.close();
await sleep(200);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
