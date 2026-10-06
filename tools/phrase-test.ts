// phrase-test — the phrase judges (shared/circle.js judgePlanned, judgeLive)
// against numbers worked BY HAND (design rev 5 §2.3, §2.4, §3; acceptance A2,
// and Mica's rev-5 multi-bar and pending-horizon notes, IMPLEMENTATION-CARRY
// 6 and 8). No server. The stateful half (dedupe, slots, rate, relay) is
// tools/phrase-live-test.ts.
//
//   bun tools/phrase-test.ts
//
// Grid: bpm 90, meter 4, subdivision 4 → step 166.67 ms, bar 2,666.67 ms,
// 16 steps. After the change: bpm 120 → step 125 ms, bar 2,000 ms.
import { judgePlanned, judgeLive, normalizePattern, DRUM_POLICY } from "../shared/circle.js";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const T = 1_000_000;
const ADAM = { id: "adam" };
const HAND = { circle: "drums", name: "hand", synth: "drum-v1", voiceGen: 1, polyphony: 8, volume: 0.8, radius: 15,
  strokes: { B: { f0: 80, drop: 2, dropMs: 120, decayMs: 400, noise: 0.1, cutoff: 1200 },
             T: { f0: 220, drop: 1.5, dropMs: 40, decayMs: 180, noise: 0.3, cutoff: 3000 },
             S: { f0: 400, drop: 1.2, dropMs: 20, decayMs: 120, noise: 0.7, cutoff: 3800 } } };
const RUN = { t0: T, bpm: 90, meter: 4, subdivision: 4, gen: 2, countIn: 1, initiator: ADAM };
const PAT = "B...T.S.B...T.S.";
const msg = (o: any) => ({ circle: "drums", gen: 2, voice: "hand", voiceGen: 1, pattern: PAT, ...o });
const P = (c: any, o: any, now: number, isInitiator = false) => judgePlanned(c, HAND, msg(o), { now, isInitiator });
const L = (c: any, o: any, now: number, isInitiator = false) => judgeLive(c, HAND, { circle: "drums", gen: 2, voice: "hand", voiceGen: 1, stroke: "B", ...o }, { now, isInitiator });

console.log("\n1. planned phrases: whole future bars (§2.3, §3)");
{
  const r3 = P(RUN, { bar: 3 }, T + 10_000);
  check('bar 3 at T + 10,000 is refused: "bar 3 began 2000 ms ago; next open bar is 4"', !r3.ok && r3.why === "bar 3 began 2000 ms ago; next open bar is 4", r3.why);
  const nx = P(RUN, { bar: "next" }, T + 10_000);
  check('"next" at T + 10,000 resolves to bar 4, scheduled at T + 10,666.67', nx.ok && nx.bar === 4 && near(nx.scheduledAtServerMs - T, 32000 / 3), JSON.stringify(nx));
  const a = P(RUN, { bar: 4 }, T + 10_600);
  check("bar 4 at T + 10,600 is accepted (66.67 ms ≥ F = 50)", a.ok, a.why);
  const b = P(RUN, { bar: 4 }, T + 10_640);
  check('bar 4 at T + 10,640 is refused: "begins in 26.67 ms, too close to relay; next open bar is 5"',
    !b.ok && /begins in 26\.67 ms, too close to relay; next open bar is 5/.test(b.why), b.why);
  check("the pattern never affects admission (leading rests do not open bar 3)", !P(RUN, { bar: 3, pattern: "........B.......".slice(0, 16) }, T + 10_000).ok);
}

console.log("\n2. live hits: two events, the server's half of the timing (§2.4, §3)");
{
  const s = L(RUN, { step: 62 }, T + 10_110);
  check("synced step 62 arriving at T + 10,110 is accepted: bar 3 step 14, scheduled T + 10,333.33",
    s.ok && s.bar === 3 && s.step === 14 && near(s.scheduledAtServerMs - T, 31000 / 3), JSON.stringify(s));
  check("…arrivalToGridMs = 10,333.33 − 10,110 = 223.33, basis client-step", s.ok && near(s.arrivalToGridMs, 670 / 3) && s.basis === "client-step");
  check("…and the receipt carries no press time (only what the server witnessed)", s.ok && !("pressToGridMs" in s) && !("moved" in s));
  const u = L(RUN, { step: "next" }, T + 10_200);
  check("unsynced 'next' arriving at T + 10,200 lands on step 63 (bar 3 step 15) at T + 10,500, 300.00 after arrival, basis arrival",
    u.ok && u.stepIndex === 63 && u.bar === 3 && u.step === 15 && near(u.scheduledAtServerMs - T, 10500) && near(u.arrivalToGridMs, 300) && u.basis === "arrival", JSON.stringify(u));
  const late = L(RUN, { step: 61 }, T + 10_150);
  check("a step that begins less than F after arrival is refused, never moved", !late.ok && /too late/.test(late.why), late.why);
  check("a stroke the drum doesn't declare is refused", !L(RUN, { step: 62, stroke: "X" }, T + 10_110).ok);
}

console.log("\n3. the count-in (§2.1)");
{
  const c = { ...RUN, countIn: 1 };
  check("a non-initiator's bar 0 is refused: count-in — the circle opens at bar 1", P(c, { bar: 0 }, T - 1000).why === "count-in — the circle opens at bar 1");
  check("the initiator's bar 0 is accepted", P(c, { bar: 0 }, T - 1000, true).ok);
  const nx = P(c, { bar: "next" }, T - 1000);
  check('a non-initiator\'s "next" before the start resolves to bar 1 at the earliest', nx.ok && nx.bar === 1, JSON.stringify(nx));
  const c2 = { ...RUN, countIn: 2 };
  check("a count-in overlap refuses the WHOLE non-initiator passage (bars 1–4, count-in 2)", P(c2, { bar: 1, bars: 4, pattern: PAT.repeat(4) }, T - 2000).why === "count-in — the circle opens at bar 2");
  check("a live hit inside someone else's count-in is refused", /count-in/.test(L(c2, { step: 20 }, T - 2000).why ?? ""));
}

console.log("\n4. the handover (§2.1, §3): a change requested at T + 10,000 lands at bar 20");
const CHANGED = { t0: T + 160000 / 3, bpm: 120, meter: 4, subdivision: 4, gen: 3, countIn: 1, initiator: ADAM,
  prev: { t0: T, bpm: 90, meter: 4, subdivision: 4, gen: 2, until: T + 160000 / 3 } };
{
  const h = L(CHANGED, { step: 62, gen: 2 }, T + 10_110);
  check("a hit into the outgoing bar (gen 2, step 62) is accepted — on time, inside gen 2's span", h.ok && near(h.scheduledAtServerMs - T, 31000 / 3), h.why);
  const edge = L(CHANGED, { step: 320, gen: 2 }, T + 53_000);
  check("gen-2 step 320 (bar 20 step 0, = until) is refused: outside gen 2's span", !edge.ok && /outside gen 2's span/.test(edge.why), edge.why);
  const n3 = L(CHANGED, { step: 1, gen: 3 }, T + 53_310);
  check("the press at T + 53,250 → gen 3 step 1 at T + 53,458.33; arriving at 53,310 gives arrivalToGridMs 148.33",
    n3.ok && near(n3.scheduledAtServerMs - T, 53458 + 1 / 3) && near(n3.arrivalToGridMs, 148 + 1 / 3), JSON.stringify(n3));
  const cross = P(CHANGED, { gen: 2, bar: 18, bars: 4, pattern: PAT.repeat(4) }, T + 45_000);
  check('a 4-bar gen-2 phrase for bars 18–21 is refused: "crosses the tempo change at bar 20"', cross.why === "crosses the tempo change at bar 20", cross.why);
  const nx = P(CHANGED, { gen: 2, bar: "next" }, T + 53_000);
  check('gen 2 "next" at T + 53,000 would be bar 20: refused, its span ends there', !nx.ok && /span ends at bar 20/.test(nx.why), nx.why);
  check("gen 1 is stale", /stale generation/.test(P(CHANGED, { gen: 1, bar: "next" }, T + 10_000).why ?? ""));
}

console.log("\n5. the pending grid's horizon — negative, never clamped (carry note 6)");
{
  const b0 = (now: number) => P(CHANGED, { gen: 3, bar: 0 }, now);
  check("at the request (T + 10,000) gen-3 bar 0 is refused as too far (current bar −22, horizon −6)", !b0(T + 10_000).ok && /horizon \(bar -6/.test(b0(T + 10_000).why), b0(T + 10_000).why);
  check("bar 0 enters the horizon at exactly T + 21,333.33 (refused at …32, accepted at …34)", !b0(T + 21_333.32).ok && b0(T + 21_333.34).ok);
  const p8 = (now: number) => P(CHANGED, { gen: 3, bar: 0, bars: 8, pattern: PAT.repeat(8) }, now);
  check("an 8-bar gen-3 passage (bars 0–7) is admissible only from T + 35,333.33", !p8(T + 35_333.32).ok && p8(T + 35_333.34).ok);
}

console.log("\n6. multi-bar passages (Mica's rev-5 suite, the stateless cases)");
{
  check("a valid 8-bar passage right at the edge of H (bars 12–19 at T + 10,000: bar 3 + 16 = 19)", P(RUN, { bar: 12, bars: 8, pattern: PAT.repeat(8) }, T + 10_000).ok);
  check("an 8-bar passage one bar too far (bars 13–20) is refused", /too far ahead/.test(P(RUN, { bar: 13, bars: 8, pattern: PAT.repeat(8) }, T + 10_000).why ?? ""));
  check("a passage whose first bar fits but last does not (bars 17–20) is refused whole", /too far ahead/.test(P(RUN, { bar: 17, bars: 4, pattern: PAT.repeat(4) }, T + 10_000).why ?? ""));
  check("(crossing a scheduled change, and a count-in overlap, are §4 and §3 above)", true);
  check("bars outside 1–8 are refused", !P(RUN, { bar: 5, bars: 9, pattern: PAT.repeat(9) }, T + 10_000).ok);
}

console.log("\n7. patterns: the alphabet, and `|` only at bar boundaries");
{
  const alpha = ["B", "T", "S"];
  check("a `|` between whole bars is accepted and removed", normalizePattern("B...T.S.B...T.S.|B...T.S.B.T.T.S.", undefined, { steps: 16, bars: 2, alphabet: alpha }).pattern === "B...T.S.B...T.S.B...T.S.B.T.T.S.");
  check("a `|` mid-bar is refused", !normalizePattern("B...T.S.|B...T.S.B...T.S.B.T.T.S.", undefined, { steps: 16, bars: 2, alphabet: alpha }).ok);
  const bad = normalizePattern("B...X.S.B...T.S.", undefined, { steps: 16, bars: 1, alphabet: alpha });
  check("a letter outside the alphabet is refused, by name", !bad.ok && /letter "X"/.test(bad.why), bad.why);
  check("velocity: same shape, digits 1–9", normalizePattern(PAT, "7777777777777777", { steps: 16, bars: 1, alphabet: alpha }).ok
    && !normalizePattern(PAT, "7777777707777777", { steps: 16, bars: 1, alphabet: alpha }).ok);
  check("a stale voiceGen is refused", /stale voice generation/.test(judgePlanned(RUN, HAND, msg({ bar: "next", voiceGen: 2 }), { now: T + 10_000, isInitiator: false }).why ?? ""));
  check("a drum with an unknown synth is refused", !judgePlanned(RUN, { ...HAND, synth: "drum-v2" }, msg({ bar: "next" }), { now: T + 10_000, isInitiator: false }).ok);
  check("an ended circle refuses", !P({ ...RUN, ended: true }, { bar: "next" }, T + 10_000).ok);
}

console.log(`\n${passed} passed, ${failed} failed  (policy ${DRUM_POLICY.status}: L ${DRUM_POLICY.L_MS}, F ${DRUM_POLICY.F_MS}, H ${DRUM_POLICY.H_BARS})`);
process.exit(failed ? 1 : 0);
