/**
 * Pulls the comps on TFT Academy's tier list and writes them, converted to our
 * comp format, to src/data/comps-tftacademy.json. Units, items and augments the
 * snapshot does not know are dropped, so run `npm run fetch-data` first after a
 * patch. Comps already covered by a hand-written comp in src/data/comps are
 * skipped (see COVERED), but their artifacts and emblems are kept in
 * `curatedKeyItems` and merged into the hand-written comp.
 *
 * Augment picks are not written here: they live in the hand-edited
 * src/data/comp-augments.json. This script lists the augments TFT Academy
 * recommends that the file does not have yet, so they can be added by hand.
 *
 * Usage: npm run fetch-comps
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Comp, CompAugments, Snapshot } from "../src/data/schema";
import { writeData } from "./write-data";

const PAGE = "https://tftacademy.com/tierlist/comps";
// SvelteKit serves the page's load data here; the flags ask for every node.
const DATA = `${PAGE}/__data.json?x-sveltekit-invalidated=1111`;

/** TFT Academy titles that a hand-written comp already covers, and which one. */
const COVERED: Record<string, string> = {
  "Azir Rammus": "azir-rammus-reroll",
  "Caitlyn Hunters": "caitlyn-reroll",
  "Defender Cassio": "defender-cassiopeia",
  "Draven Ezreal 9": "draven-fast-9",
  "Malphite AP Flex": "flora-malphite",
  "Ahri Morgana": "invoker-morgana-ahri",
  "Lunarwood Kha'zix": "khazix-reroll",
  "Primal Jungle": "primal-malphite",
  "Riftbeast Reroll": "riftbeast-reroll",
  "Elderwood Veigar": "veigar-reroll",
};

/** Guides past this display index are archived and not shown on the tier list. */
const ARCHIVED_FROM = 1000;
/** Board hexes 0-13 are the two front rows. */
const BACK_ROW_FROM = 14;
const MAX_TARGET_ITEMS = 14;
/** A back-row unit holding this many items counts as a second carry. */
const CARRY_ITEMS = 3;

interface GuideUnit {
  apiName: string;
  items: string[];
  boardIndex?: number;
}
interface Guide {
  maxCap: GuideUnit[];
  title: string;
  tier: string;
  style: string;
  isPublic: boolean;
  displayIndex: number;
  mainChampion: { apiName: string } | null;
  finalComp: GuideUnit[];
  earlyComp: GuideUnit[];
  altBuilds: GuideUnit[][];
  augments: { apiName: string; disabled: boolean }[];
  augmentsTip: string;
  tips: { stage: string; tip: string }[];
}

/** Rebuilds a value serialised by SvelteKit's `devalue`: a flat array where objects point at indices. */
function unflatten(values: unknown[]): unknown {
  const hydrate = (i: number): unknown => {
    if (i < 0) return undefined; // devalue's sentinels for undefined, NaN and friends
    const v = values[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === "string") return v[1]; // Date, Set and the like; only Dates appear here
      return v.map((x) => hydrate(x as number));
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, hydrate(x as number)]));
    }
    return v;
  };
  return hydrate(0);
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/'/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const firstSentence = (s: string) => (s.match(/^.*?[.!?](\s|$)/)?.[0] ?? s).trim();

const PLAY_WHEN: Record<string, string> = {
  "1-Cost Reroll": "You find early copies of {carry} and can slow roll at level 5 or 6",
  "2-Cost Reroll": "You find early copies of {carry} and can slow roll at level 6",
  "3-Cost Reroll": "You find early copies of {carry} and can slow roll at level 7",
  "4-Cost Fast 8": "You can reach level 8 on time with enough gold to roll for {carry}",
  "Fast 9": "You have the economy to reach level 9 and find {carry}",
};

/** TFT Academy's guide styles, as our comp styles. */
const STYLES: Record<string, Comp["style"]> = {
  "1-Cost Reroll": "reroll-1",
  "2-Cost Reroll": "reroll-2",
  "3-Cost Reroll": "reroll-3",
  "4-Cost Fast 8": "fast-8",
  "Fast 9": "fast-9",
  "Lose Streak": "lose-streak",
};

/** A new style must be mapped by hand rather than guessed, since it decides which economies can play the comp. */
function compStyle(guide: Guide): Comp["style"] {
  const style = STYLES[guide.style?.trim()];
  if (!style) throw new Error(`Unknown TFT Academy style "${guide.style}" on "${guide.title}"; add it to STYLES`);
  return style;
}

/** Artifacts and emblems the guide builds anywhere: final board, alternate builds or level 10 cap. */
function keyItems(guide: Guide, snapshot: Snapshot): Comp["keyItems"] {
  const units = new Set(snapshot.units.map((u) => u.id));
  const special = new Set([
    ...snapshot.uncraftables.map((u) => u.id),
    ...snapshot.items.filter((i) => i.kind === "emblem").map((i) => i.id),
  ]);
  const found: Comp["keyItems"] = [];
  for (const u of [...guide.finalComp, ...guide.maxCap, ...guide.altBuilds.flat()]) {
    if (!units.has(u.apiName)) continue;
    for (const item of u.items) {
      if (special.has(item) && !found.some((k) => k.item === item)) found.push({ item, unit: u.apiName });
    }
  }
  return found;
}

/** Comp augments are hand-edited in src/data/comp-augments.json, not converted. */
type ConvertedComp = Omit<Comp, "augmentModifiers">;

function convert(guide: Guide, snapshot: Snapshot): ConvertedComp {
  const units = new Map(snapshot.units.map((u) => [u.id, u]));
  const items = new Map(snapshot.items.map((i) => [i.id, i]));
  const name = (id: string) => units.get(id)!.name;

  // Summons such as Elderwood's trees are not shop units.
  const board = guide.finalComp.filter((u) => units.has(u.apiName));
  const endBoard = [...new Set(board.map((u) => u.apiName))];
  const mostItems = [...board].sort((a, b) => b.items.length - a.items.length)[0].apiName;
  const main = guide.mainChampion && endBoard.includes(guide.mainChampion.apiName) ? guide.mainChampion.apiName : mostItems;

  const isBack = (u: GuideUnit) => (u.boardIndex ?? BACK_ROW_FROM) >= BACK_ROW_FROM;
  const carries = [main, ...board.filter((u) => u.apiName !== main && isBack(u) && u.items.length >= CARRY_ITEMS).map((u) => u.apiName)];
  const frontline = board.filter((u) => !isBack(u) && !carries.includes(u.apiName)).map((u) => u.apiName);

  // The main carry's build is core; everyone else's, and alternate carry builds, flex.
  const targetItems: Comp["targetItems"] = [];
  const addItem = (item: string, unit: string, weight: number) => {
    if (!items.has(item) || targetItems.some((t) => t.item === item && t.unit === unit)) return;
    targetItems.push({ item, unit, weight });
  };
  board.filter((u) => u.apiName === main).forEach((u) => u.items.forEach((i) => addItem(i, main, 3)));
  board.filter((u) => u.apiName !== main).forEach((u) => u.items.forEach((i) => addItem(i, u.apiName, 2)));
  guide.altBuilds
    .flat()
    .filter((u) => endBoard.includes(u.apiName))
    .forEach((u) => u.items.forEach((i) => addItem(i, u.apiName, 1)));

  const names = carries.map(name);
  const carryNames = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  const tank = board.find((u) => !isBack(u) && !carries.includes(u.apiName) && u.items.length >= 2);
  const situational = guide.tier === "X";
  const mainBuild = targetItems.filter((t) => t.unit === main && items.get(t.item)!.kind === "item");

  const playWhen = [(PLAY_WHEN[guide.style] ?? "Your board and items point toward {carry}").replace("{carry}", name(main))];
  if (mainBuild.length) playWhen.push(`You have components for ${items.get(mainBuild[0].item)!.name}`);
  if (situational && guide.augmentsTip) playWhen.push(`Situational: ${firstSentence(guide.augmentsTip)}`);

  const opener = guide.earlyComp.map((u) => u.apiName).filter((id) => units.has(id));
  const stage2 = guide.tips.find((t) => t.stage === "Stage 2")?.tip;

  return {
    slug: slugify(guide.title),
    name: guide.title.trim(),
    tier: situational ? "C" : (guide.tier as Comp["tier"]),
    style: compStyle(guide),
    summary:
      `${guide.style ? `A ${guide.style} comp` : "A comp"} carried by ${carryNames}` +
      (tank ? `, with ${name(tank.apiName)} tanking.` : "."),
    playWhen,
    carries,
    frontline,
    endBoard,
    targetItems: targetItems.slice(0, MAX_TARGET_ITEMS),
    opener: { units: opener.length ? opener : [main], note: stage2 ? firstSentence(stage2) : "" },
    slams: [],
    stages: guide.tips.filter((t) => t.tip.trim()).map((t) => ({ stage: t.stage, tip: t.tip.trim() })),
    frontlineAlternatives: [],
    keyItems: keyItems(guide, snapshot),
  };
}

async function main() {
  const res = await fetch(DATA, { headers: { "User-Agent": "Mozilla/5.0 (dao-tft data refresh)" } });
  if (!res.ok) throw new Error(`TFT Academy returned ${res.status}`);
  const body = (await res.json()) as { nodes: ({ type: string; data?: unknown[] } | null)[] };

  let patch = "";
  let guides: Guide[] | undefined;
  for (const node of body.nodes) {
    if (node?.type !== "data" || !node.data) continue;
    const value = unflatten(node.data) as { patch?: string; guides?: Guide[] };
    patch ||= value.patch ?? "";
    guides ??= value.guides;
  }
  if (!guides?.length) throw new Error("No guides found; TFT Academy's page format may have changed");

  const snapshot = JSON.parse(readFileSync(resolve(__dirname, "../src/data/snapshot.json"), "utf8")) as Snapshot;
  const live = guides
    .filter((g) => g.isPublic && g.displayIndex < ARCHIVED_FROM && g.finalComp.length)
    .sort((a, b) => a.displayIndex - b.displayIndex);
  const comps = live.filter((g) => !COVERED[g.title.trim()]).map((g) => convert(g, snapshot));
  // Hand-written comps keep their own data but pick up the guide's artifacts and emblems.
  const curatedKeyItems = Object.fromEntries(
    live.filter((g) => COVERED[g.title.trim()]).map((g) => [COVERED[g.title.trim()], keyItems(g, snapshot)]),
  );

  const out = resolve(__dirname, "../src/data/comps-tftacademy.json");
  const file = { source: PAGE, patch, fetchedAt: new Date().toISOString().slice(0, 10), comps, curatedKeyItems };
  writeData(out, file);
  console.log(`Wrote ${out}: ${comps.length} comps (${live.length - comps.length} already hand-written)`);

  reportMissingAugments(live, snapshot, patch);
}

/** Lists TFT Academy's recommended augments that src/data/comp-augments.json does not have yet. */
function reportMissingAugments(live: Guide[], snapshot: Snapshot, patch: string) {
  const path = resolve(__dirname, "../src/data/comp-augments.json");
  const listed = (JSON.parse(readFileSync(path, "utf8")) as CompAugments).comps;
  const names = new Map(snapshot.augments.map((a) => [a.id, a.name]));
  const lines: string[] = [];
  for (const guide of live) {
    const slug = COVERED[guide.title.trim()] ?? slugify(guide.title);
    const have = new Set((listed[slug] ?? []).map((e) => e.augment));
    const missing = guide.augments.filter((a) => !a.disabled && names.has(a.apiName) && !have.has(a.apiName));
    if (!listed[slug]) lines.push(`  ${slug}: not in the file yet`);
    if (missing.length) lines.push(`  ${slug}: ${missing.map((a) => `${a.apiName} (${names.get(a.apiName)})`).join(", ")}`);
  }
  if (!lines.length) return console.log(`comp-augments.json has every augment TFT Academy recommends for ${patch}.`);
  console.log(`TFT Academy (${patch}) recommends augments comp-augments.json does not list. Add them by hand:`);
  console.log(lines.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
