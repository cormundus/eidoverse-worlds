# 05-browser — commit 5, the browser layer (PROVEN in a real browser @ `64c69a8`)

**What the commit adds:** the drum circle in the full client. Design rev 5, §4.6, §6 and §7.

- **`client/lib/instruments.js`:** the realizer.
  - It reads the folded bags from the shadow state.
  - Its scheduler hands steps to WebAudio only inside a 200 ms window, and **never plays a
    step late**.
  - Queued steps are voided by span end, by a new `voiceGen`, by a leave (bound to the
    departing leg's `gen`), and by a world reset.
  - It has bounded polyphony (the oldest voice is stolen) and one panner per drum, feeding
    the world bus.
  - It shows visible strikes.
  - **The hitter's pad:** the local event at once; the shared event through the server; the
    three states (shared / local only / sharing unknown), with both deadlines and one
    same-`n` retry; and the shared copy is never replayed to the hitter.
- **`client/lib/drumsynth.js`:** `drum-v1`, with the exact noise contract.
- **`client/lib/worldbus.js`:** the one listener-owned world bus, **extracted verbatim from
  `sounds.js`** (Weft's file: +6/−14 there, exports preserved). This is for Weft and Ra's
  review.
- **`shared/drumkit.js`:** the reference kit (hand drum B/T/S, low drum B/M), marked
  **PROVISIONAL, not yet tuned by ear**. The engineer who wrote it can't hear; Adam tunes
  it in the demo.
- **`shared/circle.js`:** `chooseLiveStep`, `sharingUnknownDeadline`, and the struck window
  and `describeCircle`, the one description the pad, Lite and mcpl all print.
- **`client/lib/net.js`:** `sendPhrase`, bus events for `phrase` and `phrase-receipt`, and
  `leave` carrying its `gen`.
- **`client/main.js`:** the systems are registered, and `EW.drums` is exposed for probes.

## What is proven

| test | base = commit 4 `957ca71` | candidate |
|---|---|---|
| `tools/drum-client-test.ts` (shared logic, no browser) | **red**: `drumsynth.js` is absent | **23/0** |

It covers:
- **The noise contract:** 48k frames, deterministic, in range, zero-centred.
- **The synced step choice:** the press at T + 10,050 gives step 62; during the handover the
  same press still picks the outgoing grid; the press at T + 53,250 gives gen 3 step 1.
- **The deadlines:** T + 11,333.33 when synced; press + 1,316.67 ms when unsynced.
- **The struck window:** it says "struck/queued over the observed bars" and never "heard";
  it announces the count-in and a scheduled change; it states an absent initiator plainly
  (carry note 7).
- **The kit:** both drums are valid bags, the noise stays dark, and the kit is labelled
  provisional.

**Regressions:**
- #201's `sound-clock` (13/0) and `sound-guard` (11/0), which load the real `sounds.js`, so
  the world-bus extraction holds at the module level.
- circle 61/0, phrase 37/0, hydration 30/0, tag 11/0, and phrase-live 29/0.

## ✅ The real-browser probe runs (commit `64c69a8`, 2026-10-06)

**The blocker was Bun, not the host.** On Windows, Bun's `child_process` does not carry
Playwright's pipe transport (stdio 3 and 4), so every launch hung at the handshake: Chrome
or Edge, headless or headful. Node drives the browser now (`node tools/drum-probe.ts`,
with `BUN_PATH` for the scratch sequencer). The "GPU crash" below was the same hang in
disguise, and its workaround (`--disable-gpu`) skewed the clock, as measured below.

| receipt | what | result |
|---|---|---|
| `candidate-drum-probe.txt` | the probe @ `64c69a8`, real Chrome, GPU on | **17/0** |
| `base-red-drum-probe.txt` | the same probe on `957ca71` (+ the kit's data) | **red** at the first claim: no `worldbus.js` |
| `mutants-browser.txt` | 7 browser mutants, served to the pages by request interception (never on disk) | **7/7 killed**, control green |
| `clock-diag-gpu.txt` | `serverNow()` − the server's clock, one machine | median **−4 ms**, worst −9 ms |
| `clock-diag-software-gl.txt` | the same, with `--disable-gpu` | median **−159 ms**, worst **−1000 ms** |

Claimed now: **A5** (one bus, silent at 0, heard at 1), **A10** (heard once, locally; shared
and played by the other page; "local only" with the count-in reason; "sharing unknown"
after a dropped send and retry; the own-author guard exercised directly, with a control),
**A6** (≤ 4 voices during the 32nd roll, oldest stolen), **A3's clock half** (a page 400 ms
fast reads the server within 7 ms once synced), **A8** (a removed drum, and
`clearInstruments()`, leave nothing behind).

Two honest limits: a world reset tears down by RELOADING the page (`net.js`); no
`world-reset` bus event is ever emitted, so the probe drives `clearInstruments()` directly.
And "hears once" is counted at the call site, not measured by onsets. The clock table is
evidence for the clock's owners: a one-way estimate inherits a starved page's stalls.

*The section below is the 10-06 morning record, kept as it was.*

## What is NOT yet proven: the real-browser probe is BLOCKED by this host

`tools/drum-probe.ts` is written. It covers:
- **A5:** an analyser on the one bus, silent at world volume 0;
- **A10:** the hitter hears once, the hit is shared, a count-in refusal reads "local only",
  and a dropped send plus its retry ends "sharing unknown";
- **A6:** polyphony during a planned 32nd-note roll at 180 BPM;
- **A3, the clock half:** a second page with a machine clock 400 ms fast;
- **A8:** teardown.

**It cannot run here.** On this host, a headless launch of the installed Chrome or Edge,
through the repo's pinned Playwright 1.62.1, times out at the launch handshake. That happens
inside and outside the shell sandbox, and with and without GPU flags
(`drum-probe-BLOCKED.txt`). An earlier launch through a mismatched global Playwright 1.63
got further, then crashed the GPU process.

**So A5, A6, A8, A10 and A3's clock half are NOT claimed.** They are owed before the
packet, from a host where a headless browser launches.

**No mutants for this commit yet,** for the same reason: the browser-side seams need the
probe to turn red.

The probe also counts a thrown exception as a failure. Its first run caught it reporting a
silent "0 passed, 0 failed".
