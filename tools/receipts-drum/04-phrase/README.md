# 04-phrase — commit 4, the phrase plane (server)

**What the commit adds:** playing. A phrase is relayed once, **never logged**, and always
receipted. Design rev 5, §2.3, §2.4, §2.5, §4.1 and §4.3.

**The pieces:**
- **`shared/circle.js` `judgePlanned` / `judgeLive`:** pure judges, shared, with no state.
  - Planned phrases cover whole future bars, and the pattern never affects admission:
    - "next" is the first bar whose step 0 lies at least `L` ahead;
    - a named bar needs at least `F`;
    - the horizon is measured on the grid's own current bar, which may be **negative and is
      never clamped**;
    - a passage may not cross a scheduled change;
    - the count-in applies to the circle's initial grid only;
    - the alphabet is exact, and `|` is allowed only between bars.
  - Live hits name a step index: chosen by a synced client (`client-step`), or resolved
    against arrival (`arrival`). They must lie inside their generation's span and at least
    `F` after acceptance.
- **`server/phrases.ts`:** the state the judges must not hold.
  - The **64-receipt dedupe window** per (leg, circle). A resend gets the original receipt
    with `dup`, and nothing is relayed; an unseen `n` inside the window is judged as new;
    only an `n` older than the window is refused.
  - **Planned-slot claims** per (author, voice, gen, bar). An overlap refuses the whole
    passage; a second author is allowed.
  - The **per-leg phrase rate**, refused with a receipt.
  - Tables are keyed by the entity's creation generation, and cleared on `circle-set end` or
    `remove`.
- **`server/messages.ts`:** the `phrase` handler. Every outcome is a receipt, a spectator
  included. `author` and `legGen` are inserted by the server, and the relay goes to
  everyone except the sender.
- **`docs/WIRE.md`:** `phrase`, `phrase-receipt`, the relayed `phrase`, `leave.gen`, and the
  two verbs, each marked as a proposed amendment that exists on the fork only.

## Base red, then candidate green, then mutation red

| test | base = commit 3 `fe6674b` | candidate |
|---|---|---|
| `tools/phrase-test.ts` (pure, hand-computed) | **red**: `judgeLive` is not exported | **37/0** |
| `tools/phrase-live-test.ts` (owned world) | **red**: no receipt ever comes back, because the server silently ignores an unknown message type | **29/0** |

**The hand-computed numbers** (design §3, grid 90 BPM 4/4 in sixteenths):
- bar 3 at T + 10,000 is refused: "began 2000 ms ago; next open bar is 4";
- "next" resolves to bar 4, at T + 10,666.67;
- bar 4 is accepted at 10,600, and refused at 10,640: "begins in 26.67 ms … next open bar
  is 5";
- the synced step 62 arriving at 10,110 gives bar 3 step 14, scheduled 10,333.33,
  `arrivalToGridMs` 223.33;
- the unsynced "next" at 10,200 gives step 63, at 10,500, 300.00 after arrival;
- the handover hit into gen-2 step 62 is accepted, and gen-2 step 320 is refused;
- the press at 53,250 lands on gen-3 step 1 at 53,458.33, with `arrivalToGridMs` 148.33;
- bars 18–21 are refused as crossing bar 20;
- the pending grid's bar 0 opens at exactly T + 21,333.33, and an 8-bar passage at exactly
  T + 35,333.33 (carry note 6).

**Mica's multi-bar suite (carry note 8):** all seven cases are covered.
- **The stateless cases, in `phrase-test`:** a valid 8-bar passage at the edge of `H`; one
  bar too far; first bar fits but last doesn't; crossing the change; a count-in overlap
  refusing the whole passage.
- **The stateful cases, in `phrase-live-test`:** a middle-bar overlap refusing the whole
  passage; a second author permitted on the same voice and bars.

**`mutants.txt`, with `mutants-author-rerun.txt`: 13/13 killed.** The control is green
across all eight tests (circle, tag, hydration, phrase, and the four live ones).

| mutant | the seam | what went red |
|---|---|---|
| `dedupe-off` | a resend returns the original receipt | live: dup |
| `window-old-off` | an n older than the window is refused | live: too old to verify |
| `slots-off` | one planned phrase per slot; overlap refuses whole | live: both slot checks |
| `relay-to-sender` | the relay excludes the sender | live |
| `author-from-client` | the server inserts author and legGen | live (see below) |
| `rate-off` | the phrase budget is receipted | live |
| `spectator-off` | spectators are refused, and told | live |
| `countin-off` | the count-in is the initiator's | pure and live |
| `floor-off` | a named bar needs `F` | pure |
| `horizon-clamped` | a negative current bar is never clamped | pure: all three horizon checks |
| `crossing-off` | no crossing a scheduled change | pure |
| `live-span-off` | a live hit stays inside its generation's span | pure |
| `pipe-anywhere` | `|` only between bars | pure |

**A finding on the way:** `author-from-client` first **survived**. The live test waited for
the relay with a predicate that also required `author === "bob"`, the very property under
test. So the mutant made the test hang, instead of failing the named check. The test now
waits on `n` alone and then checks the author, and the mutant is killed
(`mutants-author-rerun.txt`).

## A9 — no retention (the world-log end)

`phrase-live-test` §9 reads the whole history after a session. It holds `circle-set` and
`instrument-set`, and **no phrase of any kind**. The resident-intake end of A9 is checked
when the mcpl perception lands.

## Nothing else moved (`regression/`)

- **The two suites that regex `server/messages.ts`'s source:** `whisper-disable` and
  `voice-wiring`, both green.
- **House and drum suites:** comptest 36/0, permtest 23/0, circle-live 27/0, hydration-live
  15/0, behaviortest 27/0, compfold 24/0, caption-verb 64/0, circle 61/0, hydration 30/0,
  tag 11/0, and foldfix with the **same five** as the base.
