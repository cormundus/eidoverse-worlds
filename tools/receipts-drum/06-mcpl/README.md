# 06-mcpl — commit 6, the text tier (PROVEN @ `856b8b3`, except the door's branch)

**What the commit adds:** the drum circle for residents who perceive by reading. Design rev 5, §5.

- **`mcpl/agent.ts`:**
  - `play()`: one passage on one drum. It reads the circle's `gen` and the drum's `voiceGen`
    from folded state, writes for the grid **sounding now** (the outgoing one while a change is
    pending), and counts `bars` from the `|`s when they are left out. It resolves the world's
    receipt, a local refusal, or `unknown` after 5 s.
  - A `phrase` receive case feeds a per-circle **struck window** (struck or queued, never heard).
  - `look()` prints `describeCircle` for each circle, names each drum's stroke letters, and says
    plainly when the initiator has left.
  - **The `eidoverse:circle` line**, produced here: one "began" per quiet window, radius-gated
    and silent for the body's own playing. Later phrases only push the quiet deadline past their
    last step. Quiet, ended or removed each say so once.
- **`mcpl/tools.ts`:** the `play` tool. It turns the receipt into words and never second-guesses
  the world.
- **`mcpl/net-server.ts`:** kind `circle` → `eidoverse:circle`, held for pull-only hosts.
  **Not exercised here:** the door needs `@animalabs/mcpl-core`, which is not on this machine.
- **`shared/circle.js`:** `circleLifecycleLine`; `DRUM_POLICY.QUIET_MS` (60 s, PROVISIONAL,
  perception only).
- **`AGENTS.md`:** the section a resident reads.

## Receipts

| receipt | what | result |
|---|---|---|
| `candidate-drum-mcpl-test.txt` | the real WorldAgent + the real tool handler, live sockets, owned world | **33/0** |
| `base-red-drum-mcpl-test.txt` | the same test on `2572f9a` | **red**: no circle in look(), bags leak as `components:`, no `play` tool (the test crashes there) |
| `mutants-mcpl.txt` | nine text-tier mutants, applied in memory in the test process | **9/9 killed**, control green |
| `regressions.txt` | every earlier suite + mcpl's own unit tests | all green; `reach-test` is **environmental** (VRM rig fixtures absent from this worktree; it fails before any drum code) |

## The mutants, and what each one turned red

| mutant | seam | went red |
|---|---|---|
| `line-per-phrase` | one line per quiet window, never per phrase | "exactly ONE line for four passages" |
| `agent-self-echo` | no line for your own playing | "…under the listener's own name opens no line" |
| `radius-off` | the line is radius-gated | "a circle beyond the listener's radius makes no line" |
| `quiet-early` | "quiet" waits for the last queued step | "not before the last queued step" (it fired 2.4 s early) |
| `end-silent` | ending a played circle says so at once | "ending the circle … says so once" |
| `look-no-circle` | look() carries describeCircle | "the circle is described", "…pattern strings" (8 red) |
| `initiator-invented` | no invented inheritance | "once bob has left, look says exactly who" |
| `tool-stale-voicegen` | the tool reads the CURRENT voiceGen | "the tool reads the new voiceGen for you" |
| `tool-refusal-as-accept` | a refusal is reported as one | the count-in and taken-slot refusals |

**Like the browser's own-author guard,** the agent's self-echo guard sits behind the server's
sender exclusion. No real relay reaches it, so the test exercises it directly, with a control.

## A9, the intake end

Every circle-related event the listener's body produced is an `eidoverse:circle` lifecycle
line. None carries a pattern, nothing of the jam reaches the inbox, and the world log
(`history`, 1,000 entries) holds no `phrase` and no pattern string. The door's mapping of those
events to the tag is the one link not exercised here (see above).
