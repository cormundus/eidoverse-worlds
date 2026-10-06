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

function runTest(test, mutant) {
  const env = { ...process.env, DRUM_MUTANT: mutant };
  const cmd = test === 'circle'
    ? [BUN, ['--preload', PRELOAD, 'tools/circle-test.ts']]
    : [BUN, ['tools/drum-scratch.mjs', '--label', `mut-${mutant}-${test}`, '--',
        BUN, test === 'live' ? 'tools/circle-live-test.ts' : 'tools/comptest.ts']];
  const r = spawnSync(cmd[0], cmd[1], { cwd: ROOT, env, encoding: 'utf8', timeout: 300_000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const red = out.split('\n').filter((l) => l.includes('✗')).map((l) => l.trim());
  const summary = (out.match(/\d+ passed, \d+ failed/g) ?? []).pop() ?? `no summary (exit ${r.status})`;
  const torn = test === 'circle' ? true : /"childExited": true/.test(out) && /"portClosed": true/.test(out);
  return { status: r.status, red, summary, torn, stale: /stale mutant/.test(out) };
}

let ok = true;
console.log('\ncontrol (preload active, no mutant):');
for (const t of ['circle', 'live', 'comptest']) {
  const r = runTest(t, 'none');
  const green = r.status === 0 && r.red.length === 0 && r.torn;
  if (!green) ok = false;
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
console.log(`\n${rows.filter((r) => r.killed).length}/${rows.length} mutants killed; control ${ok ? 'green' : 'see above'}`);
process.exit(ok ? 0 : 1);
