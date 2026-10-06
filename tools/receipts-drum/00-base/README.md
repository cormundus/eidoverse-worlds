# 00-base — the composed base, before any drum-circle code

Base commit: the two-parent merge of main `9bb7bf8` and reviewed PR #201 `fee70d86`
(recorded in that commit's message). Every result below was taken on that base, before the
first feature commit. Each later commit is compared against these numbers.

| matrix | result | where it ran |
|---|---|---|
| `tools/comptest.ts` (components, mounts, motion, use) | **33 passed, 0 failed** | an owned scratch world (`tools/drum-scratch.mjs`): the nonce was echoed, the child exited, the port closed |
| `tools/permtest.ts` (the rights ladder) | **23 passed, 0 failed** | the same; the reserved-name cases use the harness's **fake** scratch token fixture |
| `tools/sound-clock-test.ts` (#201's own) | **13 passed, 0 failed** | no server |
| `tools/sound-guard-test.ts` (#201's own) | **11 passed, 0 failed** | no server |
| `tools/foldfix-test.ts` (fold conformance) | **19 passed, 5 failed** | no server |

**About the five foldfix failures:** they are **identical on plain main `9bb7bf8`**
(`foldfix-main-9bb7bf8.txt`), so the composition with #201 did not cause them. All five are
the fold stamping `born` (a creation generation) that the `spec/fixtures/` expectations
predate. That drift is upstream and outside this lane. The drum circle's acceptance requires
**exactly these five, and no new ones**.

**About the two permtest cases:** run without a credential fixture, the two reserved-name
cases fail with a 401. That is because the checkout's `mcpl/tokens.json` is gitignored and
absent. The harness now writes a fake `{"dev-token": {"id": "claude"}}` fixture into its own
scratch directory, and points `AGENT_TOKENS_PATH` at it (the seam in `server/auth.ts`). No
real credential was read or written at any point.

**About the scratch surface:** each owned world's receipt, printed at the end of
`comptest.txt` and `permtest.txt`, names the world, port, child PID, nonce, start and end
times, the child's exit, and a port-closed probe. Each world is preserved under
`$DRUM_SCRATCH_ROOT`, outside the repo. The child's environment is an allow-list: no
ambient `HN_*`, `WORLD_ADMIN`, `SFU_*` or real `JOIN_TOKEN` can reach it, and `WORLDS_DIR`,
`OPT_DIR`, `EIDOVERSE_DIR` and `AGENT_TOKENS_PATH` all point inside the scratch directory.

**Dependencies:** `bun install --frozen-lockfile --ignore-scripts`. Only the versions pinned
in the committed `bun.lock` are installed, and no lifecycle scripts run.
