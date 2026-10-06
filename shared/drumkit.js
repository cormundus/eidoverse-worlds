// drumkit — the rung-zero REFERENCE KIT for the drum circle (design rev 5,
// §6: one hand drum, B/T/S = bass, tone, slap; one low drum, B/M = open bass,
// muted). These are `drum-v1` instrument bags, ready for instrument-set.
//
// PROVISIONAL: the design says these values are "tuned by ear and committed
// as the reference kit". They have NOT been tuned by ear yet — the engineer
// who wrote them cannot hear. They are first guesses from the shape of the
// sounds (a low bass with a slow pitch drop, a bright short slap with more
// noise), to be tuned by the players (Adam first) in the scratch demo and
// committed then. Recorded as a deliberate abstention in
// IMPLEMENTATION-CARRY.
export const KIT_STATUS = 'PROVISIONAL — not yet tuned by ear';

export const HAND_DRUM = Object.freeze({
  name: 'hand', synth: 'drum-v1', polyphony: 8, volume: 0.8, radius: 15,
  strokes: {
    B: { f0: 85, drop: 1.6, dropMs: 90, decayMs: 380, noise: 0.06, cutoff: 900 },     // bass: low, round, a little drop
    T: { f0: 330, drop: 1.25, dropMs: 35, decayMs: 190, noise: 0.18, cutoff: 2600 },  // tone: open, ringing
    S: { f0: 520, drop: 1.1, dropMs: 15, decayMs: 95, noise: 0.62, cutoff: 3800 },    // slap: short, bright, noisy (still ≤ 4 kHz, dark by default)
  },
});

export const LOW_DRUM = Object.freeze({
  name: 'low', synth: 'drum-v1', polyphony: 6, volume: 0.9, radius: 18,
  strokes: {
    B: { f0: 58, drop: 2.0, dropMs: 160, decayMs: 620, noise: 0.04, cutoff: 650 },    // open bass: deep, long, falling
    M: { f0: 72, drop: 1.5, dropMs: 60, decayMs: 130, noise: 0.10, cutoff: 900 },     // muted: the same skin, damped
  },
});
