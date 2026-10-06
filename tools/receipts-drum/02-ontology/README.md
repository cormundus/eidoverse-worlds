# 02-ontology — commit 2, the `eidoverse:circle` tag

**What the commit adds:**
- the drum circle's one MCPL tag, `eidoverse:circle`;
- its entry in the world feature set's tag ontology: facet `lifecycle`, never addressing;
- its suggested treatment: a 300 s throttle that only quiets, and never wakes anyone.

The description promises one line per circle per quiet window, and **never one per phrase
or bar**. What was struck lives in `look()`, never in the channel. Design rev 5 §5, and
Mica's seam 6: "the dedicated ambient tag is part of rung zero".

**This commit is the declaration only.** The line that carries the tag is emitted by the
mcpl phrase path, in a later commit. That commit also documents the tag in `AGENTS.md`,
beside the other ambient senses, the way the house documents each tag next to the
feature that emits it.

| test | base `5941d22` | candidate | mutations |
|---|---|---|---|
| `tools/circle-tag-test.ts` (reads the ontology the way a host does) | **4/7 red**: the tag is undefined | **11/0** | `tag-undeclared` and `tag-treatment-wakes`, **both killed** |

**Regressions:** `mcpl/manifest-test.ts` passes 28/0, and the manifest revision stays
self-consistent with the new tag. `tools/approach-wire-test.ts` passes 27/0. The mutation
run's control (`mutants.txt`) shows circle-test, circle-tag-test, circle-live-test and
comptest all green, with the preload active and no mutant.

**Deps:** mcpl's dependencies were installed with `--frozen-lockfile --ignore-scripts`. One
package did not install: `@animalabs/mcpl-core`, which is a `file:../../mcpl-core-ts`
sibling checkout that is absent on this machine. Only the MCPL door (`mcpl/net-server.ts`)
imports it, so this commit's test doesn't need it.
