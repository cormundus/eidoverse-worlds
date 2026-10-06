// drum-mutant-preload — applies ONE mutant (tools/drum-mutants.mjs) to a
// module IN MEMORY as Bun loads it. Nothing on disk changes: the mutant is a
// string swap inside this process only, so a mutation run can never leave
// the checkout mutated, however it ends.
//
//   DRUM_MUTANT=<id> bun --preload ./tools/drum-mutant-preload.mjs <entry>
//
// tools/drum-scratch.mjs adds the --preload to its server child when
// DRUM_MUTANT is set, so a live test's SERVER runs the mutant too.
import { plugin } from 'bun';
import { MUTANTS } from './drum-mutants-table.mjs';

const id = process.env.DRUM_MUTANT;
const m = id && id !== 'none' ? MUTANTS.find((x) => x.id === id) : null;
if (id && id !== 'none' && !m) throw new Error(`[drum-mutant] unknown mutant "${id}"`);
if (m) {
  const esc = m.file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '[\\\\/]');
  plugin({
    name: `drum-mutant-${m.id}`,
    setup(build) {
      build.onLoad({ filter: new RegExp(`${esc}$`) }, async (args) => {
        const src = await Bun.file(args.path).text();
        const hits = src.split(m.find).length - 1;
        if (hits !== 1) throw new Error(`[drum-mutant] ${m.id}: expected exactly one match in ${m.file}, found ${hits} (stale mutant)`);
        return { contents: src.replace(m.find, m.replace), loader: m.file.endsWith('.ts') ? 'ts' : 'js' };
      });
    },
  });
}
