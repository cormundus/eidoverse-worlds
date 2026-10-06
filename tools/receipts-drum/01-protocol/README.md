# 01-protocol — commit 1, the protocol amendment

**What the commit adds:**
- `circle-set` and `instrument-set`: two new closed verbs, a proposed amendment that exists
  on the fork only;
- their meaning module, `shared/circle.js`;
- their fold cases;
- their `VERB_NEEDS` and `GUARD_AUTHORED` entries;
- the refusal on the behavior emit path;
- the refusal of a plain `comp` of a protected type, by the door **and** by the fold.

Design: DESIGN-instruments rev 5 (privately approved), §2.1, §2.2 and §2.6.

## Base red, then candidate green, then mutation red

| test | base `993a780` | candidate | mutations |
|---|---|---|---|
| `tools/circle-test.ts` (pure, hand-computed) | **red**: `shared/circle.js` is absent (`base-red/circle-test.txt`) | **61/0** | 7 mutants killed |
| `tools/circle-live-test.ts` (owned scratch world) | **red**: "verb not allowed: circle-set" (`base-red/circle-live-test.txt`) | **27/0** | 8 mutants killed |
| `tools/comptest.ts` (house matrix + the drum section) | **33/3**: the original 33 pass, and the 3 drum checks fail; on the base, `comp {type: "circle"}` is simply accepted | **36/0** | 1 mutant killed |

`mutants.txt` holds the full run. First comes the control, with the preload active and no
mutant: all three tests green. Then come the **11 mutants, all killed**, one per load-bearing
seam. Each mutant is an exact, single-match string swap, applied **in memory** by
`tools/drum-mutant-preload.mjs`; no file on disk is modified. The swaps are listed in
`tools/drum-mutants-table.mjs`. The seams:

| mutant | the seam | what went red |
|---|---|---|
| `emit-gate-open` | a script may not emit the two verbs | live: "the emit is refused by name" |
| `guard-list-off` | the verbs are in `GUARD_AUTHORED` | live: the guarded-drum refusal |
| `vcomp-door-open` | the door refuses `comp` of a protected type | live and comptest |
| `fold-comp-open` | the fold refuses `comp` of a protected type | circle-test §6 |
| `fold-start-successor` | a start folds only as the exact successor | circle-test, including "a restart stamped gen 1" |
| `gen-resets` | generations never reset (the stale-`dup` fix) | circle-test and live |
| `lead-floor-off` | a change needs at least `H` bars of lead | circle-test and live |
| `initiator-rule-off` | only the initiator, owner or operator retimes | circle-test and live |
| `pending-rule-off` | one pending change; none before the start | circle-test and live |
| `fold-voicegen-successor` | an instrument edit folds only as `voiceGen` + 1 | circle-test |
| `synth-open` | an unknown synth fails closed | circle-test and live |

Every live mutant run proved its teardown: the child exited and the port closed.

## Nothing else moved (`candidate/`, `regression/`)

**On the candidate:**
- `permtest` 23/0 (base 23/0);
- `foldfix` 19/5, with **the same five** failures as the base (the upstream `born` fixture
  drift);
- `guardtest` 29/0;
- `behaviortest` 27/0;
- `guard-principal-test` 22/0;
- `caption-verb-test` 64/0;
- `radio-behavior-test` 11/0;
- `compfold-test` 24/0.

**Deps.** The client's dependencies were installed the same way as the root's
(`--frozen-lockfile --ignore-scripts`), because `compfold-test` loads client modules.

## Decisions this commit makes, each with the note that owns it

- **Where the door stamps `t0`:** from `Date.now()` at acceptance, not from the dispatch's
  `now`. A verb deferred behind a cold spawn runs later than it arrived. Owned by the clock
  amendment (2026-10-05) and design §2.1.
- **The fold derives `prev` itself** from the folded grid. The entry carries only the new
  `t0` and the successor `gen`. Owned by design §2.1 and IMPLEMENTATION-CARRY note 6.
- **`barAt` returns negative bars and never clamps.** Owned by IMPLEMENTATION-CARRY note 6;
  circle-test checks −22 at the request and the −16 boundary.
- **`PROTECTED_COMPS` is `['circle', 'instrument']`.** `captions` keeps its own older check;
  whether it joins the list is Weft and Ra's call. Owned by design §4.7.
- **`stateToEntries` and `seedProtected` are not in this commit.** They are commit 3, the
  hydration contract. Until commit 3, a headless agent that joins late does not see a circle
  bag folded before it joined. That is the same gap as captions have on main today, and
  commit 3 closes it for both new types.
- **The provisional policy lives in `DRUM_POLICY`.** It is labelled
  `PROVISIONAL_TEST_VALUE`, frozen, and kept in one place. circle-test §7 shows that
  changing `H` changes what the door stamps, but never the entry's shape or the fold's
  rule. Owned by Mica's receipt clarification 2.
