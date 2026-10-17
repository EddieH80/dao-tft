/**
 * Pulls item stats from tactics.tools and writes the parts the engine uses to
 * src/data/item-stats.json:
 *
 * - holders: for each artifact and emblem, the units it lifts the most and by
 *   how much (change in average placement; negative is better).
 * - topItems: each unit's most-built completed items.
 *
 * Units and items the snapshot does not know are dropped, so run
 * `npm run fetch-data` first after a patch.
 *
 * Usage: npm run fetch-items
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Snapshot } from "../src/data/schema";
import { writeData } from "./write-data";

const PAGE = "https://tactics.tools/items";
// Lux has one variant per trait; the snapshot keeps only the base unit.
const LUX_VARIANT = /^DA_(18_Lux_|Lux18_)/;
const LUX_BASE = "DA_Lux18_Base";

interface RawStats {
  lastUpdated: number;
  units: Record<string, { topItems?: string[] }>;
  items: { itemId: string; topUsers: [string, number][] }[];
}

async function main() {
  const res = await fetch(PAGE, { headers: { "User-Agent": "Mozilla/5.0 (dao-tft data refresh)" } });
  if (!res.ok) throw new Error(`tactics.tools returned ${res.status}`);
  const html = await res.text();
  const json = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) throw new Error("No page data found; the tactics.tools page format may have changed");
  const stats = JSON.parse(json).props.pageProps.statsData as RawStats;

  const snapshot = JSON.parse(readFileSync(resolve(__dirname, "../src/data/snapshot.json"), "utf8")) as Snapshot;
  const units = new Set(snapshot.units.map((u) => u.id));
  const crafted = new Set(snapshot.items.map((i) => i.id));
  const special = new Set([
    ...snapshot.uncraftables.map((u) => u.id),
    ...snapshot.items.filter((i) => i.kind === "emblem").map((i) => i.id),
  ]);
  const unitId = (id: string) => (LUX_VARIANT.test(id) && id !== LUX_BASE ? LUX_BASE : id);

  const holders: Record<string, { unit: string; delta: number }[]> = {};
  for (const item of stats.items) {
    if (!special.has(item.itemId)) continue;
    const best = new Map<string, number>();
    for (const [raw, delta] of item.topUsers) {
      const unit = unitId(raw);
      if (units.has(unit) && delta < 0) best.set(unit, Math.min(best.get(unit) ?? 0, delta));
    }
    if (best.size) {
      holders[item.itemId] = [...best]
        .sort((a, b) => a[1] - b[1])
        .map(([unit, delta]) => ({ unit, delta: Math.round(delta * 100) / 100 }));
    }
  }

  const topItems: Record<string, string[]> = {};
  for (const [id, unit] of Object.entries(stats.units)) {
    const items = (unit.topItems ?? []).filter((i) => crafted.has(i));
    if (units.has(id) && items.length) topItems[id] = items;
  }

  if (!Object.keys(holders).length || !Object.keys(topItems).length) {
    throw new Error("Extraction produced an empty section; the tactics.tools data format may have changed");
  }

  const out = resolve(__dirname, "../src/data/item-stats.json");
  const file = {
    source: PAGE,
    statsUpdated: new Date(stats.lastUpdated * 1000).toISOString().slice(0, 10),
    fetchedAt: new Date().toISOString().slice(0, 10),
    holders,
    topItems,
  };
  writeData(out, file);
  console.log(
    `Wrote ${out}: holders for ${Object.keys(holders).length} artifacts/emblems, top items for ${Object.keys(topItems).length} units`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
