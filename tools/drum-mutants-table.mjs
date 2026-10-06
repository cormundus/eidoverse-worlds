// drum-mutants-table — one mutant per load-bearing seam of the drum circle's
// protocol amendment. Each mutant is an exact, single-match string swap in one
// file (applied IN MEMORY by tools/drum-mutant-preload.mjs — never on disk),
// the test that owns the seam, and the check(s) that must go red. A mutant
// whose `find` no longer matches exactly once is refused as STALE, so a
// refactor cannot quietly turn a seam test into a no-op.
//
// `tests`: 'circle' = tools/circle-test.ts (pure); 'live' =
// tools/circle-live-test.ts and 'comptest' = tools/comptest.ts, each in an
// owned scratch world whose SERVER runs the mutant.
export const MUTANTS = [
  { id: 'emit-gate-open', seam: 'script emits may not write circle-set/instrument-set (§2.6)',
    file: 'server/server.ts', find: 'if (verb === "circle-set" || verb === "instrument-set") {', replace: 'if (false) {',
    tests: ['live'], expectRed: ['the emit is refused by name'] },
  { id: 'guard-list-off', seam: 'the two verbs are in GUARD_AUTHORED (§2.1)',
    file: 'server/rights.ts', find: '"circle-set", "instrument-set"]);', replace: ']);',
    tests: ['live'], expectRed: ['GUARDED drum'] },
  { id: 'vcomp-door-open', seam: 'vComp refuses comp of a protected type (one writer path)',
    file: 'server/verbs.ts', find: 'if ((PROTECTED_COMPS as readonly string[]).includes(type)) {', replace: 'if (false) {',
    tests: ['live', 'comptest'], expectRed: ['comp of type circle is refused', 'comp cannot write a circle'] },
  { id: 'fold-comp-open', seam: 'the fold refuses comp of a protected type',
    file: 'shared/fold.js', find: 'if (PROTECTED_COMPS.includes(a.type)) return;', replace: '',
    tests: ['circle'], expectRed: ['a plain comp of type circle folds to nothing'] },
  { id: 'fold-start-successor', seam: 'a start folds only as the exact successor generation',
    file: 'shared/circle.js', find: 'if (running || gen !== priorGen + 1) return undefined;', replace: 'if (running) return undefined;',
    tests: ['circle'], expectRed: ['a start with a non-successor gen folds to nothing', 'a restart stamped gen 1'] },
  { id: 'gen-resets', seam: 'generations never reset on an entity (§2.5, the stale-dup fix)',
    file: 'shared/circle.js', find: 'const gen = (folded && Number.isInteger(folded.gen) ? folded.gen : 0) + 1;', replace: 'const gen = 1;',
    tests: ['circle', 'live'], expectRed: ['continues the generation', 'gen 3, never 1'] },
  { id: 'lead-floor-off', seam: 'a tempo change needs at least H bars of lead (§2.1)',
    file: 'shared/circle.js', find: 'if (lead < policy.H_BARS) return', replace: 'if (false) return',
    tests: ['circle', 'live'], expectRed: ['lead 15'] },
  { id: 'initiator-rule-off', seam: 'only the initiator, owner or an operator may change or end (§2.1)',
    file: 'shared/circle.js', find: 'if (!mayRetime) {', replace: 'if (false) {',
    tests: ['circle', 'live'], expectRed: ['non-initiator', 'not the initiator'] },
  { id: 'pending-rule-off', seam: 'one pending change at a time; no change before the start (§2.1)',
    file: 'shared/circle.js', find: 'if (now < folded.t0) {', replace: 'if (false) {',
    tests: ['circle', 'live'], expectRed: ['second change while one is pending', 'before the circle has started'] },
  { id: 'fold-voicegen-successor', seam: 'an instrument edit folds only as voiceGen + 1 (§2.2)',
    file: 'shared/circle.js', find: 'if (vg !== prior + 1) return undefined;', replace: '',
    tests: ['circle'], expectRed: ['non-successor voiceGen folds to nothing'] },
  { id: 'synth-open', seam: 'an unknown synth fails closed (§2.2)',
    file: 'shared/circle.js', find: 'if (!KNOWN_SYNTHS.includes(a.synth)) return', replace: 'if (false) return',
    tests: ['circle', 'live'], expectRed: ['unknown synth'] },
];
