// drum-probe — the drum circle in a REAL browser (design rev 5 §4.6, §7;
// acceptance A5, A6, A8, A10, and the clock half of A3), against an owned
// scratch sequencer. Two pages: the hitter, and a second player whose clock
// is forced 400 ms fast.
//
//   SFU_TEST_CHROME=<chrome or edge> bun tools/drum-probe.ts
//
// Uses the repo's pinned playwright (a global one of another version hangs the
// launch handshake). The library is the asset checkout, READ-ONLY, so drum
// entities have bodies (EIDOVERSE_DIR, default ../eidoverse-video).
import { chromium } from "playwright";
import { scratchWorld } from "./drum-scratch.mjs";
import { HAND_DRUM, LOW_DRUM } from "../shared/drumkit.js";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const w = await scratchWorld({ label: "drum-probe", library: process.env.EIDOVERSE_DIR ?? "../eidoverse-video" });
let browser: any = null;
try {
  browser = await chromium.launch({ executablePath: process.env.SFU_TEST_CHROME, timeout: 90_000,
    args: ["--autoplay-policy=no-user-gesture-required", "--disable-gpu"] });
  const W = `drumprobe-${Math.random().toString(36).slice(2, 7)}`;
  const page = async (name: string, skewMs = 0) => {
    const ctx = await browser.newContext();
    if (skewMs) await ctx.addInitScript((s: number) => {   // a machine whose clock is wrong by s ms
      const pn = performance.now.bind(performance), dn = Date.now;
      performance.now = () => pn() + s; Date.now = () => dn() + s;
    }, skewMs);
    const p = await ctx.newPage();
    await p.goto(`${w.origin}/?world=${W}&key=${w.token}&name=${name}`, { waitUntil: "domcontentloaded" });
    await p.waitForFunction(() => (globalThis as any).EW?.net?.joined === true, null, { timeout: 60_000 });
    await p.evaluate(async () => { const { audioContext } = await import("/lib/audioctx.js"); await audioContext().resume(); });
    return p;
  };
  const verb = (p: any, v: string, a: any) => p.evaluate(([v, a]: any) => import("/lib/net.js").then((n: any) => n.sendVerb(v, a)), [v, a]);
  const D = (p: any, fn: string) => p.evaluate(fn);

  console.log(`\nthe drum circle in a real browser — world "${W}"\n`);
  const adam = await page("adam");
  for (const [id, x] of [["drums", 0], ["hand", 1], ["low", -1], ["fast", 3], ["fasthand", 4], ["drum3", 6], ["hand3", 7]] as const)
    await verb(adam, "spawn", { id, lib: "eidoverse/assets/models/crate_large_red.glb", pos: [x, 0, -2] });
  await sleep(400);
  await verb(adam, "circle-set", { id: "drums", op: "start", bpm: 120, meter: 4, subdivision: 2, countIn: 1 });
  await verb(adam, "instrument-set", { id: "hand", circle: "drums", ...HAND_DRUM });
  await verb(adam, "instrument-set", { id: "low", circle: "drums", ...LOW_DRUM });
  await sleep(2700);   // a bar of grace + the count-in bar (120 BPM 4/4 → 2,000 ms bars)
  const bea = await page("bea", 400);

  console.log("1. the world bus (A5): one owner, one path, volume 0 is silent");
  const a5 = await D(adam, `(async () => {
    const wb = await import('/lib/worldbus.js'); const snd = await import('/lib/sounds.js');
    const { audioContext } = await import('/lib/audioctx.js'); const vc = await import('/lib/voiceconsent.js');
    const ctx = audioContext(); const bus = wb.worldGain();
    const an = ctx.createAnalyser(); an.fftSize = 2048; bus.connect(an);
    const rms = async (ms) => { const buf = new Float32Array(an.fftSize); let peak = 0; const t = performance.now();
      while (performance.now() - t < ms) { an.getFloatTimeDomainData(buf); for (const v of buf) peak = Math.max(peak, Math.abs(v)); await new Promise(r => setTimeout(r, 15)); } return peak; };
    vc.setVolume('world', 0); EW.drums.press('hand', 'B'); const silent = await rms(300);
    vc.setVolume('world', 1); EW.drums.press('hand', 'B'); const loud = await rms(300);
    bus.disconnect(an);
    return { same: snd._worldBus() === bus, silent, loud };
  })()`);
  check("sounds.js and instruments.js share ONE bus (the same node)", a5.same, JSON.stringify(a5));
  check("at world volume 0 the bus carries no signal (analyser peak 0)", a5.silent === 0, String(a5.silent));
  check("at world volume 1 the same strike is heard (peak > 0.01)", a5.loud > 0.01, String(a5.loud));

  console.log("\n2. sender realization and the hitter's states (A10)");
  await sleep(2500);   // let A5's two hits settle
  const before = await D(adam, "({ ...EW.drums.stats })");
  const n = await D(adam, "EW.drums.press('hand', 'T')");
  await sleep(1500);
  const after = await D(adam, "({ ...EW.drums.stats, hit: EW.drums.hits.get(" + n + ") })");
  check("the hitter hears the hit once, locally", after.local === before.local + 1, JSON.stringify(after));
  check("…and never again from the shared copy (nothing more played on this page)", after.played === before.played, `${before.played} → ${after.played}`);
  check("the hit is SHARED, labelled with the hitter's own measurement", after.hit?.state === "shared" && /your own measurement/.test(after.hit?.label), JSON.stringify(after.hit));
  const heard = await D(bea, "({ ...EW.drums.stats })");
  check("bea (the other page) played the shared copy", heard.played >= 1, JSON.stringify(heard));
  await verb(bea, "circle-set", { id: "drum3", op: "start", bpm: 60, meter: 4, subdivision: 1, countIn: 4 });
  await verb(bea, "instrument-set", { id: "hand3", circle: "drum3", ...HAND_DRUM });
  await sleep(600);
  const n3 = await D(adam, "EW.drums.press('hand3', 'S')");
  await sleep(1200);
  const h3 = await D(adam, `EW.drums.hits.get(${n3})`);
  check("a refused hit (inside bea's count-in) reads 'local only — not shared: count-in…'", h3?.state === "local" && /^local only — not shared: count-in/.test(h3?.label), JSON.stringify(h3));
  const nDrop = await D(adam, `(() => { const ws = EW.net.ws; const send = ws.send.bind(ws); let dropped = 0;
    ws.send = (d) => { if (dropped < 2 && String(d).includes('"phrase"')) { dropped++; return; } return send(d); };
    return EW.drums.press('hand', 'B'); })()`);
  await sleep(4500);
  const hd = await D(adam, `EW.drums.hits.get(${nDrop})`);
  check("a hit whose send AND same-n retry are dropped ends 'sharing unknown' — never shared, never twice",
    hd?.state === "unknown" && hd?.label === "sharing unknown" && hd?.retried === true, JSON.stringify(hd));

  console.log("\n3. bounded polyphony (A6): a planned 32nd-note roll at 180 BPM");
  await verb(adam, "circle-set", { id: "fast", op: "start", bpm: 180, meter: 4, subdivision: 8, countIn: 1 });
  await verb(adam, "instrument-set", { id: "fasthand", circle: "fast", ...HAND_DRUM, polyphony: 4 });
  await sleep(1300);   // grace bar (1,333 ms) — adam is the initiator, so the count-in is his
  const sent = await D(adam, `(async () => { const s = EW.drums.stats; s.stolen = 0; const c = EW.myState?.() ?? null;
    const st = (await import('/lib/state.js')).state.st; const circ = st.entities.fast.comp.circle; const inst = st.entities.fasthand.comp.instrument;
    (await import('/lib/net.js')).sendPhrase({ circle: 'fast', gen: circ.gen, voice: 'fasthand', voiceGen: inst.voiceGen, bar: 'next', pattern: 'B'.repeat(32), n: 9000 });
    return true; })()`);
  await sleep(3500);
  const pv = await D(bea, "({ peak: EW.drums.stats.peakVoices.fasthand, stolen: EW.drums.stats.stolen })");
  check("bea never exceeds the drum's polyphony (4) during the roll", sent && pv.peak !== undefined && pv.peak <= 4, JSON.stringify(pv));
  check("…because the oldest voices were stolen", pv.stolen > 0, JSON.stringify(pv));

  console.log("\n4. the clock under a skewed machine (A3, the clock half)");
  const skew = async (p: any) => { const t0 = Date.now(); const s = await D(p, "(async () => ({ now: (await import('/lib/remotes.js')).serverNow(), synced: (await import('/lib/remotes.js')).clockSynced(), local: Date.now() }))()"); const t1 = Date.now(); return { err: s.now - (t0 + t1) / 2, synced: s.synced, localSkew: s.local - (t0 + t1) / 2, rtt: t1 - t0 }; };
  for (let i = 0; i < 6; i++) { await D(bea, "EW.me()?.position?.x !== undefined"); await sleep(200); }
  const ka = await skew(adam), kb = await skew(bea);
  console.log(`    adam: serverNow error ${ka.err.toFixed(1)} ms (synced ${ka.synced}); bea: local clock +${kb.localSkew.toFixed(0)} ms, serverNow error ${kb.err.toFixed(1)} ms (synced ${kb.synced})`);
  check("bea's machine clock really is ~400 ms fast", Math.abs(kb.localSkew - 400) < 60, String(kb.localSkew));
  check("once synced, a skewed machine's serverNow agrees with the server's clock within 50 ms (unsynced is reported, not hidden)",
    !kb.synced || Math.abs(kb.err) < 50, JSON.stringify(kb));

  console.log("\n5. teardown (A8)");
  await verb(adam, "circle-set", { id: "drums", op: "end" });
  await verb(adam, "remove", { id: "fasthand" });
  await sleep(800);
  const td = await D(bea, "({ q: EW.drums.queue.length, panners: [...EW.drums.panners.keys()], voices: [...EW.drums.voices.keys()] })");
  check("removing a drum drops its voices and its panner", !td.panners.includes("fasthand") && !td.voices.includes("fasthand"), JSON.stringify(td));
  await D(bea, "EW.drums.clearInstruments()");
  const td2 = await D(bea, "({ q: EW.drums.queue.length, p: EW.drums.panners.size, v: EW.drums.voices.size })");
  check("a full clear (the world-reset path) leaves no queue, voices or panners", td2.q === 0 && td2.p === 0 && td2.v === 0, JSON.stringify(td2));
} catch (err) {
  // an exception is a FAILURE, never a silent 0/0 (the first run proved the point)
  failed++;
  console.log(`  ✗ the probe threw — ${String((err as any)?.message ?? err).split("\n")[0]}`);
} finally {
  if (browser) await browser.close();
  const r = await w.stop();
  console.log(`\n[drum-scratch] receipt ${JSON.stringify({ port: r.port, pid: r.pid, nonce: r.nonce, startedAt: r.startedAt, endedAt: r.endedAt, childExited: r.childExited, portClosed: r.portClosed, library: r.library })}`);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
