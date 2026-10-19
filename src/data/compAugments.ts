import type { Catalog } from "@/engine/catalog";
import { AUGMENT_STRENGTH_BONUS, type AugmentStrength, type Comp, type CompAugments } from "./schema";

const DEFAULT_NOTE: Record<AugmentStrength, string> = {
  core: "{name} is a core augment for this comp.",
  strong: "{name} is a strong augment for this comp.",
  good: "{name} is a good augment for this comp.",
  avoid: "{name} works against this comp.",
  unplayable: "{name} makes this comp unplayable.",
};

/**
 * Gives each comp the augment modifiers listed for it in comp-augments.json,
 * or TFT Academy's picks if it has no entry yet, then the rules that match it.
 * Returns every problem found; the comps are only usable when there are none.
 * Entries for comps that no longer exist (say one left TFT Academy's tier
 * list) are returned as `unused` rather than as problems, so the daily refresh
 * does not fail on them.
 */
export function applyCompAugments(
  comps: Comp[],
  file: CompAugments,
  catalog: Catalog,
  /** Comps whose source file set augmentModifiers itself, which the shared file replaces. */
  ownLists: string[] = [],
): { comps: Comp[]; problems: string[]; unused: string[] } {
  const problems = ownLists.map(
    (slug) => `${slug}: augmentModifiers belong in src/data/comp-augments.json, not the comp file`,
  );
  const slugs = new Set(comps.map((c) => c.slug));
  const unused = Object.keys(file.comps).filter((slug) => !slugs.has(slug));
  for (const { augment } of file.rules) {
    if (!catalog.hasAugment(augment)) problems.push(`comp-augments.json rules: unknown augment "${augment}"`);
  }

  const merged = comps.map((comp) => {
    const entries =
      file.comps[comp.slug] ?? (comp.academyAugments ?? []).map((augment) => ({ augment, strength: "good" as const, note: undefined }));
    const seen = new Set<string>();
    for (const { augment } of entries) {
      if (!catalog.hasAugment(augment)) problems.push(`comp-augments.json ${comp.slug}: unknown augment "${augment}"`);
      if (seen.has(augment)) problems.push(`comp-augments.json ${comp.slug}: "${augment}" is listed twice`);
      seen.add(augment);
    }
    // A comp's own entry for an augment wins over a rule for it.
    const rules = file.rules.filter((r) => r.when.styles.includes(comp.style) && !seen.has(r.augment));
    const augmentModifiers = [...entries, ...rules].map(({ augment, strength, note }) => ({
      augment,
      bonus: AUGMENT_STRENGTH_BONUS[strength],
      note: note ?? DEFAULT_NOTE[strength].replace("{name}", catalog.augmentName(augment)),
      unplayable: strength === "unplayable",
    }));
    return { ...comp, augmentModifiers };
  });
  return { comps: merged, problems, unused };
}
