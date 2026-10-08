# 09-repair — bounded phrase tables, tuple identity (code @ `4f9b459`)

The repair round Mica granted on 2026-10-07, after her packet review: release a dead leg's
receipt window, prune spent slot claims, and make every identity structural. The commit message
of `4f9b459` carries the full account.

| receipt | what | result |
|---|---|---|
| `suites.txt` | every suite at `4f9b459` | all green: circle 61, tag 11, hydration 30, phrase 37, drum-client 28, **phrase-identity 7**, **phrase-tables 12**, circle-live 27, comptest 36, hydration-live 15, phrase-live 29, **phrase-lifecycle 13**, drum-mcpl 44, drum-probe 20 |
| `base-red-phrase-identity-test.txt` | the identity test on `83ea82c` | red on exactly Mica's false refusal: ('a', 'b\|c') refused as "already taken" after ('a\|b', 'c') |
| `base-red-phrase-tables-test.txt` | the bounds test on `83ea82c` | red: the base has no release or size read (`phraseTableStats` not exported) |
| `base-red-phrase-lifecycle-live-test.txt` | the product-path test on `83ea82c` | 6 passed, 7 failed: every **size** check red because the base cannot be measured; every **behaviour** check (dedupe, taken slot, fresh window across takeover) green, as it should be |
| `mutants-all.txt` | the full table at `4f9b459` | 65/65 killed, every control green; **one stale**: `slots-off` (row 21), whose target was the string-keyed check this repair replaced |
| `mutant-slots-off-repointed.txt` | `slots-off` re-pointed at the new tuple check (same seam, same expected reds) | killed, control green |

**The full table therefore stands at 66/66.** The leak itself is shown by mutation: with the
release a no-op, 120 closed legs leave 120 windows, and 1,000 departed legs leave 1,000.
