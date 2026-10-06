// circle-tag-test — the drum circle's one MCPL tag, read the way a HOST reads
// it: through the advertised feature set's tag ontology (design rev 5, §5;
// Mica's seam 6, "the dedicated ambient tag is part of rung zero").
//
//   bun tools/circle-tag-test.ts
//
// Declaration only: this commit adds the tag and its suggested treatment.
// The line that carries it is emitted by the mcpl phrase path, later.
import { EIDO, FEATURE_SETS, MCPL_ADVERTISEMENT } from "../mcpl/declaration.ts";
import { manifestRevision, MANIFEST_WITH_REVISION } from "../mcpl/manifest.ts";

let passed = 0, failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const onto: any = (FEATURE_SETS["eidoverse.world"] as any).tagOntology;
const tag = (EIDO as any).circle;
check("the tag is eidoverse:circle", tag === "eidoverse:circle", String(tag));
const decl = onto?.tags?.[tag];
check("the world feature set's ontology declares it", !!decl, JSON.stringify(Object.keys(onto?.tags ?? {})));
check("…as a lifecycle event, never addressing", decl?.facet === "lifecycle" && !decl?.implies, JSON.stringify(decl));
check("…whose description promises one line per circle per quiet window, never one per phrase or bar",
  /per circle per quiet window/.test(decl?.desc ?? "") && /NEVER one per phrase or bar/.test(decl?.desc ?? ""));
check("…and says what was struck lives in look(), never what was heard",
  /look\(\)/.test(decl?.desc ?? "") && /never what was heard/.test(decl?.desc ?? ""));
const rules = (onto?.suggestedTreatment ?? []).filter((r: any) => (r.tagsAny ?? []).includes(tag));
check("one suggested treatment names it", rules.length === 1, JSON.stringify(rules));
check("…and it only QUIETS: a 300 s throttle, like the activity digest",
  rules[0]?.behavior?.throttle?.perMs === 300_000, JSON.stringify(rules[0]));
check("no suggested rule anywhere wakes (no `immediate`)", !JSON.stringify(onto?.suggestedTreatment ?? []).includes("immediate"));
check("the deprecated alias carries the same list", JSON.stringify(onto?.defaultTreatment) === JSON.stringify(onto?.suggestedTreatment));
check("the advertisement carries the feature set", (MCPL_ADVERTISEMENT as any).featureSets["eidoverse.world"].tagOntology === onto);
const rev = manifestRevision(MANIFEST_WITH_REVISION);
check("the manifest's own revision is self-consistent with the new tag", rev === (MANIFEST_WITH_REVISION as any).revision, `${rev} vs ${(MANIFEST_WITH_REVISION as any).revision}`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
