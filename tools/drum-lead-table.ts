// drum-lead-table — A3's wall-clock table (Mica's receipt clarification 2): what the
// PROVISIONAL_TEST_VALUE policy means in seconds across the full supported tempo and
// meter range. H bars is both the horizon a phrase may be planned within and the
// minimum lead before a tempo change lands, so a model composing a passage has at
// most H bars of time, and a human waiting on a tempo change waits at least that long.
//
//   bun tools/drum-lead-table.ts
//
// Computed from the policy object itself (shared/circle.js), never retyped here.
import { DRUM_POLICY, BPM_MIN, BPM_MAX, METER_MIN, METER_MAX } from "../shared/circle.js";

const H = DRUM_POLICY.H_BARS;
const bpms = [BPM_MIN, 60, 90, 120, 180, BPM_MAX];
const meters = [METER_MIN, 3, 4, 6, 8, METER_MAX];
const bar = (bpm: number, meter: number) => (60 / bpm) * meter;   // seconds; a bar is `meter` beats
const fmt = (s: number) => (s < 10 ? s.toFixed(1) : s.toFixed(0)).padStart(5);

console.log(`policy: ${DRUM_POLICY.status}  L ${DRUM_POLICY.L_MS} ms · F ${DRUM_POLICY.F_MS} ms · H ${H} bars`);
console.log(`\nH = ${H} bars, in SECONDS (rows: beats per bar; columns: BPM)\n`);
console.log(`meter │${bpms.map((b) => String(b).padStart(6)).join("")}`);
console.log(`──────┼${"──────".repeat(bpms.length)}`);
for (const m of meters) console.log(`${String(m).padStart(5)} │${bpms.map((b) => " " + fmt(bar(b, m) * H)).join("")}`);
const lo = bar(BPM_MAX, METER_MIN) * H, hi = bar(BPM_MIN, METER_MAX) * H;
console.log(`\nrange: ${lo.toFixed(1)} s (${BPM_MAX} BPM, ${METER_MIN} beats) … ${hi.toFixed(1)} s (${BPM_MIN} BPM, ${METER_MAX} beats)`);
console.log(`L and F in bars at the extremes: L ${DRUM_POLICY.L_MS} ms = ${(DRUM_POLICY.L_MS / 1000 / bar(BPM_MAX, METER_MIN)).toFixed(2)} bar at ${BPM_MAX}/${METER_MIN}, ` +
  `${(DRUM_POLICY.L_MS / 1000 / bar(BPM_MIN, METER_MAX)).toFixed(4)} bar at ${BPM_MIN}/${METER_MAX}`);
// Mica's hand computations (mica-06), checked against the code:
const want: [number, number, number][] = [[240, 2, 8.0], [90, 4, 42.7], [40, 4, 96.0], [40, 12, 288.0]];
let ok = true;
for (const [b, m, s] of want) { const got = +(bar(b, m) * H).toFixed(1); if (got !== s) ok = false; console.log(`  ${b} BPM, ${m} beats: ${got} s ${got === s ? "✓" : `✗ (Mica: ${s})`}`); }
console.log(ok ? "\nall four of Mica's hand-computed figures match" : "\nMISMATCH with Mica's figures");
process.exit(ok ? 0 : 1);
