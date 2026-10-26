# Dao TFT

An early-game decision engine for Teamfight Tactics (Set 18). Most TFT tools answer *"what is the best final board?"* Dao TFT answers the question you actually have mid-game: **given the components, items, board, augments and gold I have right now, what should I play toward, what should I slam, and what should I hope to hit next?**

**Live demo: https://dao-tft.vercel.app**

![Dao TFT router](docs/screenshot.png)

- Product requirements: [`Dao_TFT_PRD_v2.md`](Dao_TFT_PRD_v2.md) describes the product as built, and its section 0 lists everything that changed from the original plan in [`Dao_TFT_PRD.md`](Dao_TFT_PRD.md) (v1.0).
- Methodology for players: the [About](https://dao-tft.vercel.app/about) page.

## Two ways to use it

Both pages share one game, saved in the browser, so a reload keeps it.

### Guided (`/`)

The page is a flowchart, and each step appears once the one before it is answered:

1. **Components and held items**: the item components you hold, plus any completed items, artifacts or emblems.
2. **Current board**: your level (which caps the board), units with star levels, and optionally stage, gold and HP. Active traits are shown as you go.
3. **Augments**: the augment you took at 2-1, 3-2 and 4-2. Each picker lists only what that selection can offer, and shows how each offer would move the ranking before you take it.

Then the results: search for and pick each opponent's comp on the left, and the top three compositions appear on the right (two more are collapsed below). Each card shows:

- **Slam now**: the completed items worth crafting.
- **Hit next**: which component (carousel, creep round) moves the comp furthest.
- **Why it ranked here**: every part of the score in plain language.
- **Tags**: *lock-in* when an augment makes it clearly best, *flex enabler* when a strong augment lifts it into the top three, and *ruled out* when an augment or your economy means it can't be played.
- **Scouting**: when the comp is contested, uncontested comps that reuse your items and open frontline swaps.

Every comp also has a full page at `/comp/<slug>`.

### Quick (`/quick`)

One text bar for updating the game between fights. It is focused whenever you alt-tab back. Under it, a panel shows the game as it stands and the top three comps, one line each.

| Type | Does |
|---|---|
| Enter on an empty bar, or `n` | next round: the round moves on and gold gets a round's income, shown as `~` until you type the real figure |
| `38`, `l7`, `h64`, `4-2` | gold, level, HP, round |
| `jinx`, `bow`, `ie`, `unrivaled` | add a unit, component, item or augment by name, prefix or shorthand. An augment fills the next selection (2-1, 3-2, 4-2), and only if that selection offers it |
| `jinx2`, `kha zix3` | a unit at a star level, or change its level if it is already on the board (`jinx1` resets it) |
| Tab | complete the name being typed with the first suggestion (`kha` → Kha'Zix) |
| `-bf` | remove it |
| `+ie` | add an item without using up components (an item crafted from held components uses them up) |
| `u`, or Ctrl/Cmd+Z on an empty bar | undo |
| Shift+N on an empty bar | new game |
| `?`, or the ? button | show or hide this list |

A typical round is Enter, then `41 h72`. Before you press Enter, chips under the bar show what the line will do, and a word the bar does not understand turns red and blocks the line. Undo history lasts until the page reloads. Shorthand lives in [`src/data/aliases.json`](src/data/aliases.json). The parser is [`src/engine/quick.ts`](src/engine/quick.ts).

## How the ranking works

The full spec is in section 8 of the [PRD](Dao_TFT_PRD_v2.md). In short:

**Items are allocated, not overlapped.** Each comp lists the completed items it wants, weighted 1 (flex) to 3 (core). Every item uses up two components, so a comp's items compete for the same pool. [`allocate.ts`](src/engine/allocate.ts) searches the subsets of a comp's items that your components can actually build, and keeps the best:

```
value = Σ weight of crafted items + 0.35 × weight of each unbuilt item a leftover component still goes into
```

Branches are cut as soon as the components run out, and you only hold a handful, so the search is tiny. Results are cached. The same search drives *Slam now* (the items it chose) and *Hit next* (re-run with one more component).

**Then [`router.ts`](src/engine/router.ts) scores each comp:**

```
score = (value / best possible value for n components) × tier weight (S 1.0, A 0.85, B 0.7, C 0.5)
      + augment bonus + held item bonus + board bonus + star bonus
      − scout penalty − 0.3 per held item with no holder
```

The score is shown as a fit grade: S ≥ 0.85, A ≥ 0.65, B ≥ 0.45, C ≥ 0.25, otherwise D. Grades are 0.2 apart, and most rules below are written in grades.

| Input | Effect |
|---|---|
| **Augments** ([`comp-augments.json`](src/data/comp-augments.json)) | Each comp lists augments with a strength: `core` +0.3, `strong` +0.2, `good` +0.1, `avoid` −0.1, or `unplayable` (graded D, listed last). Bonuses add up to at most +0.5. |
| **Held artifacts and emblems** ([`items.ts`](src/engine/items.ts)) | One fills an item slot on the unit that wears it (TFT Academy's holder, or tactics.tools' best carry). It also adds +0.2 if TFT Academy builds it in the comp, plus the placement gain tactics.tools measures (×0.6 on the carry, ×0.3 on another unit), or +0.08 for an emblem of a trait the comp runs. Capped at 0.4 per item and 0.45 for all. |
| **Items with no holder** | A held item that no unit in the comp would use well costs 1.5 grades. Item roles (tank, AD, AP, hybrid) decide when no guide does, so Deathblade sinks an AP comp and Sunfire Cape sinks nothing. |
| **Board** | Up to +0.05 at levels 3–6, +0.1 at 7, +0.15 from 8. A unit the comp plays counts fully; one sharing a trait counts half. Early boards are cheap to replace; items are not. |
| **Reroll carries** | A reroll comp with none of its carries on a non-empty board drops one grade. A 2-star carry adds half a grade, a 3-star carry a full grade, a 3-star 3-cost carry two grades. |
| **Levelling past a reroll** | Level 6+ from 3-2 (1-cost), 7+ from 3-5 (2-cost) or 8+ from 4-1 (3-cost) without a 3-star carry of that cost: two grades down, and the style is marked not realistic. |
| **Economy** ([`economy.ts`](src/engine/economy.ts)) | With stage and gold entered, the game is played forward round by round (income, interest, free XP, typical losses) until the player can afford the style's roll level and roll gold. Reached after the deadline or after running out of HP: *unrealistic*, graded D. Reached late, at more than half your HP, or a reroll you have out-levelled by two: *stretch*, down one grade. More than ten rounds out it never calls a stretch, so every style stays open at 2-1. |
| **Scouting** ([`scout.ts`](src/engine/scout.ts)) | Each opponent's comp marks its units as contested. A contested carry costs 0.1 per opponent (up to 3), and a contested frontline 0.03 per unit (up to 0.12). |

Every comp has a style (`reroll-1`, `reroll-2`, `reroll-3`, `fast-8`, `fast-9`), which the economy, board and star rules depend on. A comp that is ruled out always sorts below every playable comp.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine and data tests
npm run lint
npm run typecheck
npm run build        # also validates every comp against the data snapshot
npm run fetch-data   # refresh src/data/snapshot.json from Community Dragon
npm run fetch-comps  # refresh src/data/comps-tftacademy.json from TFT Academy's tier list
npm run fetch-items  # refresh src/data/item-stats.json from tactics.tools
```

## Layout

```
src/engine/       plain TypeScript, no React: allocation, ranking, augments, items, economy, scouting, quick-bar parser
src/data/         zod schemas, hand-written comps/*.json, TFT Academy comps, Community Dragon snapshot,
                  hand-edited augment, economy and alias files, validation
src/app/          Next.js App Router pages: /, /quick, /comp/[slug], /about
src/components/   UI
src/store/        Zustand game state, saved to localStorage, with undo
scripts/          fetch-cdragon.ts, fetch-tftacademy.ts, fetch-tactics-items.ts
```

The engine runs entirely in the browser, so results are instant and the whole site is static.

## Data

| Source | File | Updated |
|---|---|---|
| [Community Dragon](https://www.communitydragon.org/): units, traits, items, augments, icons | `snapshot.json` | daily, automatically |
| [TFT Academy tier list](https://tftacademy.com/tierlist/comps): boards, items, stage tips, recommended augments | `comps-tftacademy.json` | daily, automatically |
| [tactics.tools](https://tactics.tools/): artifact and emblem holders, most-built items | `item-stats.json` | daily, automatically |
| Hand-written comps | `comps/*.json` | by hand |
| Augment picks for each comp | `comp-augments.json` | by hand |
| Augments each selection offers | `augments-{2-1,3-2,4-2}.json` | by hand |
| Economy estimates | `economy.json` | by hand |
| Quick-bar shorthand | `aliases.json` | by hand |

The header shows the patch the recommendations are for.

- The 12 hand-written comps are based on community guides (chiefly the BunnyMuffins Patch 18.3b guide), with tiers following TFT Academy's 18.4b tier list (checked 2026-10-11). Two exceptions were judged from [tactics.tools' comp stats](https://tactics.tools/team-compositions): Aphelios Flex keeps its A tier (Aphelios Nidalee is the most-played comp at 4.37 average placement), and Ashe Fast 9 drops to C (no Ashe-carried comp shows up at all).
- The rest are converted from TFT Academy's tier list by `npm run fetch-comps`. Comps the hand-written set already covers are skipped. Summaries and "play when" lines are generated, and Situational comps are listed as C tier.
- Augment strengths are editorial, based on TFT Academy's recommendations, the guides' tips and [SeeMeta's augment pages](https://seemeta.com/en/tft/set-18/augments). They are not measured lifts.

### Daily refresh

[`refresh-data.yml`](.github/workflows/refresh-data.yml) runs `fetch-data`, `fetch-comps` and `fetch-items` every day at 13:00 UTC (or by hand from the Actions tab). If the data changed and lint, typecheck, tests and the build pass, it commits to `main` and Vercel deploys. If the check fails (for example, TFT Academy renamed a guide that `comp-augments.json` lists), it force-pushes the data to the `data-refresh` branch, opens a pull request and fails the run, so `main` never gets data that breaks the build. The run summary lists what changed and the TFT Academy augments that `comp-augments.json` is missing. A file's `fetchedAt` changes only when its data does, so a quiet day makes no commit.

The refresh never edits the hand-written comps or augment picks.

## Maintaining the hand-edited data

### Augments after a patch

`src/data/comp-augments.json` is the only place augment picks live, and no script overwrites it. Each comp's list is keyed by its slug:

```json
"khazix-reroll": [
  {"augment": "DA_18_RivalsAugment", "strength": "core", "note": "Unrivaled powers up the Rival trait that Kha'Zix runs."},
  {"augment": "DA_ChampDelivery", "strength": "good"}
]
```

- `augment` is the Community Dragon id; search `src/data/snapshot.json` for the augment's name to find it.
- `strength` is `core`, `strong`, `good`, `avoid` or `unplayable`. `note` is shown on the card; every `core` and `strong` pick needs one (a test checks).
- `rules` apply one augment to every comp of the given styles, so a broad effect is written once. A comp that lists the same augment keeps its own entry:

  ```json
  {"augment": "DA_NoScoutNoPivot", "when": {"styles": ["fast-8", "fast-9"]}, "strength": "unplayable", "note": "Units that fight can't be benched or sold, ..."}
  ```
- A comp lists at most 10 augments of its own. Update `patch` and `checkedAt` when you review the file.
- `npm run fetch-comps` prints the augments TFT Academy recommends that the file is missing, and comps it does not cover yet.
- The build fails on an unknown augment id, an augment listed twice for one comp, or a slug that matches no comp.

### Items

A patch that adds a crafted item fails a test until the item gets a role in `ITEM_ROLE` ([`src/engine/items.ts`](src/engine/items.ts)).

### Economy model

[`src/data/economy.json`](src/data/economy.json) holds the estimates behind the economy check, so they can be tuned without touching code. It sets the XP for each level, free XP per round, the share of the next level's XP assumed banked (the app does not ask), income and interest, carousel and PvE rounds, typical loss damage by stage, and how often a player saving gold loses. Each style has a `rollLevel`, the `rollGold` it needs there, the `ideal` stage it usually spikes and the `deadline` after which it is out of reach. The economy tests pin two worked examples (level 8, 30 gold, 20 HP on 4-2 rules out Fast 9; level 5, 60 gold on 3-5 leaves only 1- and 2-cost rerolls), so a change that breaks them fails CI.

## Testing and CI

- **Allocation**: a hand-worked example, plus property tests over random sets of components. The search never spends a component twice, never gets worse when a component is added, and never exceeds the optimistic bound.
- **Ranking, augments, items, economy, scouting, quick bar**: behaviour tests (lock-in, flex enabler, penalty sizes, carry swaps, star and level rules, the economy's worked examples, command parsing).
- **Data validation**: every unit, item, augment and alias must exist in the Community Dragon snapshot. The check runs in tests *and* at build time, so a patch that removes a unit fails CI instead of shipping a stale comp.

GitHub Actions runs lint, typecheck, tests and the production build on every push to `main` and every pull request.

## Not built yet

Patch history and a patch selector, a hex board view, a graph-style flowchart, Riot API integration (automatic scouting), a desktop overlay, and usage analytics. Galaxy-style starting modifiers are not modelled. See section 10 of the [PRD](Dao_TFT_PRD_v2.md) for the roadmap.

## Disclaimer

Dao TFT is an independent portfolio project and is not endorsed by Riot Games. Teamfight Tactics and Riot Games are trademarks of Riot Games, Inc. Unit, item and augment data and icons are loaded from [Community Dragon](https://www.communitydragon.org/).
