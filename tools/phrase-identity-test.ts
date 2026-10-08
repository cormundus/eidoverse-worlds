// phrase-identity-test — a planned claim's identity is the TUPLE (author, voice,
// gen, bar), never a delimiter-joined string (Mica's packet review 2026-10-07,
// blocker 2). Uses only handlePhrase, so it runs unchanged on the base.
//
//   bun tools/phrase-identity-test.ts
//
// The grid: 240 BPM, 2 beats, 1 step a beat → a bar is 500 ms, 2 steps a bar;
// count-in 1 bar. At t0 + 100 the current bar is 0 (the count-in), and bar 1
// begins at t0 + 500: 400 ms ahead, past F (50 ms), inside H (bar 16), out of
// the count-in. So bar 1 is admissible to anyone.
import { handlePhrase } from "../server/phrases.ts";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const T0 = Date.now() + 10_000;
let NOW = T0 + 100;
Date.now = () => NOW;   // handlePhrase stamps acceptance with Date.now()

const STROKES = { B: { f0: 80, drop: 2, dropMs: 100, decayMs: 300, noise: 0.1, cutoff: 1200 } };
const drum = () => ({ comp: { instrument: { circle: "drums", name: "d", synth: "drum-v1", strokes: STROKES, voiceGen: 1, polyphony: 8, volume: 0.8, radius: 15 } } });
const w = { state: { entities: {
  drums: { born: 1, comp: { circle: { gen: 1, t0: T0, bpm: 240, meter: 2, subdivision: 1, countIn: 1, initiator: { id: "host" } } } },
  "c": drum(), "b|c": drum(), "plain": drum(),
} as Record<string, any> }, broadcast() {} };
const leg = (id: string, legGen = 1) => ({ id, legGen, spectator: false, world: w });
const play = (c: any, msg: Record<string, unknown>) => {
  let r: any = null;
  handlePhrase(c, { send: (d: string) => { r = JSON.parse(d); } }, { type: "phrase", circle: "drums", gen: 1, voiceGen: 1, bars: 1, pattern: "B.", ...msg });
  return r;
};

console.log("\nphrase identity — tuples, never joined strings\n");
console.log("1. Mica's two tuples, on the same gen and bar");
const ab = leg("a|b"), a = leg("a");
const r1 = play(ab, { n: 1, voice: "c", bar: 1 });
const r2 = play(a, { n: 1, voice: "b|c", bar: 1 });
check("(author 'a|b', voice 'c', gen 1, bar 1) is accepted", r1?.ok === true, JSON.stringify(r1));
check("(author 'a', voice 'b|c', gen 1, bar 1) is ALSO accepted — a different tuple, never 'already taken'", r2?.ok === true, JSON.stringify(r2));

console.log("\n2. the slot and dedupe rules are unchanged");
const r3 = play(ab, { n: 2, voice: "c", bar: 1 });
check("the SAME tuple again (new n) is refused by name: bar 1 is taken", r3?.ok === false && /already taken: bar 1 of your "c"/.test(r3?.why ?? ""), JSON.stringify(r3));
const r4 = play(ab, { n: 1, voice: "c", bar: 1 });
check("a resend of n 1 returns the ORIGINAL receipt, marked dup", r4?.dup === true && r4?.ok === true && r4?.bar === 1, JSON.stringify(r4));
const r5 = play(leg("plain"), { n: 1, voice: "plain", bar: 1 });
check("a third author on the same bar is accepted (slots are per author and voice)", r5?.ok === true, JSON.stringify(r5));
const r6 = play(leg("a|b", 2), { n: 1, voice: "c", bar: 1 });
check("the same identity on a NEW leg is still refused that bar (claims are per author, not per leg)", r6?.ok === false && /already taken/.test(r6?.why ?? ""), JSON.stringify(r6));
check("…and its n 1 is judged fresh, not a dup of the old leg's n 1 (receipt windows are per leg)", r6?.dup !== true, JSON.stringify(r6));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
