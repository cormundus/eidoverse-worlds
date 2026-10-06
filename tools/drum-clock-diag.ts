// drum-clock-diag — how wrong is a page's serverNow(), and why? (design rev 5
// §3, acceptance A3; Mica's ruling: serverNow() is acceptable for rung zero
// only if MEASURED). One unskewed page on the same machine as an owned scratch
// sequencer, so the server's clock IS this process's Date.now(), and the
// page's error is simply serverNow() − Date.now(). Alongside it, the longest
// main-thread gap (a starved page handles frames late, and a one-way offset
// estimate inherits the lateness as error).
//
//   BUN_PATH=<bun> SFU_TEST_CHROME=<chrome> node tools/drum-clock-diag.ts [--gpu] [--lite]
//
// Node, not Bun, drives the browser: on Windows, Bun's child_process does not
// carry Playwright's pipe transport (stdio 3/4), and every launch times out.
import { chromium } from "playwright";
import { scratchWorld } from "./drum-scratch.mjs";

const gpu = process.argv.includes("--gpu"), lite = process.argv.includes("--lite");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const w = await scratchWorld({ label: "drum-clock-diag", library: process.env.EIDOVERSE_DIR ?? "../eidoverse-video" });
let browser: any = null;
try {
  browser = await chromium.launch({ executablePath: process.env.SFU_TEST_CHROME, timeout: 90_000,
    args: ["--autoplay-policy=no-user-gesture-required", ...(gpu ? [] : ["--disable-gpu"])] });
  const W = `drumclock-${Math.random().toString(36).slice(2, 7)}`;
  const p = await (await browser.newContext()).newPage();
  await p.goto(`${w.origin}/${lite ? "lite.html" : ""}?world=${W}&key=${w.token}&name=clock`, { waitUntil: "domcontentloaded" });
  await p.waitForFunction(() => (globalThis as any).EW?.net?.joined === true, null, { timeout: 60_000 });
  // something must move, or no frame carries the server's time
  await p.evaluate(() => import("/lib/net.js").then((n: any) => n.sendVerb("spawn", { id: "c", lib: "eidoverse/assets/models/crate_large_red.glb", pos: [0, 0, -2] })));
  await p.evaluate(() => {
    const g = globalThis as any; g.__gap = 0; let last = performance.now();
    const tick = () => { const t = performance.now(); g.__gap = Math.max(g.__gap, t - last); last = t; setTimeout(tick, 0); };
    tick();
  });
  console.log(`mode: ${lite ? "lite" : "full"}, ${gpu ? "gpu" : "--disable-gpu"}`);
  const rows: number[] = [];
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    const s = await p.evaluate(async () => {
      const g = globalThis as any; const r = await import(g.EW?.lite ? "/lib/participants_lite.js" : "/lib/remotes.js");
      const gap = g.__gap; g.__gap = 0;
      return { synced: r.clockSynced(), now: r.serverNow(), gap };
    });
    const err = s.now - Date.now();   // node's clock = the server's clock (same machine)
    if (s.synced) rows.push(err);
    console.log(`  t+${((i + 1) * 0.5).toFixed(1)}s  synced=${s.synced}  serverNow−server ≈ ${err.toFixed(0)} ms  longest main-thread gap ${s.gap.toFixed(0)} ms`);
  }
  if (rows.length) {
    const sorted = [...rows].sort((a, b) => a - b);
    console.log(`\nsynced samples ${rows.length}: min ${sorted[0].toFixed(0)}  median ${sorted[sorted.length >> 1].toFixed(0)}  max ${sorted[sorted.length - 1].toFixed(0)} ms`);
  }
} finally {
  await browser?.close();
  console.log("[drum-clock-diag] receipt", JSON.stringify(await w.stop()));
}
