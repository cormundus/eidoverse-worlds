# 07-a1 — A1 by ear, and what playing found (@ `5ca3527`)

**A1 passed by ear** (`A1.md`): "feels solid, feels like it's in time, feels like I'm having a good
play, getting into the groove". Two demo worlds (`demo-1.txt`, `demo-2.txt`, with the world key
redacted): the scripted resident had 113 passages accepted with 0 refused, then 141 with 0
refused.

## The commits since 06

| commit | what | found by |
|---|---|---|
| `0d5fa7c` | the pad strikes on pointerdown; the A1 demo harness | reading the pad before the demo |
| `dc6cddc` | bounded perception: earshot (the drum's own radius) and caps on look() | Adam: "flooding is a primary concern" |
| `09b50d3` | the pad opens at your body, and holds still | Adam, playing |
| `9b29e65` | the reference kit, tuned by ear (v2) | Adam: "quite muffled" → "much better" |
| `5ca3527` | the probe walks a body up to a drum | the pad bug the probe couldn't see |

## Receipts

| receipt | result |
|---|---|
| `suites.txt` | every suite green: circle 61, tag 11, hydration 30, phrase 37, drum-client 26, circle-live 27, comptest 36, hydration-live 15, phrase-live 29, **drum-mcpl 44**, **drum-probe 20** (real Chrome), and mcpl's manifest, effective, denoise and selfpose tests |
| `mutants-all.txt` | **the full table: 55/55 mutants killed**, every control green, across protocol, ontology, hydration, phrase plane, browser, pad, text tier and bounds |

`reach-test` is left out as environmental (VRM rig fixtures absent from this worktree; see 06).

## The flood bound, worked

Worst case, the drum part of one `look()`: 3 circles × (a header of ~350 B + 8 drum lines × ~420 B
(4 bars × 97 cells + names) + ~220 B of hint and counts) ≈ **12 KB**, however busy the world. It
was unbounded before; a 10-circle, 30-drum world came to ~120 KB. Under the test's flood: 2.2 KB,
and one "began" line per circle.
