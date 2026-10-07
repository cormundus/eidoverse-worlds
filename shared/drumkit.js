// drumkit — the rung-zero REFERENCE KIT for the drum circle (design rev 5,
// §6: one hand drum, B/T/S = bass, tone, slap; one low drum, B/M = open bass,
// muted). These are `drum-v1` instrument bags, ready for instrument-set.
//
// TUNED BY EAR in the A1 demo, 2026-10-06 (Cormundus playing, I.M. turning
// the numbers). The first guesses (v1) kept every noise filter at or under
// 4 kHz and the noise faint; played live they read as "quite muffled". v2
// opens the filters 3–4× and raises the noise for a real attack, and snaps
// the pitch drops a little faster: "it sounded much better", then, playing
// against the scripted resident, "feels solid, feels like it's in time".
// Every value stays a proposal for the instrument's lane owners.
export const KIT_STATUS = 'TUNED BY EAR — v2, the A1 demo, 2026-10-06';

export const HAND_DRUM = Object.freeze({
  name: 'hand', synth: 'drum-v1', polyphony: 8, volume: 0.8, radius: 15,
  strokes: {
    B: { f0: 95, drop: 1.6, dropMs: 60, decayMs: 320, noise: 0.18, cutoff: 3500 },    // bass: low, round, with an attack
    T: { f0: 340, drop: 1.25, dropMs: 25, decayMs: 220, noise: 0.30, cutoff: 7000 },  // tone: open, ringing
    S: { f0: 600, drop: 1.1, dropMs: 10, decayMs: 110, noise: 0.75, cutoff: 11000 },  // slap: short, bright, cracking
  },
});

export const LOW_DRUM = Object.freeze({
  name: 'low', synth: 'drum-v1', polyphony: 6, volume: 0.9, radius: 18,
  strokes: {
    B: { f0: 62, drop: 1.8, dropMs: 120, decayMs: 550, noise: 0.14, cutoff: 2800 },   // open bass: deep, falling, still audible on small speakers
    M: { f0: 80, drop: 1.5, dropMs: 40, decayMs: 150, noise: 0.28, cutoff: 4500 },    // muted: the same skin, damped
  },
});
