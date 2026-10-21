# Dao TFT

An early-game decision engine for Teamfight Tactics (Set 18). Most TFT tools answer *"what is the best final board?"* Dao TFT answers the question you have at 2-1: **given the item components I hold right now, what should I play toward, what should I slam, and what should I hope to hit next?**

**Live demo: https://dao-tft.vercel.app**

![Dao TFT router](docs/screenshot.png)

The site is a flowchart. Each step appears once the one before it is answered:

1. **Item components** you are holding.
2. **Your 2-1 board**: the units you are playing now.
3. **Your 2-1 augment**: compare the offers, then take one.

From there the flow branches into three information sections, then into the compositions to play:

- **Slam now**: completed items worth crafting for your top comps.
- **Hit next**: which component (carousel, creep round) moves you toward which comp.
- **Scout**: flag units opponents are playing; contested comps drop, and uncontested comps that reuse your items are suggested.
- **Compositions**: the top three, with what you can build now, what is missing, and why each ranked where it did. Augment offers flag **lock-ins** and **flex enablers**.

The PRD is in [`Dao_TFT_PRD.md`](Dao_TFT_PRD.md).

## Run it

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # engine + data tests
npm run build      # also validates every comp against the data snapshot
npm run fetch-data # refresh src/data/snapshot.json from Community Dragon
npm run fetch-comps # refresh src/data/comps-tftacademy.json from TFT Academy's tier list
npm run fetch-items # refresh src/data/item-stats.json (artifact/emblem holders) from tactics.tools
```

## Playing live

The quick bar on the [Quick](/quick) page (the header switches between it and the guided flow at `/`; both share one saved game) takes every update as one line of text, and it is focused whenever you alt-tab back, so a round between fights is a few keystrokes. Under it, a panel shows the game as it stands: stage, level, gold and HP, the board with star levels and active traits, and the components, items and augments you hold. The top three comps follow, one line each.

| Type | Does |
|---|---|
| Enter on an empty bar, or `n` | next round: the round moves on and gold gets a round's income, shown as `~` until you type the real figure |
| `38`, `l7`, `h64`, `4-2` | gold, level, HP, round |
| `jinx`, `bow`, `ie`, `unrivaled` | add a unit, component, item or augment by name, prefix or shorthand. An augment fills the next selection (2-1, 3-2, 4-2) and only if that round offers it |
| `jinx2`, `kha zix3` | a unit at a star level: a 1, 2 or 3 right after its name adds it at that level, or changes the level if it is already on the board (`jinx1` resets it) |
| Tab | complete the name being typed with the first suggestion shown under the bar (`kha` → Kha'Zix, `tear of` → Tear Of The Goddess) |
| `-bf` | remove it |
| `+ie` | add an item without using up components (an item crafted from held components uses them up) |
| `u`, or Ctrl/Cmd+Z on an empty bar | undo |
| Shift+N on an empty bar | new game |
| `?`, or the ? button | show or hide this list of commands |

So a typical round is Enter, then `41 h72`. Chips under the bar show what a line will do before Enter, and a word it does not understand turns red and blocks the line. The game is saved in the browser, so a reload keeps it; undo history lasts until the page reloads. Shorthand lives in [`src/data/aliases.json`](src/data/aliases.json), and the build fails on an alias the snapshot does not know. The parser is [`src/engine/quick.ts`](src/engine/quick.ts).

## How the ranking works

Each curated comp lists the completed items it wants, weighted 1 (flex) to 3 (core). The problem is that every item **consumes two components**, so a comp's items compete for the same pool. A simple overlap score hides that, and it cannot tell you what to craft.

[`src/engine/allocate.ts`](src/engine/allocate.ts) solves it directly. It searches subsets of a comp's items, keeping only those the player's components can actually build, and picks the best:

```
value = Σ weight of crafted items + 0.35 × weight of each unbuilt item a leftover component still feeds
```

Infeasible branches are cut as soon as the pool runs out, and a bag holds a handful of components, so the search is tiny. Results are cached per comp and component set.

[`src/engine/router.ts`](src/engine/router.ts) turns that into a score:

```
score = (value / best possible value for n components) × tier weight
      + augment bonus + held item bonus + board bonus − scout penalty − dead item penalty
```

**Items lead, the early board follows.** A held artifact or emblem also takes one of its wearer's item slots: the unit TFT Academy puts it on, or the comp carry tactics.tools rates highest with it. It fills whichever of that unit's items the components could least afford, so the comp's fit rises as if that item were built. On top of that, held artifacts and emblems that a comp does not already build pull toward it ([`src/engine/items.ts`](src/engine/items.ts)): +0.2 if TFT Academy builds the item in that comp, plus the placement gain tactics.tools measures for the item on the comp's carry (×0.6) or another end-board unit (×0.3), or +0.08 for an emblem whose trait the comp already runs. An item's best reason counts in full and agreeing reasons add half; one item adds at most 0.4 and all of them 0.45. The board adds at most 0.05 at levels 3-6, 0.1 at 7 and 0.15 from 8, because an early board is cheap to replace and items are not.

**Comps have a style.** Each comp is `reroll-1`, `reroll-2`, `reroll-3`, `fast-8`, `fast-9` or `lose-streak` (set by hand in its comp file, or from the guide's style by `npm run fetch-comps`, which stops on a style it does not know).

**Your economy decides which styles are realistic.** Given the player's stage, gold, level and HP, [`src/engine/economy.ts`](src/engine/economy.ts) plays the game forward round by round: income plus interest, 2 free XP a round, and a typical loss on most player rounds. It stops when the player can buy up to the style's roll level and still has its roll-down gold. A style reached only after its deadline, or after the projected HP runs out, is *unrealistic*: graded D and listed last. One reached after its usual spike, or at more than half the player's HP, or a reroll the player has out-levelled by two, is a *stretch* and drops one fit grade. Level 8 with 30 gold and 20 HP on 4-2 rules out Fast 9; level 5 with 60 gold on 3-5 leaves only 1- and 2-cost rerolls realistic. More than ten rounds out the projection only rules a style out, so every style stays open at 2-1. With no stage or gold given, nothing changes.

**Reroll comps need their carries.** A reroll comp whose carries are all missing from a non-empty board drops exactly one fit grade, however well the items suit it. An empty board is not penalised, since it says nothing yet. A reroll comp whose carry is already starred up rises instead: half a fit grade for a 2-star carry, which a player who is not rerolling often has too, and a full grade for a 3-star one, since the reroll is already paid for. A 3-star 3-cost carry takes far more rolling to reach, so it adds two grades. With several carries on the board, the one that adds the most counts. Stars on the rest of the board, or in a non-reroll comp, change nothing. Levelling past a reroll also costs it: a 1-cost reroll at level 6 or higher from 3-2 on, a 2-cost reroll at level 7 or higher from 3-5 on, or a 3-cost reroll at level 8 or higher from 4-1 on drops two fit grades, unless one of the comp's carries of that cost is already 3-star. That replaces the one-grade "out-levelled" stretch rather than adding to it. Set a unit's stars on its board chip, or by typing its name with a 2 or 3 on the end (`jinx2`) in the quick bar.

**Held items need a holder.** Each completed item, artifact or emblem the player holds that no unit in a comp would use well costs that comp 0.3, one and a half fit grades. An item has a holder if the comp builds it, a guide or tactics.tools puts it on one of the comp's units, the comp runs the emblem's trait, or one of its units builds it in any guide. Failing that, the item's role in [`src/engine/items.ts`](src/engine/items.ts) decides: tank items fit any frontline, AD and AP items fit carries already building that damage type, and hybrid items fit anyone. So Deathblade sinks an AP comp, while Sunfire Cape sinks nothing.

**Augments steer the ranking.** Each comp lists the augments it wants in [`src/data/comp-augments.json`](src/data/comp-augments.json), each with a strength: `core` +0.3 (the comp is built around it, e.g. Unrivaled for Kha'Zix), `strong` +0.2 (a trait or carry augment the comp runs), `good` +0.1 (a solid pick TFT Academy recommends), `avoid` −0.1 or `unplayable`. Every augment the player has taken that a comp lists adds its bonus, up to +0.5 in total. An `unplayable` augment grades the comp D and sorts it below every playable comp: No Scout No Pivot locks in the units that fight, so it rules out every level 8-9 comp. Each recommendation card lists the comp's core, strong, avoid and unplayable augments with the reason, before the player picks. A comp an augment lifts clearly into first is tagged *lock-in*; one a strong pick lifts into the top three is a *flex enabler*.

Normalising by the best possible value for the number of components held means a comp with a long flex list is not punished. The same search drives the other features: *Slam now* is the items it chose to craft, and *Hit next* re-runs it with one extra component and reports the gain.

## Layout

```
src/engine/    pure TypeScript, no React: allocation, ranking, augments, scouting
src/data/      comp schema (zod), curated comps/*.json, TFT Academy comps, Community Dragon snapshot, validation
src/components, src/app, src/store   Next.js App Router UI, Zustand session state
scripts/       fetch-cdragon.ts builds the snapshot, fetch-tftacademy.ts converts TFT Academy comps, fetch-tactics-items.ts pulls item stats
```

The engine runs entirely in the browser, so results are instant and the whole site is static.

## Testing and CI

- **Allocation** is checked against a hand-worked example, plus property tests over random bags: it never spends a component twice, never gets worse when you add one, and never exceeds the optimistic bound.
- **Ranking, augments, scouting** have behaviour tests (lock-in, flex-enabler, penalty size, carry swaps).
- **Data validation**: every unit, item and augment in `src/data/comps/*.json` must exist in the Community Dragon snapshot. The check runs in tests *and* at build time, so a patch that removes a unit fails CI instead of shipping a stale comp.

GitHub Actions runs lint, typecheck, tests and the production build on every push.

## Daily data refresh

[`.github/workflows/refresh-data.yml`](.github/workflows/refresh-data.yml) runs `fetch-data`, `fetch-comps` and `fetch-items` every day at 13:00 UTC, and can be started by hand from the Actions tab. If the data changed and lint, typecheck, tests and the build pass, it commits to `main` and Vercel deploys. If the check fails, for example because TFT Academy renamed a guide that `comp-augments.json` lists, it force-pushes the data to the `data-refresh` branch, opens a pull request and fails the run, so `main` never gets data that breaks the build. The run summary lists what changed and the augments TFT Academy recommends that `comp-augments.json` is missing. A file's `fetchedAt` changes only when its data does, so a day with no new data makes no commit.

## What is and is not here

This is an MVP built in a week, so it is deliberately narrow.

- Comps and item priorities are hand-curated from community guides (chiefly the BunnyMuffins Patch 18.3b guide). Their tiers follow TFT Academy's 18.4b tier list (checked 2026-10-11) where it covers the comp. Aphelios Flex keeps its A tier and Ashe Fast 9 drops to C, judged from [tactics.tools' comp stats](https://tactics.tools/team-compositions): Aphelios Nidalee is the most-played comp at 4.37 average placement, and no Ashe-carried comp shows up at all. They are editorial judgement, not statistics. Opener, slam and stage notes are short drafts.
- The rest of the comps are converted from [TFT Academy's tier list](https://tftacademy.com/tierlist/comps) by `npm run fetch-comps`. Boards, items and stage tips come from the guides; summaries and "play when" lines are generated from them, and Situational comps are listed as C tier. Comps the curated set already covers are skipped.
- Augment picks are hand-edited in `src/data/comp-augments.json`: TFT Academy's recommended augments for each guide, plus strengths judged from the guides' tips and comp names and from [SeeMeta's augment pages](https://seemeta.com/en/tft/set-18/augments). They are editorial, not measured lifts.
- Scouting is manual input only.
- **Not built**: patch history/selector, hex board view, flowchart visualisation, Riot API integration, desktop overlay. The daily refresh pulls new data but does not edit hand-curated comps or augment picks.

## Updating augments after a patch

`src/data/comp-augments.json` is the only place augment picks live, and no script overwrites it. Each comp's list is keyed by its slug, one augment per line:

```json
"khazix-reroll": [
  {"augment": "DA_18_RivalsAugment", "strength": "core", "note": "Unrivaled powers up the Rival trait that Kha'Zix runs."},
  {"augment": "DA_ChampDelivery", "strength": "good"}
]
```

- `augment` is the Community Dragon id; search `src/data/snapshot.json` for the augment's name to find it.
- `strength` is `core`, `strong`, `good`, `avoid` or `unplayable`. `note` is optional and shown on the recommendation card; give one for every `core` and `strong` pick (a test checks).
- `rules` apply one augment to every comp whose style is in `when.styles`, so a broad effect is written once. A comp that lists the same augment keeps its own entry:

  ```json
  {"augment": "DA_NoScoutNoPivot", "when": {"styles": ["fast-8", "fast-9", "lose-streak"]}, "strength": "unplayable", "note": "Units that fight can't be benched or sold, ..."}
  ```
- A comp lists at most 10 augments of its own. Update `patch` and `checkedAt` when you review the file.
- A patch that adds a crafted item fails a test until the item gets a role in `ITEM_ROLE` (`src/engine/items.ts`).
- `npm run fetch-comps` prints the augments TFT Academy recommends that the file is missing, and comps it does not cover yet, so you know what to add.
- The build fails on an unknown augment id, an augment listed twice for one comp, or a slug that matches no comp (for example after TFT Academy renames a guide).

## Updating the economy model

[`src/data/economy.json`](src/data/economy.json) holds the estimates behind the economy check, so they can be tuned without touching code: the XP to reach each level, free XP per round, how much of the next level's XP a player is assumed to have banked (the app does not ask), income and interest, which rounds are carousels and PvE, the typical loss by stage and how often a greedy player loses. Each style has a `rollLevel`, the `rollGold` it needs there, the `ideal` stage it usually spikes and the `deadline` after which it is out of reach. The economy tests pin the two worked examples above, so a change that breaks them fails CI.

## Disclaimer

Dao TFT is an independent portfolio project and is not endorsed by Riot Games. Teamfight Tactics and Riot Games are trademarks of Riot Games, Inc. Unit, item and augment data and icons are loaded from [Community Dragon](https://www.communitydragon.org/).
