// drum-client-test — the browser layer's shared logic, without a browser
// (design rev 5 §2.4, §5, §6): the drum-v1 noise contract, the synced
// client's step choice on the timeline as it will sound, the hitter's
// "sharing unknown" deadlines, and the struck window / description that the
// browser pad, Lite and mcpl all print. Hand-computed where there are numbers.
// The WebAudio half is tools/drum-probe.ts (a real browser).
//
//   bun tools/drum-client-test.ts
import { chooseLiveStep, sharingUnknownDeadline, newStruckWindow, noteStruck, describeCircle } from "../shared/circle.js";
import { noiseSamples, NOISE_FRAMES, NOISE_SEED } from "../client/lib/drumsynth.js";
import { HAND_DRUM, LOW_DRUM, KIT_STATUS } from "../shared/drumkit.js";
import { normalizeInstrumentSetArgs } from "../shared/circle.js";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const near = (a: number, b: number, e = 1e-6) => Math.abs(a - b) < e;
const T = 1_000_000;
const RUN = { t0: T, bpm: 90, meter: 4, subdivision: 4, gen: 2, countIn: 1, initiator: { id: "adam" } };
const CHANGED = { t0: T + 160000 / 3, bpm: 120, meter: 4, subdivision: 4, gen: 3, countIn: 1, initiator: { id: "adam" },
  prev: { t0: T, bpm: 90, meter: 4, subdivision: 4, gen: 2, until: T + 160000 / 3 } };

console.log("\n1. the drum-v1 noise contract (§6)");
const a = noiseSamples(), b = noiseSamples();
check("48,000 frames, seed 0x1D0DEC0D", a.length === NOISE_FRAMES && NOISE_FRAMES === 48000 && NOISE_SEED === 0x1D0DEC0D);
check("deterministic: two generations are identical", a.every((v, i) => v === b[i]));
check("every sample in [−1, 1)", a.every((v) => v >= -1 && v < 1));
const mean = a.reduce((s, v) => s + v, 0) / a.length;
check("zero-centred noise (|mean| < 0.02)", Math.abs(mean) < 0.02, String(mean));

console.log("\n2. the synced hitter's step choice (§2.4, §3)");
const s1 = chooseLiveStep(RUN, T + 10_050);
check("a press at T + 10,050 picks gen 2 step 62 ((10,050 + 150) ÷ 166.67 = 61.2 → 62)", s1?.gen === 2 && s1?.step === 62, JSON.stringify(s1));
const s2 = chooseLiveStep(CHANGED, T + 10_050);
check("during the handover the same press still picks the OUTGOING grid: gen 2 step 62", s2?.gen === 2 && s2?.step === 62, JSON.stringify(s2));
const s3 = chooseLiveStep(CHANGED, T + 53_250);
check("a press at T + 53,250 lands on gen 3 step 1 (gen 2's next step, 321, is past until)", s3?.gen === 3 && s3?.step === 1, JSON.stringify(s3));
check("no running circle → no step", chooseLiveStep({ ...RUN, ended: true }, T) === null);

console.log("\n3. 'sharing unknown' deadlines (§2.4)");
const ds = sharingUnknownDeadline({ synced: true, scheduledAtServerMs: T + 31000 / 3, pressedAtLocalMs: 0, stepMs: 500 / 3 });
check("synced: the step's time + 1 s on the server clock = T + 11,333.33", ds.clock === "server" && near(ds.at - T, 34000 / 3), JSON.stringify(ds));
const du = sharingUnknownDeadline({ synced: false, scheduledAtServerMs: NaN, pressedAtLocalMs: 5000, stepMs: 500 / 3 });
check("unsynced: the press + 150 + 166.67 + 1,000 = press + 1,316.67 on the local clock", du.clock === "local" && near(du.at - 5000, 1316 + 2 / 3), JSON.stringify(du));

console.log("\n4. what was struck, in words (§5): struck or queued, never heard");
const win = newStruckWindow();
noteStruck(win, { voice: "hand", author: "bea", gen: 2, live: true, bar: 3, step: 14, stroke: "T" }, { steps: 16 });
noteStruck(win, { voice: "hand", author: "adam", gen: 2, bar: 4, bars: 2, pattern: "B...T.S.B...T.S." + "B...T.S.B.T.T.S." }, { steps: 16, mine: true });
const v = win.voices.hand;
check("a live hit fills its one cell: bar 3 = '..............T.'", v.bars["2:3"].cells === "..............T.", v.bars["2:3"]?.cells);
check("a planned passage fills its bars, marked as mine/queued", v.bars["2:4"].cells === "B...T.S.B...T.S." && v.bars["2:5"].queued === true);
const text = describeCircle(RUN, { hand: { name: "hand" } }, win, { now: T + 10_050 });
check("the description names tempo, meter and generation", /90 BPM, 4\/4 in sixteenths \(gen 2\)/.test(text), text);
check("…says 'struck/queued' over the OBSERVED bars, 3–5", /struck\/queued, bars 3–5 \(observed since you arrived\)/.test(text), text);
check("…and never says anyone heard anything", !/heard|hear\b/.test(text));
check("an empty window says nothing was struck since you arrived (no implied history)",
  /nothing struck or queued since you arrived/.test(describeCircle(RUN, {}, newStruckWindow(), { now: T + 10_050 })));
check("the count-in is announced before it ends", /count-in by adam, bars 0–0; open from bar 1/.test(describeCircle(RUN, {}, null, { now: T + 100 })));
check("a scheduled change is announced in time", /tempo → 120 BPM at bar 20 \(the new grid's bar 0\)/.test(describeCircle(CHANGED, {}, null, { now: T + 10_050 })));
check("no invented inheritance: an absent initiator is said plainly (carry note 7)",
  /the initiator has left; only the owner or an operator can change or end this circle/.test(describeCircle(RUN, {}, null, { now: T + 10_050, initiatorPresent: false })));

console.log("\n5. the reference kit (§6)");
check("both drums are valid instrument-set bags", normalizeInstrumentSetArgs({ id: "h", circle: "c", ...HAND_DRUM }).ok && normalizeInstrumentSetArgs({ id: "l", circle: "c", ...LOW_DRUM }).ok);
check("hand = B/T/S, low = B/M", Object.keys(HAND_DRUM.strokes).join("") === "BTS" && Object.keys(LOW_DRUM.strokes).join("") === "BM");
check("noise stays dark by default (every cutoff ≤ 4 kHz)", [...Object.values(HAND_DRUM.strokes), ...Object.values(LOW_DRUM.strokes)].every((s: any) => s.cutoff <= 4000));
check("…and the kit says plainly it is PROVISIONAL, not yet tuned by ear", /PROVISIONAL/.test(KIT_STATUS));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
