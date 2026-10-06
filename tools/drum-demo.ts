// drum-demo — A1, "did two people keep playing?" (design rev 5 §7): one human,
// live in a browser, and one scripted resident playing through the REAL agent
// (mcpl/agent.ts WorldAgent.play, the same path as the `play` tool), on an
// owned scratch world. Judged by ear; the receipts and the resident's log are
// the record.
//
//   bun tools/drum-scratch.mjs --label drum-demo --library ../eidoverse-video -- bun tools/drum-demo.ts
//
// Prints the URL to open. Walk to a drum: the pad appears at the drum you
// stand beside. The resident keeps a groove on the low drum, pre-submitting
// one 4-bar passage at a time; you play the hand drum live. Runs DEMO_MINUTES
// (default 20), then the world tears down.
import { WorldAgent } from "../mcpl/agent.ts";

const URL = process.env.WORLD_URL!, ORIGIN = process.env.ORIGIN!, TOKEN = process.env.JOIN_TOKEN!;
process.env.WORLD_TOKEN = TOKEN;
const MINUTES = Number(process.env.DEMO_MINUTES ?? 20);
const BPM = Number(process.env.DEMO_BPM ?? 90);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = process.env.DEMO_WORLD ?? "drumcircle";

function open(id: string): Promise<{ verb(v: string, a: any): void; close(): void }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    ws.onopen = () => ws.send(JSON.stringify({ type: "join", token: TOKEN, id, world: W }));
    ws.onmessage = (ev) => { const m = JSON.parse(String(ev.data)); if (m.type === "snapshot") resolve({
      verb: (verb, args) => ws.send(JSON.stringify({ type: "verb", verb, args })), close: () => ws.close() }); };
    ws.onerror = reject;
  });
}

// the kit (PROVISIONAL, not yet tuned by ear — this demo is where it gets tuned)
const { HAND_DRUM, LOW_DRUM } = await import("../shared/drumkit.js");
const keeper = await open("keeper");
for (const [id, pos] of [["drums", [0, 0, -3]], ["hand", [-1.2, 0, -2.4]], ["low", [1.2, 0, -2.4]]] as const)
  keeper.verb("spawn", { id, lib: "eidoverse/assets/models/crate_large_red.glb", pos });
await sleep(400);
keeper.verb("circle-set", { id: "drums", op: "start", bpm: BPM, meter: 4, subdivision: 4, countIn: 1, look: "a drum circle for two" });
keeper.verb("instrument-set", { id: "hand", circle: "drums", ...HAND_DRUM });
keeper.verb("instrument-set", { id: "low", circle: "drums", ...LOW_DRUM });

const resident = new WorldAgent({ url: URL, world: W, name: "drummer" });
await resident.connect();
await sleep(500);

console.log(`\n  open:  ${ORIGIN}/?world=${W}&key=${TOKEN}&name=adam`);
console.log(`  ${BPM} BPM, 4/4 in sixteenths; the resident plays the LOW drum; walk to the HAND drum (left crate) to play.`);
console.log(`  runs ${MINUTES} min, then tears down.\n`);

// A groove that breathes: four bars, the fourth a small fill. 16 cells a bar.
const GROOVES = [
  "B.......B.B.....|B.......B.B.....|B.......B.B.....|B...M...B.B.M.M.",
  "B.......B...B...|B.......B.B.....|B.......B...B...|B.M.B.M.B.B.MMMM",
];
const t0 = Date.now();
let k = 0, accepted = 0, refused = 0, lastBar = -Infinity;
while (Date.now() - t0 < MINUTES * 60_000) {
  const c = resident.entities.get("drums")?.comp?.circle;
  if (!c || c.ended) { await sleep(500); continue; }
  const barMs = (60_000 / c.bpm) * c.meter;
  const nowBar = Math.floor((resident.serverNow() - c.t0) / barMs);
  // keep ~2 bars of slack: submit the next passage when the queue runs short
  if (lastBar - nowBar > 2) { await sleep(barMs / 2); continue; }
  // the first passage (and any after a refusal) lets the world pick the bar; then contiguous
  const bar: number | "next" = Number.isFinite(lastBar) ? lastBar + 1 : "next";
  const r = await resident.play({ voice: "low", pattern: GROOVES[k++ % GROOVES.length], bar });
  if (r?.ok) { accepted++; lastBar = r.bar + r.bars - 1; console.log(`  [drummer] bars ${r.bar}–${lastBar} accepted (lands in ${((r.scheduledAtServerMs - resident.serverNow()) / 1000).toFixed(1)} s)`); }
  else { refused++; lastBar = -Infinity; console.log(`  [drummer] refused: ${r?.why}`); await sleep(barMs); }
}
console.log(`\n  [drummer] ${accepted} passages accepted, ${refused} refused, over ${MINUTES} min`);
console.log(`  what the drummer's body saw:\n${resident.look().split("\n").filter((l) => /circle|struck|low|hand|count-in|\*/.test(l)).join("\n")}`);
resident.close(); keeper.close();
await sleep(300);
process.exit(0);
