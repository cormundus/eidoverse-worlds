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
//
// BOUNDED, and keyed by STRUCTURE (Mica's packet review, 2026-10-07):
//   - identities are nested maps or a JSON tuple, never delimiter-joined
//     strings: ids may contain any character, and ('a|b','c') and ('a','b|c')
//     must stay two claims;
//   - a leg's receipt window is RELEASED when the leg dies (close, expel,
//     takeover, travel: server.ts calls releaseLeg). A dead leg can never send
//     again, and a returning identity is a new leg with a new window;
//   - planned-slot claims are PRUNED by age: a bar that has begun can never be
//     admitted again (a named bar needs F ahead, "next" needs L), so its claims
//     can never decide another judgement. Only the playable generations
//     (current, and prev while its span lives) keep any. Slots are NOT released
//     on a leave: they are per AUTHOR, and a takeover's old leg keeps sounding
//     (no leave is broadcast), so a released claim could be taken twice.
import { judgePlanned, judgeLive, DRUM_POLICY, gridForGen, barStart } from "../shared/circle.js";

type Receipt = Record<string, unknown>;
type Tables = {
  born: unknown;
  receipts: Map<string, Map<number, Map<number, Receipt>>>;   // client id → legGen → n → receipt
  slots: Map<number, Map<number, Set<string>>>;                // gen → bar → claim (JSON [author, voice])
};
/** One planned claim's identity within a (gen, bar): a JSON tuple, injective for any strings. */
const claimKey = (author: string, voice: string) => JSON.stringify([author, voice]);
type PhraseClient = {
  id: string; sub?: string; spectator: boolean; gen?: number; legGen?: number;
  world: { state: { entities: Record<string, any> }; broadcast(msg: unknown, except?: unknown): void } | null;
};

const byWorld = new WeakMap<object, Map<string, Tables>>();
const rateOf = new WeakMap<object, { win: number; count: number }>();
const PHRASE_BYTES_MAX = 4096;

/** Drop a circle's dedupe and slot tables (circle-set end, entity remove). */
export function clearCircleTables(w: object, id: string) { byWorld.get(w)?.delete(id); }

/** A leg died (close, expel, takeover, travel): release its receipt window in
 *  every circle of that world. The leg is (id, legGen) — the same identity the
 *  window was stored under. */
export function releaseLeg(w: object | null | undefined, leg: { id: string; legGen?: number; gen?: number }) {
  const m = w ? byWorld.get(w) : undefined;
  if (!m) return;
  const lg = leg.legGen ?? leg.gen ?? 0;
  for (const t of m.values()) {
    const legs = t.receipts.get(leg.id);
    if (!legs) continue;
    legs.delete(lg);
    if (!legs.size) t.receipts.delete(leg.id);
  }
}

/** Drop every claim that can never decide a judgement again: generations that
 *  are no longer playable, and bars that have begun. */
function pruneSlots(T: Tables, cbag: any, now: number) {
  for (const [gen, bars] of T.slots) {
    const g = cbag && (gen === cbag.gen || gen === cbag.prev?.gen) ? gridForGen(cbag, gen) : null;
    if (!g) { T.slots.delete(gen); continue; }
    for (const bar of bars.keys()) if (barStart(g, bar) <= now) bars.delete(bar);
    if (!bars.size) T.slots.delete(gen);
  }
}

/** Sizes only — never a receipt, an id or a pattern. For the lifecycle test,
 *  through the debug request, and only when DRUM_PHRASE_STATS=1 (messages.ts). */
export function phraseTableStats(w: object | null | undefined) {
  const out: Record<string, { legs: number; receipts: number; gens: number; bars: number; claims: number }> = {};
  for (const [id, t] of (w ? byWorld.get(w) : undefined) ?? []) {
    let legs = 0, receipts = 0, bars = 0, claims = 0;
    for (const byLeg of t.receipts.values()) for (const win of byLeg.values()) { legs++; receipts += win.size; }
    for (const byBar of t.slots.values()) for (const set of byBar.values()) { bars++; claims += set.size; }
    out[id] = { legs, receipts, gens: t.slots.size, bars, claims };
  }
  return out;
}

function tablesFor(w: object, id: string, born: unknown): Tables {
  let m = byWorld.get(w);
  if (!m) byWorld.set(w, (m = new Map()));
  let t = m.get(id);
  if (!t || t.born !== born) m.set(id, (t = { born, receipts: new Map(), slots: new Map() }));
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
  pruneSlots(T, ent.comp?.circle, now);
  let byLeg = T.receipts.get(c.id);
  if (!byLeg) T.receipts.set(c.id, (byLeg = new Map()));
  const lg = c.legGen ?? c.gen ?? 0;
  let win = byLeg.get(lg);
  if (!win) byLeg.set(lg, (win = new Map()));
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
      const key = claimKey(c.id, voice);
      let byBar = T.slots.get(msg.gen);
      let taken: number | undefined;
      for (let b = j.bar; b < j.bar + j.bars; b++) if (byBar?.get(b)?.has(key)) { taken = b; break; }
      if (taken !== undefined) receipt = refuse(`a planned slot is already taken: bar ${taken} of your "${voice}" — refused, never swapped in`);
      else {
        if (!byBar) T.slots.set(msg.gen, (byBar = new Map()));
        for (let b = j.bar; b < j.bar + j.bars; b++) {
          let claims = byBar.get(b);
          if (!claims) byBar.set(b, (claims = new Set()));
          claims.add(key);
        }
        receipt = { ...base, ok: true, bar: j.bar, bars: j.bars, acceptedAtServerMs: now, scheduledAtServerMs: j.scheduledAtServerMs };
        relay = { type: "phrase", circle, gen: msg.gen, voice, voiceGen: msg.voiceGen, bar: j.bar, bars: j.bars, pattern: j.pattern,
          ...(j.velocity ? { velocity: j.velocity } : {}), author: c.id, legGen, n };
      }
    }
  }
  store(receipt);
  send(receipt);
  if (relay) w.broadcast(relay, c);   // everyone except the sender (world.ts broadcast)
}
