// worldbus — the ONE listener-owned world bus (design rev 5, §4.6; Mica, Q4:
// "extract one shared listener-owned world bus; do not mirror volume
// independently"). Everything placed in the world — `sound` (sounds.js) and
// the drum circle's instruments (instruments.js) — ends in this one gain,
// whose value is the listener's own `world volume` (voiceconsent.js
// volumeFor('world'), live on 'audio:volume'). World volume 0 therefore has
// ONE owner and ONE path: the analyser test (A5) checks both sources through
// it.
//
// Extracted VERBATIM from sounds.js (its rule 5: "the listener has the last
// word on loudness"; Mica, #192 review, blocker 1), where it was private. The
// file it came from is Weft's lane, so this extraction is for Weft and Ra to
// review before anything lands upstream.
import { bus } from './base.js';
import { audioContext } from './audioctx.js';
import { volumeFor } from './voiceconsent.js';

// Created with the first graph (the AudioContext is lazy too).
let worldBus = null;
export function worldGain() {
  if (!worldBus) {
    const ctx = audioContext();
    worldBus = ctx.createGain();
    worldBus.gain.value = volumeFor('world');
    worldBus.connect(ctx.destination);
  }
  return worldBus;
}
bus.on('audio:volume', ({ cat, value }) => { if (cat === 'world' && worldBus) worldBus.gain.value = value; });
/** For probes: the listener-side gain node (null until the first graph). */
export const _worldBus = () => worldBus;
