// drum-mcpl-test — the drum circle for text-tier residents, with the REAL
// headless agent (mcpl/agent.ts WorldAgent) and the REAL `play` tool handler
// (mcpl/tools.ts) over live sockets, on an owned scratch world (design rev 5
// §5; acceptance A4's tool half, A9's intake end, and Mica's initiator-left
// wording, IMPLEMENTATION-CARRY 7).
//
//   bun tools/drum-scratch.mjs --label drum-mcpl -- bun tools/drum-mcpl-test.ts
//
// Two residents: "resident" plays through the tool; "listener" only perceives.
// alice (a raw socket, the circle's initiator) builds; bob starts a circle and
// leaves. Every channel event the listener's body produces is captured — that
// stream is what the MCPL door would deliver (net-server.ts maps kind
// "circle" to eidoverse:circle), so A9's intake end is checked on it.
//
// Fast grid: bpm 240, meter 2, subdivision 2 → 4 steps a bar, bar 500 ms.
import { WorldAgent } from "../mcpl/agent.ts";
import { HANDLERS } from "../mcpl/tools.ts";

const URL = process.env.WORLD_URL ?? "ws://localhost:8993/ws";
const TOKEN = process.env.JOIN_TOKEN ?? "test-door";
process.env.WORLD_TOKEN = TOKEN;   // WorldAgent's join reads WORLD_TOKEN
const BAR = 500;

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(20); }
  return pred();
}

type Sock = { msgs: any[]; errors: string[]; send(m: any): void; next(p: (m: any) => boolean, ms?: number): Promise<any>; verb(v: string, a: any): void; close(): void };
function open(joinMsg: Record<string, unknown>): Promise<Sock> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const s: Sock = {
      msgs: [], errors: [],
      send(m) { ws.send(JSON.stringify(m)); },
      next(pred, ms = 4000) {
        return new Promise((res, rej) => {
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
const tool = async (ag: WorldAgent, a: Record<string, any>) =>
  ((await HANDLERS.play(ag as any, a, {} as any, "play")) as any).content[0].text as string;

const W = `drummcpl-${Math.random().toString(36).slice(2, 8)}`;
console.log(`\nthe drum circle for residents — world "${W}"\n`);

const alice = await open({ id: "alice", world: W });
await sleep(300);
for (const [id, pos] of [["drums", [0, 0, 0]], ["hand", [1, 0, 0]], ["low", [-1, 0, 0]], ["faraway", [150, 0, 150]], ["farhand", [151, 0, 150]], ["drum3", [2, 0, 2]]] as const)
  alice.verb("spawn", { id, lib: "deco/drum.glb", pos });
await sleep(300);

const resident = new WorldAgent({ url: URL, world: W, name: "resident" });
const listener = new WorldAgent({ url: URL, world: W, name: "listener" });
const heard: { ts: number; kind: string; who: string; text?: string }[] = [], residentHeard: typeof heard = [];
listener.onEvent = (ev) => heard.push(ev);
resident.onEvent = (ev) => residentHeard.push(ev);
listener.circleQuietMs = 700;   // the quiet window, shortened for the test (production: DRUM_POLICY.QUIET_MS)
resident.circleQuietMs = 700;
await resident.connect(); await listener.connect();
await sleep(500);

const HAND = { name: "hand", synth: "drum-v1", strokes: { B: { f0: 85, drop: 1.6, dropMs: 90, decayMs: 380, noise: 0.06, cutoff: 900 },
  T: { f0: 330, drop: 1.25, dropMs: 35, decayMs: 190, noise: 0.18, cutoff: 2600 }, S: { f0: 520, drop: 1.1, dropMs: 15, decayMs: 95, noise: 0.62, cutoff: 3800 } } };
const LOW = { name: "low", synth: "drum-v1", strokes: { B: { f0: 58, drop: 2, dropMs: 160, decayMs: 620, noise: 0.04, cutoff: 650 }, M: { f0: 72, drop: 1.5, dropMs: 60, decayMs: 130, noise: 0.1, cutoff: 900 } } };
const FAST = { bpm: 240, meter: 2, subdivision: 2 };
alice.verb("circle-set", { id: "drums", op: "start", ...FAST, countIn: 1 });
alice.verb("instrument-set", { id: "hand", circle: "drums", ...HAND });
alice.verb("instrument-set", { id: "low", circle: "drums", ...LOW });
await until(() => !!resident.entities.get("hand")?.comp?.instrument && !!listener.entities.get("drums")?.comp?.circle, 3000);

console.log("1. look() before anyone plays");
const look0 = listener.look();
check("the circle is described: tempo, meter, gen, initiator", /\[drums\] a drum circle, 240 BPM, 2\/4 in eighths \(gen 1\), started by alice/.test(look0), look0.split("\n").filter((l) => /drum/.test(l)).join(" / "));
check("…with the count-in announced", /count-in by alice, bars 0–0; open from bar 1/.test(look0));
check("…and nothing claimed as struck before anyone played", /nothing struck or queued since you arrived/.test(look0));
check("a drum names its stroke letters", /drum "hand" in circle drums, strokes B T S/.test(look0));
check("the play hint gives the sounding grid's bar length", /one bar = 4 cells/.test(look0) && /Drums: hand, low/.test(look0));
check("no circle/instrument bag leaks as a raw 'components:' line", !/components: .*(circle|instrument)/.test(look0));

console.log("\n2. the play tool: the receipt is the only feedback");
const inCount = await tool(resident, { voice: "hand", pattern: "B...", bar: 0 });
check("a non-initiator's bar 0 inside the count-in is refused, with the world's reason", /^refused by the world: .*count-in/.test(inCount), inCount);
const noDrum = await tool(resident, { voice: "nope", pattern: "B..." });
check("a drum that isn't there is refused locally, and says what to do", /^refused: no drum "nope" here — look\(\) lists/.test(noDrum), noDrum);
await until(() => Date.now() > (listener.entities.get("drums")!.comp!.circle.t0 + 1 * BAR + 50), 3000);   // the count-in is over
const first = await tool(resident, { voice: "hand", pattern: "B.T.|S.S." });   // bars inferred from the "|"
check("a two-bar passage written with \"|\" is accepted whole (bars counted from the \"|\"s)", /^accepted: "hand" bars \d+–\d+ of circle drums \(gen 1\), first step in \d+\.\d s/.test(first), first);
const b0 = Number(first.match(/bars (\d+)–/)?.[1] ?? NaN);
check("…on two consecutive bars", first.includes(`bars ${b0}–${b0 + 1}`), first);

console.log("\n3. perception: what was struck, never what was heard");
await until(() => /B\.T\./.test(listener.look()), 2000);
const lookL = listener.look();
check("the listener's look shows the resident's pattern strings over the observed bars",
  /hand \(resident\): B\.T\. {2}S\.S\./.test(lookL) && /struck\/queued, bars \d+–\d+ \(observed since you arrived\)/.test(lookL), lookL.split("\n").filter((l) => /hand|struck/.test(l)).join(" / "));
check("…and never claims anything was heard", !/\bheard?\b/i.test(lookL.split("\n").filter((l) => /drum|struck|hand|low/.test(l)).join("\n")));
const lookR = resident.look();
check("the resident sees its own passage as queued (*)", /hand \(resident\): B\.T\.\* {2}S\.S\.\*/.test(lookR) && /\(\* = yours, queued\)/.test(lookR),
  lookR.split("\n").filter((l) => /hand \(|yours/.test(l)).join(" / "));

console.log("\n4. the eidoverse:circle line: one per circle per quiet window");
await until(() => heard.some((e) => e.kind === "circle"), 2000);
for (const b of [b0 + 2, b0 + 3, b0 + 4]) await tool(resident, { voice: "hand", pattern: "B...", bar: b });
await sleep(300);
const began = heard.filter((e) => e.kind === "circle");
check("the listener got exactly ONE line for four passages: 'began', naming who plays", began.length === 1 && /began playing/.test(began[0].text ?? "") && /resident/.test(began[0].text ?? ""), JSON.stringify(began));
check("the player gets no line for its own playing (the self-echo rule)", residentHeard.filter((e) => e.kind === "circle").length === 0, JSON.stringify(residentHeard.filter((e) => e.kind === "circle")));

console.log("\n5. receipts are truthful");
const taken = await tool(resident, { voice: "hand", pattern: "T...", bar: b0 + 2 });
check("a second passage for a bar already claimed is refused by name, never swapped in", /^refused by the world: a planned slot is already taken: bar \d+/.test(taken), taken);
const vg0 = resident.entities.get("hand")?.comp?.instrument?.voiceGen;
alice.verb("instrument-set", { id: "hand", circle: "drums", ...HAND, volume: 0.6 });
await until(() => resident.entities.get("hand")?.comp?.instrument?.voiceGen === vg0 + 1, 2000);
const afterRetune = await tool(resident, { voice: "hand", pattern: "S.S.", bar: b0 + 5 });
check("after the drum is retuned (voiceGen bump), the tool reads the new voiceGen for you", /^accepted/.test(afterRetune) && vg0 === 1, `voiceGen ${vg0}→${resident.entities.get("hand")?.comp?.instrument?.voiceGen}: ${afterRetune}`);
const ws: any = (resident as any).ws, realSend = ws.send.bind(ws);
ws.send = (d: string) => { if (String(d).includes('"type":"phrase"')) { ws.send = realSend; return; } realSend(d); };   // drop ONE phrase
const lost = await resident.play({ voice: "hand", pattern: "B...", bar: b0 + 6 }, 800);
check("a passage whose message is lost resolves 'sharing unknown', never a guess", lost.unknown === true && lost.ok === false, JSON.stringify(lost));

console.log("\n6. quiet, and far away");
const lastEnd = listener.entities.get("drums")!.comp!.circle.t0 + (b0 + 6) * BAR;
await until(() => heard.filter((e) => e.kind === "circle").length >= 2, lastEnd - Date.now() + 3000);
const quiet = heard.filter((e) => e.kind === "circle");
check("once the last passage has played and the window passes, ONE 'went quiet' line", quiet.length === 2 && /went quiet/.test(quiet[1].text ?? ""), JSON.stringify(quiet));
check("…and not before the last queued step had its time (+ the quiet window)", quiet.length === 2 && quiet[1].ts >= lastEnd + 700,
  `${quiet[1] ? quiet[1].ts - lastEnd : "?"} ms after the last bar ended`);
alice.verb("circle-set", { id: "faraway", op: "start", ...FAST, countIn: 1 });
alice.verb("instrument-set", { id: "farhand", circle: "faraway", ...HAND });
await sleep(BAR * 2 + 300);
alice.send({ type: "phrase", circle: "faraway", gen: 1, voice: "farhand", voiceGen: 1, bar: "next", pattern: "B.B.", n: 1 });
const farR = await alice.next((m) => m.type === "phrase-receipt" && m.n === 1);
await sleep(600);
check("a circle beyond the listener's radius makes no line (212 m away; radius 30)", farR.ok === true && !heard.some((e) => e.kind === "circle" && /faraway/.test(e.text ?? "")),
  JSON.stringify({ farR: farR.ok ?? farR.why, lines: heard.filter((e) => /faraway/.test(e.text ?? "")) }));

console.log("\n7. playing again, then the end");
const again = await tool(resident, { voice: "hand", pattern: "B.B." });
await until(() => heard.filter((e) => e.kind === "circle" && /\[drums\]/.test(e.text ?? "")).length >= 3, 2000);
alice.verb("circle-set", { id: "drums", op: "end" });
await until(() => heard.filter((e) => e.kind === "circle" && /\[drums\]/.test(e.text ?? "")).length >= 4, 2000);
const drumsLines = heard.filter((e) => e.kind === "circle" && /\[drums\]/.test(e.text ?? "")).map((e) => e.text ?? "");
check("a new quiet window opens with one more 'began'", /^accepted/.test(again) && /began playing/.test(drumsLines[2] ?? ""), JSON.stringify(drumsLines));
check("ending the circle while it is being played says so once, at once", drumsLines.length === 4 && /ended/.test(drumsLines[3]), JSON.stringify(drumsLines));
await sleep(BAR * 4);
check("…and nothing more follows (no late 'quiet' after the end)", heard.filter((e) => e.kind === "circle" && /\[drums\]/.test(e.text ?? "")).length === 4);
const afterEnd = await tool(resident, { voice: "hand", pattern: "B..." });
check("playing an ended circle is refused locally", /^refused: the circle "drums" has ended/.test(afterEnd), afterEnd);

console.log("\n8. the initiator leaves (no invented inheritance)");
const bob = await open({ id: "bob", world: W });
bob.verb("circle-set", { id: "drum3", op: "start", ...FAST, countIn: 1 });
await until(() => !!listener.entities.get("drum3")?.comp?.circle, 2000);
await until(() => listener.people.has("bob"), 2000);
const withBob = listener.look();
bob.close();
await until(() => !listener.people.has("bob"), 3000);
const lookGone = listener.look();
// the circle's OWN block ("[drum3] a drum circle …" to the next block), never the entity-list line
const block = (look: string, id: string) => (look.split(`\n[${id}] a drum circle`)[1] ?? "").split(/\n\n|\n\[/)[0];
check("while bob is present, his circle names him and says nothing about a missing initiator",
  /started by bob/.test(block(withBob, "drum3")) && !/initiator has left/.test(block(withBob, "drum3")), block(withBob, "drum3").split("\n").slice(0, 3).join(" / "));
check("once bob has left, look says exactly who may still change or end it",
  /the initiator has left; only the owner or an operator can change or end this circle/.test(block(lookGone, "drum3")), block(lookGone, "drum3").split("\n").slice(0, 3).join(" / "));

// The server never relays a phrase to its sender, so the agent's own-name guard
// sits BEHIND that exclusion and no real relay reaches it. Exercise it directly
// on bob's circle: the same phrase under the listener's own name, then another's.
const c3 = listener.entities.get("drum3")!.comp!.circle;
const lines3 = () => heard.filter((e) => e.kind === "circle" && /\[drum3\]/.test(e.text ?? "")).length;
const n3 = lines3();
const ph3 = (author: string) => ({ circle: "drum3", gen: c3.gen, voice: "hand3", voiceGen: 1, bar: 5, bars: 1, pattern: "B...", author });
(listener as any).notePhrase(ph3("listener"));
const ownLines = lines3() - n3;
(listener as any).notePhrase(ph3("ghost"));
const ghostLines = lines3() - n3 - ownLines;
check("a phrase under the listener's own name opens no line (the guard behind the server's sender exclusion)", ownLines === 0, `${ownLines}`);
check("…while the same phrase under another name does (the control)", ghostLines === 1, `${ghostLines}`);

console.log("\n9. no retention, at both ends (A9)");
const patterns = ["B.T.", "S.S.", "B.B."];
// about PLAYING — a digest that alice placed a drum.glb is about building, not a jam
const circleish = heard.filter((e) => /drum circle|phrase|playing|played|struck|pattern/i.test(e.text ?? ""));
check("every circle-related event the listener's body produced is an eidoverse:circle lifecycle line",
  circleish.every((e) => e.kind === "circle"), JSON.stringify(circleish.filter((e) => e.kind !== "circle")));
check("…and none of them carries a pattern", !heard.some((e) => patterns.some((p) => (e.text ?? "").includes(p))), JSON.stringify(heard.filter((e) => patterns.some((p) => (e.text ?? "").includes(p)))));
check("…and nothing of the jam reached the inbox (the chat look() replays)", !listener.inbox.some((m: any) => patterns.some((p) => String(m.text ?? "").includes(p))));
const hist = await listener.history({ limit: 1000 });
const entries: any[] = hist.entries ?? [];
check("the world log holds no phrase and no pattern string", entries.length > 0 && !entries.some((e) => e.verb === "phrase")
  && !patterns.some((p) => JSON.stringify(entries).includes(p)), `${entries.length} entries; verbs ${[...new Set(entries.map((e) => e.verb))].join(",")}`);

resident.close(); listener.close(); alice.close();
await sleep(200);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
