import type { Aliases, Comp } from "./schema";
import type { Catalog } from "@/engine/catalog";

/** Returns every problem found in `comps`; an empty list means the data is consistent with the snapshot. */
export function validateComps(comps: Comp[], catalog: Catalog): string[] {
  const problems: string[] = [];
  const slugs = new Set<string>();

  for (const comp of comps) {
    const where = `${comp.slug}:`;
    if (slugs.has(comp.slug)) problems.push(`${where} duplicate slug`);
    slugs.add(comp.slug);

    const unit = (id: string, field: string) => {
      if (!catalog.hasUnit(id)) problems.push(`${where} unknown unit "${id}" in ${field}`);
    };
    const item = (id: string, field: string) => {
      if (!catalog.hasItem(id)) problems.push(`${where} unknown item "${id}" in ${field}`);
    };

    comp.carries.forEach((u) => unit(u, "carries"));
    comp.frontline.forEach((u) => unit(u, "frontline"));
    comp.endBoard.forEach((u) => unit(u, "endBoard"));
    comp.opener.units.forEach((u) => unit(u, "opener"));
    comp.frontlineAlternatives.forEach((u) => unit(u, "frontlineAlternatives"));
    comp.targetItems.forEach((t) => {
      item(t.item, "targetItems");
      unit(t.unit, "targetItems");
    });
    comp.slams.forEach((s) => {
      item(s.item, "slams");
      unit(s.unit, "slams");
    });
    comp.keyItems.forEach((k) => {
      if (!catalog.holdable(k.item)) problems.push(`${where} unknown key item "${k.item}"`);
      unit(k.unit, "keyItems");
    });
    comp.augmentModifiers.forEach((m) => {
      if (!catalog.hasAugment(m.augment)) problems.push(`${where} unknown augment "${m.augment}"`);
    });

    for (const c of comp.carries) {
      if (!comp.endBoard.includes(c)) problems.push(`${where} carry "${c}" is not on the end board`);
    }
    for (const t of comp.targetItems) {
      if (!comp.endBoard.includes(t.unit)) problems.push(`${where} "${t.unit}" holds an item but is not on the end board`);
    }
    for (const u of comp.frontlineAlternatives) {
      if (comp.endBoard.includes(u)) problems.push(`${where} frontline alternative "${u}" is already on the end board`);
    }
  }
  return problems;
}

/** Every quick bar alias must name something the snapshot has. */
export function validateAliases(aliases: Aliases, catalog: Catalog): string[] {
  return Object.entries(aliases.aliases)
    .filter(
      ([, id]) =>
        !catalog.componentIds.includes(id) && !catalog.holdable(id) && !catalog.hasUnit(id) && !catalog.hasAugment(id),
    )
    .map(([alias, id]) => `aliases.json: "${alias}" points at unknown id "${id}"`);
}
