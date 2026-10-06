// eidoverse-worlds sequencer — the drum circle's PHRASE plane (design rev 5,
// §2.3, §2.4, §4.1, §4.2). A phrase is playing: a moment, not a fact about
// the world. Like `anim` it is relayed once and NEVER logged; unlike `anim`,
// every outcome is receipted to the sender, because a player must know
// whether the circle heard them.
//
// What lives here is the state the pure judges (shared/circle.js
// judgePlanned / judgeLive) must not hold:
//   - the DEDUPE WINDOW: the last RECEIPT_WINDOW receipts per (leg, circle).
//     The identity is (author, legGen, circle, gen, n); the server supplies
//     author and legGen. A resend of a stored n gets the ORIGINAL receipt with
//     `dup: true` and relays nothing. An unseen n inside the window is judged
//     as new (a message the silent rate gate dropped, retried later). Only an
//     n older than the window is refused, as "too old to verify".
//   - PLANNED-SLOT CLAIMS: (author, voice, gen, bar). A multi-bar phrase
//     claims every bar it covers; a later phrase that overlaps any claimed bar
//     is refused whole, never swapped in. Live hits claim nothing (additive).
//   - the per-leg PHRASE RATE, refused WITH a receipt. (The sequencer's
//     global message gate in server.ts still drops silently before any
//     handler runs; that boundary is declared, and same-n retry is the remedy.)
// Tables are keyed by the circle entity's creation generation (`born`), so a
// re-spawned entity under the same id never meets old entries, and they are
// cleared when a circle ends or its entity is removed. Generations never
// reset on an entity, so a dedupe key can never collide across an end and a
// restart either. Nothing here survives a process restart, and nothing here
// claims exactly-once across one (§4.2).
import { judgePlanned, judgeLive, DRUM_POLICY } from "../shared/circle.js";

type Receipt = Record<string, unknown>;
type Tables = { born: unknown; receipts: Map<string, Map<number, Receipt>>; slots: Set<string> };
type PhraseClient = {
  id: string; sub?: string; spectator: boolean; gen?: number; legGen?: number;
  world: { state: { entities: Record<string, any> }; broadcast(msg: unknown, except?: unknown): void } | null;
};

const byWorld = new WeakMap<object, Map<string, Tables>>();
const rateOf = new WeakMap<object, { win: number; count: number }>();
const PHRASE_BYTES_MAX = 4096;

/** Drop a circle's dedupe and slot tables (circle-set end, entity remove). */
export function clearCircleTables(w: object, id: string) { byWorld.get(w)?.delete(id); }

function tablesFor(w: object, id: string, born: unknown): Tables {
  let m = byWorld.get(w);
  if (!m) byWorld.set(w, (m = new Map()));
  let t = m.get(id);
  if (!t || t.born !== born) m.set(id, (t = { born, receipts: new Map(), slots: new Set() }));
  return t;
}

/** One phrase message from a client: judge, dedupe, claim, receipt, relay.
 *  Never throws past its caller's envelope; every outcome is a receipt. */
export function handlePhrase(c: PhraseClient, ws: { send(d: string): void }, msg: any, policy = DRUM_POLICY) {
  const w = c.world;
  if (!w) return;
  const now = Date.now();
  const n = msg?.n;
  const circle = String(msg?.circle ?? "").slice(0, 64), voice = String(msg?.voice ?? "").slice(0, 64);
  const base = { n, circle, gen: msg?.gen, voice, voiceGen: msg?.voiceGen };
  const send = (r: Receipt) => ws.send(JSON.stringify({ type: "phrase-receipt", ...r }));
  const refuse = (why: string): Receipt => ({ ...base, ok: false, acceptedAtServerMs: now, why });

  if (!Number.isInteger(n) || n < 0) return send(refuse("n must be a non-negative integer (your own counter, rising)"));
  if (c.spectator) return send(refuse("spectators and attached media legs can't play — join embodied"));
  if (JSON.stringify(msg).length > PHRASE_BYTES_MAX) return send(refuse(`phrase too large (${PHRASE_BYTES_MAX} bytes max)`));
  const ent = w.state.entities[circle];
  if (!ent) return send(refuse(`no circle "${circle}" here`));

  const T = tablesFor(w, circle, ent.born);
  const legKey = `${c.id}|${c.legGen ?? c.gen ?? 0}`;
  let win = T.receipts.get(legKey);
  if (!win) T.receipts.set(legKey, (win = new Map()));
  const prior = win.get(n);
  if (prior) return send({ ...prior, dup: true });
  if (win.size >= policy.RECEIPT_WINDOW && n < Math.min(...win.keys())) return send(refuse("too old to verify"));

  const store = (r: Receipt) => {
    win!.set(n, r);
    while (win!.size > policy.RECEIPT_WINDOW) win!.delete(Math.min(...win!.keys()));
  };
  const rate = rateOf.get(c) ?? { win: now, count: 0 };
  if (now - rate.win > 1000) { rate.win = now; rate.count = 0; }
  rate.count++; rateOf.set(c, rate);
  if (rate.count > policy.PHRASE_RATE_PER_S) { const r = refuse(`phrase rate: ${policy.PHRASE_RATE_PER_S} per second per leg`); store(r); return send(r); }

  const cbag = ent.comp?.circle;
  const inst = w.state.entities[voice]?.comp?.instrument;
  const init = cbag?.initiator;
  const isInitiator = !!init && init.id === c.id && (!init.sub || init.sub === c.sub);
  const legGen = c.legGen ?? c.gen ?? 0;
  const live = msg.live === true;
  let receipt: Receipt, relay: Record<string, unknown> | null = null;

  if (live) {
    const j: any = judgeLive(cbag, inst, msg, { now, isInitiator, policy });
    if (!j.ok) receipt = refuse(j.why);
    else {
      receipt = { ...base, ok: true, bar: j.bar, step: j.step, acceptedAtServerMs: now,
        scheduledAtServerMs: j.scheduledAtServerMs, arrivalToGridMs: j.arrivalToGridMs, basis: j.basis };
      relay = { type: "phrase", live: true, circle, gen: msg.gen, voice, voiceGen: msg.voiceGen, bar: j.bar, step: j.step,
        stroke: msg.stroke, ...(msg.velocity !== undefined ? { velocity: msg.velocity } : {}), author: c.id, legGen, n };
    }
  } else {
    const j: any = judgePlanned(cbag, inst, msg, { now, isInitiator, policy });
    if (!j.ok) receipt = refuse(j.why);
    else {
      const claims: string[] = [];
      for (let b = j.bar; b < j.bar + j.bars; b++) claims.push(`${c.id}|${voice}|${msg.gen}|${b}`);
      const taken = claims.find((k) => T.slots.has(k));
      if (taken) receipt = refuse(`a planned slot is already taken: bar ${taken.split("|").pop()} of your "${voice}" — refused, never swapped in`);
      else {
        for (const k of claims) T.slots.add(k);
        receipt = { ...base, ok: true, bar: j.bar, bars: j.bars, acceptedAtServerMs: now, scheduledAtServerMs: j.scheduledAtServerMs };
        relay = { type: "phrase", circle, gen: msg.gen, voice, voiceGen: msg.voiceGen, bar: j.bar, bars: j.bars, pattern: j.pattern,
          ...(j.velocity ? { velocity: j.velocity } : {}), author: c.id, legGen, n };
      }
    }
  }
  store(receipt);
  // bound the claims: only the playable generations' bars can matter
  if (T.slots.size > 2048 && cbag) {
    const keep = new Set([String(cbag.gen), String(cbag.prev?.gen)]);
    for (const k of T.slots) if (!keep.has(k.split("|")[2])) T.slots.delete(k);
  }
  send(receipt);
  if (relay) w.broadcast(relay, c);   // everyone except the sender (world.ts broadcast)
}
