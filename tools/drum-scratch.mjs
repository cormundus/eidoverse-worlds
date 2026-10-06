// drum-scratch — the OWNED scratch surface for the drum circle's rung zero.
//
//   bun tools/drum-scratch.mjs [--label NAME] -- <command …>
//
// Spawns a sequencer this run owns, proves the responder is ITS child, runs
// <command> with WORLD_URL / ORIGIN / JOIN_TOKEN pointing at it, then tears it
// down and PROVES the teardown. Every run leaves a receipt (receipt.json in
// its scratch directory, and printed on stdout) naming the world, port, child
// PID, nonce, start and end times, the child's exit, and a port-closed probe.
// That is the receipt shape the local implementation standing asks for
// (Mica, 2026-10-05: "own and tear down the scratch surface").
//
// How it differs from tools/probe-harness.mjs ownedWorld(), deliberately:
//  - the child's environment is an ALLOW-LIST, not `...process.env`, so no
//    ambient secret (HN_*, WORLD_ADMIN, SFU_*, a real JOIN_TOKEN) can reach it;
//  - the agent-credential roster is a FAKE fixture written into the scratch
//    directory (AGENT_TOKENS_PATH), never the checkout's real mcpl/tokens.json;
//  - WORLDS_DIR, OPT_DIR and EIDOVERSE_DIR all point INSIDE the scratch
//    directory (the library is an empty scratch dir unless --library is
//    passed), so no derived variant, store write, client log or incarnation
//    file can land in a checkout someone serves from;
//  - the scratch world is PRESERVED as a test artifact and never deleted (it
//    lives outside the repo, under DRUM_SCRATCH_ROOT);
//  - it needs no browser, so it does not import playwright.
// The identity check is the same nonce echo as proveOwned() (routes.ts echoes
// EIDO_BOOT_NONCE on /version); it is restated here only because importing
// probe-harness pulls in playwright at module load.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';

const ROOT = resolve(import.meta.dir ?? new URL('.', import.meta.url).pathname, '..');
const SCRATCH_ROOT = resolve(process.env.DRUM_SCRATCH_ROOT ?? join(ROOT, '..', 'eidoverse-instruments', 'scratch'));

// Only what a Bun child needs to start on Windows / macOS / Linux.
const ENV_ALLOW = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'TEMP', 'TMP', 'TMPDIR',
  'COMSPEC', 'ComSpec', 'PATHEXT', 'SYSTEMDRIVE', 'SystemDrive', 'HOMEDRIVE', 'HOMEPATH', 'USERPROFILE',
  'HOME', 'LOCALAPPDATA', 'APPDATA', 'LANG'];

function portClosed(port) {
  return new Promise((res) => {
    const s = connect({ host: '127.0.0.1', port });
    s.once('connect', () => { s.destroy(); res(false); });
    s.once('error', (e) => res(e.code === 'ECONNREFUSED' ? true : `probe error ${e.code}`));
    s.setTimeout(1500, () => { s.destroy(); res('probe timeout'); });
  });
}

async function proveOwned(origin, nonce, alive, attempts = 120) {
  for (let i = 0; i < attempts; i++) {
    const a = alive();
    if (a !== true) return { ours: false, reason: String(a) };
    try {
      const v = await (await fetch(`${origin}/version`, { signal: AbortSignal.timeout(1000) })).json();
      if (v.nonce === undefined) return { ours: false, reason: 'responder has no nonce field (stale listener)' };
      return v.nonce === nonce ? { ours: true, reason: 'nonce echoed' } : { ours: false, reason: 'wrong nonce (not our child)' };
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { ours: false, reason: 'never answered' };
}

/** Start an owned scratch sequencer. Resolves { origin, wsUrl, token, port,
 *  nonce, dir, pid, stop() }; stop() resolves the teardown receipt. */
export async function scratchWorld({ label = 'drum', library = null, env: extraEnv = {} } = {}) {
  const nonce = randomUUID();
  const startedAt = new Date().toISOString();
  const dir = join(SCRATCH_ROOT, `${startedAt.replace(/[:.]/g, '-')}-${label}-${nonce.slice(0, 8)}`);
  for (const d of ['worlds', 'opt', 'library']) mkdirSync(join(dir, d), { recursive: true });
  // A FAKE agent-credential fixture, owned by this run (server/auth.ts's
  // AGENT_TOKENS_PATH seam, "a self-contained test can own its credential
  // fixture … without mutating the checkout"). permtest's reserved-name cases
  // expect "dev-token" → claude. It lives in the scratch dir, never in the
  // repo, and is not a real credential.
  const agentTokens = join(dir, 'agent-tokens.json');
  writeFileSync(agentTokens, JSON.stringify({ 'dev-token': { id: 'claude' } }, null, 2) + '\n');
  const port = 20000 + Math.floor(Math.random() * 10000);
  const token = `scratch-${nonce.slice(0, 12)}`;
  const env = {};
  for (const k of ENV_ALLOW) if (process.env[k] !== undefined) env[k] = process.env[k];
  Object.assign(env, {
    PORT: String(port), JOIN_TOKEN: token, SKIP_OPT_SWEEP: '1',
    WORLDS_DIR: join(dir, 'worlds'), OPT_DIR: join(dir, 'opt'),
    EIDOVERSE_DIR: library ? resolve(library) : join(dir, 'library'),
    AGENT_TOKENS_PATH: agentTokens,
    EIDO_BOOT_NONCE: nonce, WORLD_INSTANCE_NONCE: nonce, ...extraEnv,
  });
  const bun = process.execPath.includes('bun') ? process.execPath : (process.env.BUN_PATH || 'bun');
  // A mutation run (tools/drum-mutants.mjs): the SERVER loads the mutant in
  // memory through the preload; nothing on disk changes.
  const mutant = process.env.DRUM_MUTANT;
  if (mutant) env.DRUM_MUTANT = mutant;
  const serverArgs = mutant ? ['--preload', join(ROOT, 'tools', 'drum-mutant-preload.mjs'), 'server/server.ts'] : ['server/server.ts'];
  const child = spawn(bun, serverArgs, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const logChunks = [];
  child.stdout.on('data', (b) => logChunks.push(b)); child.stderr.on('data', (b) => logChunks.push(b));
  let exit = null;
  const exited = new Promise((r) => child.once('exit', (code, signal) => { exit = { code, signal }; r(); }));
  const origin = `http://127.0.0.1:${port}`;
  const identity = await proveOwned(origin, nonce, () => (exit ? `exited ${JSON.stringify(exit)}` : true));

  const stop = async () => {
    if (!exit) { try { child.kill('SIGTERM'); } catch { /* gone */ } }
    await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    if (!exit) { try { child.kill('SIGKILL'); } catch { /* gone */ } await exited; }
    const closed = await portClosed(port);
    const receipt = {
      label, world: env.WORLDS_DIR, scratchDir: dir, port, origin, pid: child.pid, nonce, mutant: mutant ?? null,
      startedAt, endedAt: new Date().toISOString(), identity,
      childExited: exit !== null, exit, portClosed: closed === true, portProbe: closed,
      scratchWorld: 'preserved as a test artifact (never deleted by this harness)',
      library: env.EIDOVERSE_DIR, envKeys: Object.keys(env).sort(),
    };
    writeFileSync(join(dir, 'server.log'), Buffer.concat(logChunks));
    // Receipts get committed and pushed: name places by role, never by the
    // machine's home path (no username, nothing name-like, leaves this host).
    const pub = JSON.parse(JSON.stringify(receipt, (k, v) => typeof v !== 'string' ? v
      : v.split(SCRATCH_ROOT).join('$DRUM_SCRATCH_ROOT').split(ROOT).join('$REPO')
        .split(library ? resolve(library) : '\u0000').join('$LIBRARY')));   // the asset library, by role too
    writeFileSync(join(dir, 'receipt.json'), JSON.stringify(pub, null, 2) + '\n');
    return pub;
  };
  if (!identity.ours) { const r = await stop(); throw new Error(`scratch world never came up as OURS (${identity.reason}); receipt: ${JSON.stringify(r)}`); }
  return { origin, wsUrl: `ws://127.0.0.1:${port}/ws`, token, port, nonce, dir, pid: child.pid, stop };
}

// ---- CLI: wrap one command in an owned scratch world ---------------------
if (import.meta.main) {
  const argv = process.argv.slice(2);
  const sep = argv.indexOf('--');
  const opts = argv.slice(0, sep < 0 ? argv.length : sep), cmd = sep < 0 ? [] : argv.slice(sep + 1);
  const label = opts.includes('--label') ? opts[opts.indexOf('--label') + 1] : 'drum';
  const library = opts.includes('--library') ? opts[opts.indexOf('--library') + 1] : null;
  // --env K=V (repeatable): a server knob a test's recipe asks for
  // (behaviortest: BHV_TIMER_MIN=1; compfold-test: FOLD_EVERY=1)
  const env = {};
  opts.forEach((o, i) => { if (o === '--env') { const [k, ...v] = String(opts[i + 1] ?? '').split('='); if (k) env[k] = v.join('='); } });
  const w = await scratchWorld({ label, library, env });
  console.log(`[drum-scratch] owned world up: ${w.origin} pid=${w.pid} nonce=${w.nonce} dir=${w.dir.split(SCRATCH_ROOT).join('$DRUM_SCRATCH_ROOT')}`);
  let code = 0;
  if (cmd.length) {
    const run = spawn(cmd[0], cmd.slice(1), { cwd: ROOT, stdio: 'inherit',
      env: { ...process.env, WORLD_URL: w.wsUrl, ORIGIN: w.origin, JOIN_TOKEN: w.token } });
    code = await new Promise((r) => run.once('exit', (c) => r(c ?? 1)));
  }
  const receipt = await w.stop();
  console.log(`[drum-scratch] receipt ${JSON.stringify(receipt, null, 2)}`);
  if (!receipt.childExited || !receipt.portClosed) { console.error('[drum-scratch] TEARDOWN NOT PROVEN'); process.exit(2); }
  process.exit(code);
}
