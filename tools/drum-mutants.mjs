// drum-mutants — the mutation-red receipts for the drum circle (Mica's method:
// base-red → candidate-green → mutation-red at the seam each test guards).
//
//   bun tools/drum-mutants.mjs [mutant-id …]      (all mutants when none named)
//
// First a CONTROL run with the preload active and no mutant (DRUM_MUTANT=none):
// every test must be green, proving the preload itself changes nothing. Then
// each mutant from tools/drum-mutants-table.mjs runs its owning tests; the
// mutant is KILLED only when every expected check shows ✗ in that run.
// Mutants are applied in memory (tools/drum-mutant-preload.mjs); no file on
// disk is ever modified. Prints a table and exits nonzero if any mutant
// survives or the control is not green.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MUTANTS } from './drum-mutants-table.mjs';

const ROOT = resolve(import.meta.dir, '..');
const BUN = process.execPath;
const PRELOAD = join(ROOT, 'tools', 'drum-mutant-preload.mjs');
const only = process.argv.slice(2);

const PURE = { circle: 'tools/circle-test.ts', tag: 'tools/circle-tag-test.ts', hydr: 'tools/hydration-test.ts',
  phrase: 'tools/phrase-test.ts', client: 'tools/drum-client-test.ts',
  ident: 'tools/phrase-identity-test.ts', tables: 'tools/phrase-tables-test.ts' };
const LIVE = { live: ['tools/circle-live-test.ts', []], comptest: ['tools/comptest.ts', []],
  'hydr-live': ['tools/hydration-live-test.ts', ['--env', 'FOLD_EVERY=1']],
  'phrase-live': ['tools/phrase-live-test.ts', []], mcpl: ['tools/drum-mcpl-test.ts', []],
  lifecycle: ['tools/phrase-lifecycle-live-test.ts', ['--env', 'DRUM_PHRASE_STATS=1', '--env', 'WORLD_ADMIN=admin']] };
// the browser probe: Node drives Chrome (Bun's Windows child_process cannot carry
// Playwright's pipe transport), and the probe starts its own owned world on Bun
const PROBE = 'tools/drum-probe.ts';
function runTest(test, mutant) {
  const env = { ...process.env, DRUM_MUTANT: mutant, BUN_PATH: BUN };
  const cmd = test === 'probe'
    ? ['node', ['--no-warnings', PROBE]]
    : PURE[test]
    ? [BUN, ['--preload', PRELOAD, PURE[test]]]
    // the preload goes to the TEST process as well as the server child: a
    // live test hosts client code in-process (hydration-live-test runs the
    // real WorldAgent and the browser's state.js), and a mutant there must load
    // too (found when seed-agent-off "survived" untouched by the old runner)
    : [BUN, ['tools/drum-scratch.mjs', '--label', `mut-${mutant}-${test}`, ...LIVE[test][1], '--', BUN, '--preload', PRELOAD, LIVE[test][0]]];
  const r = spawnSync(cmd[0], cmd[1], { cwd: ROOT, env, encoding: 'utf8', timeout: 300_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const red = out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());
  const summary = (out.match(/\d+ passed, \d+ failed/g) ?? []).pop() ?? `no summary (exit ${r.status})`;
  const torn = PURE[test] ? true : /"childExited":\s*true/.test(out) && /"portClosed":\s*true/.test(out);
  return { status: r.status, red, summary, torn, stale: /stale mutant/.test(out) };
}

let ok = true, controlOk = true;
console.log('\ncontrol (preload active, no mutant):');
const wanted = new Set(MUTANTS.filter((x) => !only.length || only.includes(x.id)).flatMap((x) => x.tests));
const controls = ['circle', 'tag', 'hydr', 'phrase', 'client', 'ident', 'tables', 'live', 'comptest', 'hydr-live', 'phrase-live', 'lifecycle', 'mcpl', 'probe']
  .filter((t) => !only.length || wanted.has(t));
if (controls.includes('probe') && !process.env.SFU_TEST_CHROME) {
  console.log('  ✗ probe: SFU_TEST_CHROME is not set — the browser mutants cannot run (refusing a silent skip)');
  process.exit(1);
}
for (const t of controls) {
  const r = runTest(t, 'none');
  const green = r.status === 0 && r.red.length === 0 && r.torn;
  if (!green) ok = controlOk = false;
  console.log(`  ${green ? '✓' : '✗'} ${t}: ${r.summary}${r.torn ? '' : ' (TEARDOWN NOT PROVEN)'}`);
}

console.log('\nmutants:');
const rows = [];
for (const m of MUTANTS.filter((x) => !only.length || only.includes(x.id))) {
  const src = readFileSync(join(ROOT, m.file), 'utf8');
  if (src.split(m.find).length - 1 !== 1) { ok = false; console.log(`  ✗ ${m.id}: STALE — find does not match exactly once in ${m.file}`); continue; }
  const reds = [], sums = [];
  let torn = true;
  for (const t of m.tests) {
    const r = runTest(t, m.id);
    reds.push(...r.red); sums.push(`${t} ${r.summary}`); torn &&= r.torn;
    if (r.stale) { ok = false; }
  }
  const missing = m.expectRed.filter((want) => !reds.some((l) => l.includes(want)));
  const killed = missing.length === 0;
  if (!killed || !torn) ok = false;
  rows.push({ id: m.id, killed, missing, sums, torn });
  console.log(`  ${killed ? '✓ KILLED' : '✗ SURVIVED'} ${m.id} — ${m.seam}`);
  console.log(`      ${sums.join(' · ')}${torn ? '' : ' · TEARDOWN NOT PROVEN'}`);
  for (const l of reds.filter((l) => m.expectRed.some((w) => l.includes(w)))) console.log(`      red: ${l.slice(0, 140)}`);
  if (missing.length) console.log(`      expected red but green: ${missing.join(' | ')}`);
}
console.log(`\n${rows.filter((r) => r.killed).length}/${rows.length} mutants killed; control ${controlOk ? 'green' : 'NOT green (see above)'}`);
process.exit(ok ? 0 : 1);
