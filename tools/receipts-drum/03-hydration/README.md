# 03-hydration — commit 3, the hydration contract

**What the commit adds:** the answer to Mica's rev-3 blocker. The circle and instrument bags
now survive snapshot and late-join reconstruction, through **one** implementation, with the
trust boundary kept structural. Design rev 5, §4.7 and §4.4.

**The pieces:**
- **`shared/fold.js` `seedProtected(st, snapshot)`.** Every protected bag in `st` becomes the
  snapshot's bag passed through its type's shared normalizer, or it is dropped (fails
  closed). It is a function over state, not an entry, so no log line, verb, behavior emit or
  message dispatch can reach it. Its diagnostics name the entity, the type and a fixed
  reason, and never the bag.
- **`shared/circle.js`:** `normalizeCircleBag` and `normalizeInstrumentBag`, both
  deterministic and side-effect free.
- **`stateToEntries`** no longer emits a `comp` of a protected type, since the fold would
  refuse it anyway.
- **The agent (`mcpl/agent.ts`)** replays the snapshot's synthetic entries, then seeds, then
  folds the tail. The two verbs also join its `ENTITY_VERBS`.
- **The browser (`client/lib/state.js` hydrate)** runs the same `seedProtected` over its
  wholesale copy.
- **`leave`** gains an additive `gen`: the departing leg's `legGen ?? gen`, the same value a
  relayed phrase will carry as `legGen`. This follows the aux-retirement precedent. Old
  clients ignore it.

## Base red, then candidate green, then mutation red

| test | base = commit 2 `a3094e9` | candidate |
|---|---|---|
| `tools/hydration-test.ts` (pure: the real browser `hydrate()` against the agent's join sequence) | **red**: `seedProtected` is not exported | **30/0** |
| `tools/hydration-live-test.ts` (the REAL `WorldAgent`, owned world, `FOLD_EVERY=1`) | **red**: the agent's bags are `undefined`, the browser's are not, and a live edit after the join cannot fold (the exact late-join gap) | **15/0** |

**A finding on the way, recorded because it matters:** the first live run did not set
`FOLD_EVERY`. The join's *tail* still carried the circle's own entries, so the agent could
fold them without seeding at all, and **the test passed on the parent commit for the wrong
reason**. The test now runs under `FOLD_EVERY=1`, and its first check proves the tail holds
none of the circle's history. Only then does the comparison mean anything.

**`mutants-all.txt`: 18/18 killed, and the control is green across all six tests.** This
covers every mutant from commits 1 to 3, run with the final runner. Commit 3's five:

| mutant | the seam | what went red |
|---|---|---|
| `seed-agent-off` | the agent seeds before the tail | hydration-live: the agent's bags are `undefined`, and the post-join edit cannot fold |
| `seed-browser-off` | the browser goes through the same normalizer | hydration: the unknown-synth bag survives on the browser |
| `seed-normalize-off` | seeding fails closed | hydration: a malformed bag is kept |
| `entries-carry-protected` | protected bags never travel as entries | hydration: `stateToEntries` emits one |
| `leave-gen-off` | a leave carries the departing leg's generation | hydration-live: the leave has no `gen` |

**The runner was fixed during this commit.** It first gave the preload only to the *server*
child, so a mutant in client code that a live test runs in-process (the agent) never loaded,
and `seed-agent-off` "survived" untouched. The test process gets the preload now. All 18
were re-run afterwards with that runner.

## Mica's nine points (A12), where each one is checked

1. **Nontrivial generations:** both tests take a circle to gen 3, with a live `prev`
   mid-handover, and an instrument to `voiceGen` 3.
2. **Fold the server state, and 3. serialize the snapshot:** the pure test does a JSON
   round-trip; the live test uses a real spectator's snapshot.
4. **Hydrate a fresh browser and a fresh agent:** the real `hydrate()`, the agent's exact
   sequence, and the real `WorldAgent`.
5. **Identical bags:** `t0`, `gen`, `prev`, spans, `voiceGen` and bag, compared by canonical
   deep-equal against the server.
6. **Queued phrase admission agrees:** **the span half is here.** The same (gen, bar) gets
   the same in-span / past-span / stale verdict on both clients, and the verdicts are the
   hand-computed ones. Full phrase admission arrives with the phrase plane and will be
   re-checked there.
7. **End markers survive:** `drum2` hydrates ended, and the next start stamps gen 2 on both.
8. **Untrusted `comp` stays refused**, after hydration, on both.
9. **A hand-edited non-successor entry stays refused**, on both.

**Plus:** the overlap case (a tail entry the snapshot already covers folds to nothing); a
malformed bag is dropped on both; the diagnostics carry no payload.

## The caption variant (not counted; Weft and Ra's call)

`hydration-test.txt` ends with a note: captions after a late join are **PRESENT** on the
browser and **MISSING** on the agent. That is red on main too
(`probes/probe-caption-latejoin.mjs` in the design workspace). It turns green only if captions
join `PROTECTED_COMPS`, which is Weft and Ra's decision. Raising the gap upstream is Adam's.

## Nothing else moved (`regression/`)

- **House and drum suites:** comptest 36/0, permtest 23/0, circle-live 27/0, compfold 24/0,
  behaviortest 27/0, guardtest 29/0, caption-verb 64/0, circle 61/0, tag 11/0, and foldfix
  19/5 with **the same five** as the base.
- **mcpl:** effective, denoise and selfpose all pass.
- **mcpl `reach-test` cannot run on this checkout.** It needs VRM avatar files under
  `assets/opt`, which are absent, so that result is environmental and unrelated.
