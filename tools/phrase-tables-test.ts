// phrase-tables-test — the phrase tables are BOUNDED (Mica's packet review
// 2026-10-07, blocker 1), in process, with the real handlePhrase and a clock
// this test drives, so 10,000 bars and 1,000 legs take milliseconds. The
// product path (real sockets dying by close, takeover, travel and kick) is
// tools/phrase-lifecycle-live-test.ts.
//
//   bun tools/phrase-tables-test.ts
//
// The grid: 240 BPM, 2 beats, 1 step a beat → a bar is 500 ms; count-in 1.
// H = 16 bars (DRUM_POLICY, PROVISIONAL), RECEIPT_WINDOW = 64.
import { handlePhrase, releaseLeg, phraseTableStats } from "../server/phrases.ts";
import { DRUM_POLICY } from "../shared/circle.js";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const BAR = 500, H = DRUM_POLICY.H_BARS, WIN = DRUM_POLICY.RECEIPT_WINDOW;
const T0 = 2_000_000_000_000;
let NOW = T0 + 100;
Date.now = () => NOW;

const STROKES = { B: { f0: 80, drop: 2, dropMs: 100, decayMs: 300, noise: 0.1, cutoff: 1200 } };
function world() {
  return { state: { entities: {
    drums: { born: 1, comp: { circle: { gen: 1, t0: T0, bpm: 240, meter: 2, subdivision: 1, countIn: 1, initiator: { id: "host" } } as any } },
    hand: { comp: { instrument: { circle: "drums", name: "hand", synth: "drum-v1", strokes: STROKES, voiceGen: 1, polyphony: 8, volume: 0.8, radius: 15 } } },
  } as Record<string, any> }, broadcast() {} };
}
const leg = (w: any, id: string, legGen = 1) => ({ id, legGen, spectator: false, world: w });
const play = (c: any, msg: Record<string, unknown>) => {
  let r: any = null;
  handlePhrase(c, { send: (d: string) => { r = JSON.parse(d); } }, { type: "phrase", circle: "drums", gen: 1, voice: "hand", voiceGen: 1, bars: 1, pattern: "B.", ...msg });
  return r;
};
const stats = (w: any) => phraseTableStats(w).drums ?? { legs: 0, receipts: 0, gens: 0, bars: 0, claims: 0 };

console.log("\nthe phrase tables are bounded\n");

console.log("1. 1,000 departed legs (Mica's probe, with the repair)");
{
  const w = world();
  NOW = T0 + 100;   // bar 1 begins at T0 + 500: 400 ms ahead
  let ok = 0;
  for (let i = 0; i < 1000; i++) {
    const c = leg(w, `p${i}`);
    if (play(c, { n: 1, bar: 1 })?.ok) ok++;
    releaseLeg(w, c);   // what server.ts does when the leg dies
  }
  const s = stats(w);
  check("all 1,000 played bar 1 (1,000 different authors, one claim each)", ok === 1000, `${ok}`);
  check("after each leg died, no receipt window is left: 0 legs (was 1,000 before the repair)", s.legs === 0 && s.receipts === 0, JSON.stringify(s));
  check("bar 1 still holds 1,000 claims while it hasn't begun (a claim may still decide a judgement)", s.bars === 1 && s.claims === 1000, JSON.stringify(s));
  NOW = T0 + 500;   // bar 1 begins: it can never be admitted again
  play(leg(w, "late"), { n: 1, bar: 3 });
  const s2 = stats(w);
  check("once bar 1 has begun, the next phrase prunes it: 1 bar (bar 3), 1 claim", s2.bars === 1 && s2.claims === 1, JSON.stringify(s2));
}

console.log("\n2. releasing is exact: one leg, never its neighbours");
{
  const w = world();
  NOW = T0 + 100;
  play(leg(w, "x", 1), { n: 1, bar: 1 });
  play(leg(w, "x", 2), { n: 1, bar: 2 });
  play(leg(w, "y", 1), { n: 1, bar: 1 });
  releaseLeg(w, { id: "x", legGen: 1 });
  const s = stats(w);
  check("releasing (x, legGen 1) leaves (x, 2) and (y, 1): 2 legs", s.legs === 2, JSON.stringify(s));
  releaseLeg(w, { id: "x", legGen: 9 });
  check("releasing a leg that never played changes nothing", stats(w).legs === 2);
}

console.log("\n3. a long-running circle: 10,000 bars, one player, one generation");
{
  const w = world();
  const c = leg(w, "lr");
  let maxBars = 0, maxClaims = 0, refused = 0;
  for (let k = 1; k <= 10_000; k++) {
    NOW = T0 + (k - 1) * BAR + 100;   // current bar k − 1; bar k begins 400 ms ahead
    const r = play(c, { n: k, bar: k });
    if (!r?.ok) refused++;
    const s = stats(w);
    maxBars = Math.max(maxBars, s.bars); maxClaims = Math.max(maxClaims, s.claims);
  }
  const s = stats(w);
  check("every passage accepted", refused === 0, `${refused} refused`);
  check(`unbegun bars only: never more than 1 claimed bar at a time here, and never more than H = ${H}`, maxBars === 1 && maxClaims === 1 && maxBars <= H, `max bars ${maxBars}, claims ${maxClaims}`);
  check(`the leg's receipt window stays at ${WIN}, not 10,000`, s.receipts === WIN && s.legs === 1, JSON.stringify(s));
}

console.log("\n4. a player who books ahead: the claims stay inside the horizon");
{
  const w = world();
  const c = leg(w, "ahead");
  let maxBars = 0, n = 0;
  for (let k = 0; k < 2_000; k++) {
    NOW = T0 + k * BAR + 100;   // current bar k
    for (let b = k + 1; b <= k + H; b++) play(c, { n: ++n, bar: b });   // try every bar of the horizon
    maxBars = Math.max(maxBars, stats(w).bars);
  }
  check(`booking the whole horizon every bar for 2,000 bars holds at most H = ${H} claimed bars (bars k+1 … k+${H})`, maxBars === H, `${maxBars}`);
}

console.log("\n5. generations: only the playable ones keep claims");
{
  const w = world();
  NOW = T0 + 100;
  play(leg(w, "g"), { n: 1, bar: 5 });
  // the circle moves on twice: gen 1 is neither current (3) nor prev (2)
  w.state.entities.drums.comp.circle = { gen: 3, t0: T0 + 60 * BAR, bpm: 240, meter: 2, subdivision: 1, countIn: 1, initiator: { id: "host" },
    prev: { gen: 2, t0: T0 + 20 * BAR, bpm: 240, meter: 2, subdivision: 1, until: T0 + 60 * BAR } };
  // at T0 + 30 bars, prev's own current bar is (30 − 20) = 10: its bar 22 is inside the horizon (≤ 26)
  // and begins at T0 + 42 bars, before prev's span ends at T0 + 60 bars
  NOW = T0 + 30 * BAR + 100;
  const r = play(leg(w, "g2"), { n: 1, gen: 2, bar: 22 });   // a phrase arrives: the prune runs
  const s = stats(w);
  check("a phrase for prev (gen 2), bar 22, is accepted", r?.ok === true, JSON.stringify(r));
  check("gen 1's claim is gone; gen 2 (prev) keeps its own: 1 generation, 1 claim", s.gens === 1 && s.claims === 1, JSON.stringify(s));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
