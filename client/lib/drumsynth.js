// drumsynth — `drum-v1`, the drum circle's one synthesis algorithm (design
// rev 5, §6; shared/circle.js names it in KNOWN_SYNTHS). Parameters, never
// code: an instrument bag says WHAT to strike; this says HOW a stroke sounds.
//
// One stroke = two sources and an envelope:
//   - a sine whose frequency ramps exponentially from f0 to f0/drop over dropMs;
//   - a looping noise buffer through a lowpass at `cutoff`;
//   mixed by `noise` (tone × (1 − noise), noise × noise), into ONE gain that
//   decays exponentially over decayMs from the stroke's peak, into the
//   instrument's panner (the caller's `dest`).
//
// The NOISE CONTRACT, so "the same noise" means something exact: 48,000
// frames in an AudioBuffer whose own sampleRate is 48,000 (whatever the
// context's rate), filled from mulberry32 with seed 0x1D0DEC0D, each 32-bit
// output u mapped to u / 2³² × 2 − 1, generated once per context. What drum-v1
// promises is the same kit IN MEANING — the same parameters read by the same
// algorithm — not a byte-identical waveform: WebAudio implementations differ
// in resampling and filter detail (Mica, rev-2/rev-5 reviews).
export const SYNTH_ID = 'drum-v1';
export const NOISE_SEED = 0x1D0DEC0D;
export const NOISE_FRAMES = 48000, NOISE_RATE = 48000;

/** mulberry32: the 32-bit generator the noise contract names. Returns the raw
 *  unsigned 32-bit outputs (the caller maps them). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  };
}
/** The contract's samples, as plain numbers (testable without a context). */
export function noiseSamples(n = NOISE_FRAMES) {
  const r = mulberry32(NOISE_SEED), out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r() / 4294967296 * 2 - 1;
  return out;
}
const noiseByCtx = new WeakMap();
export function noiseBuffer(ctx) {
  let b = noiseByCtx.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, NOISE_FRAMES, NOISE_RATE);
    b.getChannelData(0).set(noiseSamples());
    noiseByCtx.set(ctx, b);
  }
  return b;
}

/** Strike one stroke at context time `when` with linear peak gain `peak`,
 *  into `dest`. Returns a handle {started, ends, stop()} so the caller can
 *  steal the voice (bounded polyphony) and tear it down cleanly. */
export function strike(ctx, stroke, when, peak, dest) {
  const t0 = Math.max(when, ctx.currentTime);
  const decay = stroke.decayMs / 1000, drop = stroke.dropMs / 1000;
  const env = ctx.createGain();
  env.gain.setValueAtTime(Math.max(peak, 1e-4), t0);
  env.gain.exponentialRampToValueAtTime(1e-4, t0 + decay);
  env.connect(dest);

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(stroke.f0, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(stroke.f0 / stroke.drop, 1), t0 + drop);
  const tone = ctx.createGain();
  tone.gain.value = 1 - stroke.noise;
  osc.connect(tone); tone.connect(env);

  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = stroke.cutoff;
  const ng = ctx.createGain();
  ng.gain.value = stroke.noise;
  src.connect(lp); lp.connect(ng); ng.connect(env);

  const ends = t0 + decay + 0.05;
  osc.start(t0); src.start(t0);
  osc.stop(ends); src.stop(ends);
  const nodes = [osc, tone, src, lp, ng, env];
  let done = false;
  const stop = () => {
    if (done) return; done = true;
    try { env.gain.cancelScheduledValues(ctx.currentTime); env.gain.setValueAtTime(0, ctx.currentTime); } catch { /* already gone */ }
    try { osc.stop(); } catch { /* already stopped */ }
    try { src.stop(); } catch { /* already stopped */ }
    for (const n of nodes) try { n.disconnect(); } catch { /* partial */ }
  };
  osc.onended = () => { if (!done) { done = true; for (const n of nodes) try { n.disconnect(); } catch { /* partial */ } } };
  return { started: t0, ends, stop, isDone: () => done };
}
