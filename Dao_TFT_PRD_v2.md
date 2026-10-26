# Product Requirements Document
## Dao TFT — Early-Game Decision Engine for Teamfight Tactics

**Author:** Eddie Huang
**Status:** v2.0. Describes the product as built; supersedes [v1.0](Dao_TFT_PRD.md)
**Date:** October 26, 2026
**Target Release:** TFT Set 18 (live at https://dao-tft.vercel.app); data refreshed daily

---

## 0. What Changed Since v1.0

v1.0 was written before any code. Building the MVP showed that several of its ideas were wrong or too narrow, and turned up problems it had not covered. This section lists every place where the product now differs from v1.0. The sections after it describe the product as it is now.

### 0.1 Changed

| Area | v1.0 | v2.0 | Why |
|---|---|---|---|
| Matching algorithm | Weighted Jaccard overlap between the player's components and a comp's `component_signature` | A search over which of a comp's items the components can build, with each component used once (§8) | Every item uses up two components, so a comp's items compete for the same pool. Overlap scoring counts one component toward several items, and it cannot say what to craft. |
| Comp data model | `component_signature`, a weighted multiset of components | `targetItems`: completed items, each with the unit that holds it and a weight from 1 (flex) to 3 (core) | Players think in items, not components. The components come from each item's recipe in the Community Dragon snapshot. |
| Where ranking runs | Next.js API routes, with SSR for router results | Entirely in the browser; the site is static | The search is small enough to finish instantly on the client. With no server there is nothing to host or scale, and results update on every click. |
| Output size | Top 5 comps | Top 3 comps, plus 2 more in a collapsed section | Three is what a player can read between rounds. |
| Stage 1 and stage 2 components | Two separate component pickers | One component picker that is updated as the game goes on | Splitting by stage added clicks without changing the result. |
| Entry flow | Component picker at `/`, results at `/router` | A guided flowchart at `/` where each step appears once the one before it is answered: components and held items, then board, then augments, then scouting and comps. A second page, `/quick`, does the same with typed commands | Keeping every step on one page lets the player see how each answer changes the result. |
| Augment advisor | A standalone `/augments` page | Built into the flow: each augment offer shows how it moves the ranking, before the player takes it | An augment only makes sense alongside the rest of the game state, which the flow already has. |
| Augment data | `augment_modifiers[]` stored inside each comp file, with free-form bonuses | One hand-edited file (`comp-augments.json`) with five named strengths: core +0.3, strong +0.2, good +0.1, avoid −0.1, unplayable. Rules can apply one augment to every comp of a style | One file is quicker to review after a patch. Named strengths are easier to judge than raw numbers. |
| Augments per comp | Capped at 5 | Capped at 10 | With every augment in one file, 10 per comp turned out to be manageable. |
| Scouting input | Flag the units opponents hold | Search for and pick each of the 7 opponents' comps; every unit in that comp counts as contested | Players scout whole boards, and one search box per opponent is faster than flagging units one by one. |
| Data pipeline | Runs after each patch and opens a draft PR for review | Runs every day. If the data changed and lint, typecheck, tests and the build pass, it commits to `main` and deploys. If the check fails, the data goes to a `data-refresh` PR and `main` is left unchanged | Review only adds value when something breaks. The build already checks every reference, so the PR is opened only when the check fails. |
| Comp sources | Comps written by hand by high-elo contributors | 12 comps written by hand plus the rest of TFT Academy's tier list (about 25 comps) converted automatically from TFT Academy's tier list. Item and holder statistics come from tactics.tools | A single author cannot keep up with every comp each patch. Converting TFT Academy's guides covers the whole meta, and the hand-written comps add depth where it matters. |
| Visualization | React Flow for the flowchart; an SVG hex board | Flowchart-style connectors drawn with CSS; units shown as chips with star levels and active traits | The branching is shallow enough that a graph library was not needed. A hex board is post-MVP. |
| Fit labels | Tiers S/A/B/C | Comp tiers S/A/B/C; a fit grade of S/A/B/C/D on each recommendation | D marks a comp the player's augments or economy rule out. |

### 0.2 Added (not in v1.0)

- **Economy model (§5.6).** Given stage, gold, level and HP, the app plays the game forward round by round to judge whether each comp style (1-, 2- or 3-cost reroll, Fast 8, Fast 9) is realistic, a stretch, or out of reach. This answers pain point 4 (pivot timing), which v1.0 listed but did not plan a feature for.
- **Comp styles.** Every comp is tagged `reroll-1`, `reroll-2`, `reroll-3`, `fast-8` or `fast-9`, and the economy, board and star rules depend on the style.
- **Board and star levels.** The board is capped by player level. Each unit has a star level. A reroll comp with none of its carries on a non-empty board drops one fit grade. A 2-star carry raises it half a grade, a 3-star carry a full grade, and a 3-star 3-cost carry two grades. Levelling past a reroll's window without a 3-star carry drops it two grades.
- **Items before units.** The board adds at most 0.05 to a comp's score at levels 3–6, 0.1 at 7 and 0.15 from level 8, because an early board is cheap to replace and items are not.
- **Held completed items, artifacts and emblems.** The player can enter items they already hold. A held artifact or emblem fills one of its wearer's item slots and pulls toward comps that use it, weighted by TFT Academy's builds and the placement gain tactics.tools measures for it.
- **Items with no holder.** A held item that no unit in a comp would use well costs that comp 1.5 fit grades. Item roles (tank, AD, AP, hybrid) decide what counts as a good holder when no guide does.
- **Unplayable augments.** Some augments rule out a whole style. For example, No Scout No Pivot rules out every level 8–9 comp. A comp that is ruled out is graded D and listed last.
- **Augment offers by stage.** Hand-checked lists of the augments each selection (2-1, 3-2, 4-2) can offer, grouped by silver, gold and prismatic, so the picker only shows augments the player could actually see.
- **Quick page (§5.7).** A one-line command bar for updating the game between fights (`n` for next round, `38 h64`, `jinx2`, `-bf`, undo), with a compact summary of the game and the top 3 comps.
- **Saved games.** The game is saved in the browser, so a reload keeps it. The guided and quick pages share the same game. Undo covers the last 30 changes.
- **Patch badge.** The header shows the patch the recommendations are for.
- **Build-time data validation.** Every unit, item, augment, alias and comp slug must exist in the Community Dragon snapshot, or the build fails.

### 0.3 Deferred or dropped

| v1.0 item | Status |
|---|---|
| Galaxy / starting modifiers (gold subscription, anvil, free units) | Not built. Starting modifiers are not entered or modelled. |
| Patch selector and `/patch-notes` | Deferred. The app covers the current patch only, and the header shows which patch that is. |
| `/router` and `/augments` routes | Dropped; replaced by the guided flow at `/` and the quick page at `/quick`. |
| React Flow flowchart, SVG hex board | Deferred (§10). |
| Statistically grounded comp tiers | Partly done. Tiers come from TFT Academy, and tactics.tools stats drive item and holder judgements. Augment strengths are still editorial. |
| "Last updated" timestamp on every comp page | Partly done. The patch is shown in the header and the About page shows when the snapshot was fetched. Comp pages show neither. |
| Success metrics | No analytics are set up, so none of §11 is measured yet. |

---

## 1. Executive Summary

Existing third-party TFT tools (TFT Academy, TFT Handbook, MetaTFT) optimize for a single question: *what is the best end-state composition?* They answer it well, but they mostly ignore the harder question players face during a game: *given what I have right now, what should I play toward, and when should I pivot?*

**Dao TFT** is a web-based decision-support tool for the early game. The player enters what they hold now: item components, completed items, artifacts and emblems, their board and star levels, their augments, their gold, level, HP and stage, and what opponents are playing. Dao TFT ranks the compositions worth playing toward and explains each one: what to craft now, which component to hope for next, how the augments in front of them would change things, and whether their economy can still get there. The product follows the decisions a player makes during a game, not just the final board.

---

## 2. Problem Statement

### 2.1 The Gap in Existing Tools

| Feature | TFT Academy | TFT Handbook | MetaTFT | Dao TFT |
|---|---|---|---|---|
| End-game comp guide | ✅ | ✅ | ✅ | ✅ (condensed, links to the guide) |
| Item BiS per unit | ✅ | ✅ | ✅ | ✅ |
| Opener / early-game board | Partial | ❌ | Partial | ✅ |
| Component → comp, with craft order | ❌ | Partial | Partial | ✅ |
| Augment advice given the player's game | ❌ | ❌ | ❌ | ✅ |
| Economy check (can I still reach this?) | ❌ | ❌ | ❌ | ✅ |
| Fast updates between rounds | ❌ | ❌ | ❌ | ✅ (quick page) |

### 2.2 Player Pain Points

1. **Too many options from the same components.** A player who opens Tear + Chain Vest + BF Sword has to weigh about four viable late-game directions at once, and each item they craft uses up components another direction needed. No tool shows this trade-off clearly.
2. **Augment advice ignores the player's game.** Tier-list tools rate augments globally. A player who has already built three AD items may see "Sword Overflow" rated S-tier, even though more AD items do nothing for them. Dao TFT always judges augments against the player's current game.
3. **Scouting is underdeveloped.** Players need to account for what opponents are playing as well as what to build. If three other players are on the comp my early game points to, I will probably place higher by pivoting to another comp.
4. **Pivot timing is invisible.** A player on a loss streak needs to know which plans their gold and HP can still reach, and when to level or roll. *(v2.0 addresses this with the economy model, §5.6.)*
5. **Updating a tool mid-game is slow.** *(New in v2.0.)* A player has about 30 seconds between fights. A tool that takes a dozen clicks to update does not get used during a game.

---

## 3. Goals and Non-Goals

### Goals
- Model the *process* of a TFT game, not just its endpoint.
- Support the highest-leverage early decisions: what to craft from the components held, which augment to take, which units to keep on the board, and which comp style the player's economy can still reach.
- Let the player record what opponents are playing, lower comps whose units are contested, and suggest uncontested comps and frontline swaps that reuse the player's items.
- Be fast enough to use mid-game on a second monitor. One round's update should take only a few keystrokes.
- Base recommendations on outside data (TFT Academy's tier list and tactics.tools item statistics) where it exists, label editorial judgement as editorial, and refresh the data without manual work.

### Non-Goals (MVP)
- Real-time overlay / in-game app (post-MVP, §10).
- Match history or personalized player analytics.
- Mobile-native app.
- A full augment database or tier list. The app only uses augments to judge comps.
- Accounts or server-side storage. The game is saved in the browser only.

---

## 4. Target Users

**Primary:** Ranked TFT players, Silver through Diamond, who understand the game's mechanics but struggle to turn that knowledge into decisions under time pressure.

**Secondary:** Streamers and coaches who want a visual aid for explaining these decisions to an audience.

**Out of scope for MVP:** Challenger-level players, who already make these decisions without help, and absolute beginners, who lack the basic game knowledge the tool assumes.

---

## 5. Core Features

### 5.1 Component Router

The core of Dao TFT. The player enters the item components they hold, plus any completed items, artifacts and emblems, and updates them as the game goes on. The router ranks every comp and shows for each one:

- **Slam now:** the completed items to craft now, chosen by the allocation search (§8) so that no component is counted twice.
- **What is still missing:** the comp's items that cannot be built yet, and the components each one needs.
- **Hit next:** for each component, how far getting it next (carousel, creep round) moves the comp's items, and which item it completes or builds toward.
- **Why it ranked here:** every part of the score in plain language: items matched, tier, augments, held items, board, stars, economy, scouting, and items with no holder.

Results are the top 3 comps, with 2 more in a collapsed section.

### 5.2 Augment Pivot Advisor

The player records the augment taken at each selection (2-1, 3-2, 4-2). The picker only lists augments that selection can offer, grouped by silver, gold and prismatic, with icons. Augments that some comp strongly wants are highlighted and listed first. For each offer, the player sees:

- **How taking it would change the ranking**, before they pick it.
- **Lock-in:** an augment that lifts the top comp by at least 0.1 and puts it at least 0.15 ahead of the next comp. This tells the player to stop flexing.
- **Flex enabler:** a strong or core augment that lifts a comp from outside the top 3 into it.
- **Ruled out:** comps the augment makes unplayable.

Each comp lists the augments it wants with a strength (core, strong, good, avoid, unplayable) and a reason. The bonuses add up to at most +0.5, so augments steer the ranking without outweighing items. The same augment can be core for one comp and unplayable for another.

### 5.3 Early-Game Board

The player sets their level (2–10) and puts up to that many units on the board, with a star level for each. Active traits are shown with their bronze, silver, gold or prismatic tier. The board affects the ranking in three ways:

- **Board fit:** a board unit that the comp plays counts fully, and one that shares a trait with the comp's end board counts half. This bonus is small early: at most 0.05 at levels 3–6, 0.1 at 7 and 0.15 from 8.
- **Reroll carries:** a reroll comp with none of its carries on a non-empty board drops one fit grade. A 2-star carry raises it half a grade, a 3-star carry a full grade, and a 3-star 3-cost carry two grades.
- **Levelling past a reroll:** reaching level 6 or higher from 3-2 on (1-cost), 7 or higher from 3-5 on (2-cost), or 8 or higher from 4-1 on (3-cost) without a 3-star carry of that cost drops the comp two grades and marks its style as not realistic.

Each comp page (`/comp/:slug`) shows the end board with carries highlighted, the items to build with their weights, the opener, slams, frontline and alternatives, stage-by-stage tips, and the augments that change the plan. Opener, slam and stage notes come from the guides and are short.

### 5.4 Scout Signals

For each of their 7 opponents, the player types to search the comps and picks the one that opponent is playing, or clears the box to leave it unknown. Every unit in a chosen comp counts as contested once for each opponent playing it, up to 3.

- **Contested carry:** a comp loses 0.1 for each opponent holding its most-contested carry.
- **Contested frontline:** a comp loses 0.03 for each contested frontline unit, up to 0.12.
- **Carry swaps:** when a comp is contested, its card suggests up to 3 comps whose carries nobody is playing and that want some of the same completed items, so the player's components still pay off.
- **Open frontline:** the comp's approved frontline alternatives that nobody is holding.

*(Scouting is entered by hand only. Automated scouting through the Riot API is post-MVP.)*

### 5.5 Patch-Aware Data Layer

The data is refreshed every day (§7.3). Each data file records its patch or fetch date, and the header shows the patch the recommendations are for. Only the current patch is available; a selector for viewing a previous patch is post-MVP.

### 5.6 Economy Model *(new)*

The player can enter stage, gold and HP next to their level. For each comp style, the model plays the game forward round by round: base income plus interest, 2 free XP each round, and a typical loss on most player-combat rounds. It stops at the first round where the player can afford to buy XP up to the style's roll level and still have its roll gold left.

| Style | Roll level | Roll gold | Usual spike | Deadline |
|---|---|---|---|---|
| 1-cost reroll | 5 | 30 | 3-1 | 4-1 |
| 2-cost reroll | 6 | 30 | 3-2 | 4-1 |
| 3-cost reroll | 7 | 40 | 3-5 | 4-2 |
| Fast 8 | 8 | 30 | 4-2 | 4-5 |
| Fast 9 | 9 | 30 | 5-2 | 5-5 |

- **Unrealistic:** the style is reached only after its deadline, or after the projected HP runs out. The comp is graded D and listed last.
- **Stretch:** the style is reached after its usual spike, or costs more than half the player's HP, or is a reroll the player has out-levelled by two. The comp drops one fit grade.
- More than ten rounds ahead, the projection can only rule a style out, never call it a stretch, so every style stays open at 2-1. If stage and gold are left blank, the model does nothing.

All of these estimates live in `economy.json` so they can be tuned without code changes. Tests pin two worked examples: level 8 with 30 gold and 20 HP on 4-2 rules out Fast 9, and level 5 with 60 gold on 3-5 leaves only the 1- and 2-cost rerolls realistic.

### 5.7 Quick Page *(new)*

The guided flow suits a player setting up a game. Mid-game, clicking through it takes too long. The quick page (`/quick`) has a single text bar, focused whenever the player switches back to the window, where one line can update the whole game:

- `n` or Enter on an empty bar: next round. The stage moves on and gold gets a round's income, marked as an estimate until the player types the real amount.
- `38`, `l7`, `h64`, `4-2`: gold, level, HP, stage.
- A unit, component, item or augment by name, prefix or shorthand. `jinx2` sets a star level, `-bf` removes, and `+ie` adds an item without using up its components.
- Tab completes a name, `u` or Ctrl/Cmd+Z undoes, Shift+N starts a new game, `?` shows the command list.

Before Enter, chips under the bar show what the line will do, and a word the bar does not understand turns red and blocks the line. Under the bar, a panel shows the game state and the top 3 comps on one line each. The quick and guided pages share one saved game.

---

## 6. Information Architecture

```
/                → Guided flow: components & held items → board → augments → scouting + ranked comps
/quick           → Quick page: command bar, game state, top 3 comps
/comp/:slug      → Comp detail (end board, items, opener, slams, frontline, stages, augments); statically generated
/about           → Methodology and data sourcing
```

v1.0's `/router`, `/augments` and `/patch-notes` are not part of the product (see §0.3).

---

## 7. Technical Architecture

### 7.1 Front-End

- **Framework:** Next.js 16 (App Router), React 19, TypeScript. Every page is static, including one page per comp.
- **Engine:** `src/engine/` is plain TypeScript with no React (allocation, ranking, augments, items, economy, scouting, quick-bar parser). It runs in the browser, so results update instantly.
- **State:** Zustand, saved to `localStorage`, with an undo history of up to 30 changes.
- **Styling:** Tailwind CSS 4 with a dark and gold palette. Icons are loaded from Community Dragon, and no Riot-owned assets are bundled.

### 7.2 Data

| Source | File | How it is kept up to date |
|---|---|---|
| Community Dragon: units, traits, items, artifacts, emblems, augments | `snapshot.json` | `npm run fetch-data`, daily |
| TFT Academy tier list: boards, items, stage tips, recommended augments, style | `comps-tftacademy.json` | `npm run fetch-comps`, daily |
| tactics.tools: artifact and emblem holders, each unit's most-built items | `item-stats.json` | `npm run fetch-items`, daily |
| Hand-written comps | `comps/*.json` (12) | By hand |
| Augments each comp wants, with strengths | `comp-augments.json` | By hand; `fetch-comps` lists missing ones |
| Augment offers for each selection | `augments-{2-1,3-2,4-2}.json` | By hand |
| Economy estimates | `economy.json` | By hand |
| Quick-bar shorthand | `aliases.json` | By hand |

**Comp schema (zod):** `slug`, `name`, `tier`, `style`, `summary`, `playWhen[]`, `carries[]`, `frontline[]`, `endBoard[]`, `targetItems[]` (item, unit, weight 1–3), `opener`, `slams[]`, `stages[]`, `frontlineAlternatives[]`, `keyItems[]` (artifacts and emblems the comp is built around), and `augmentModifiers[]`, which is filled in from `comp-augments.json` when the data loads.

**Hosting:** Vercel, as a static site.

### 7.3 Data Update Pipeline

A GitHub Actions workflow runs every day at 13:00 UTC and can also be started by hand:

1. Fetches the Community Dragon snapshot, TFT Academy's comps and tactics.tools' item stats.
2. If nothing changed, it stops. A file's `fetchedAt` changes only when its data does.
3. If the data changed, it runs lint, typecheck, tests and the production build. The build checks every reference against the snapshot.
4. If the check passes, it commits to `main` and Vercel deploys.
5. If the check fails, it force-pushes the data to a `data-refresh` branch, opens a PR, and fails the run, so `main` never gets data that breaks the build.

The run summary lists what changed, the augments TFT Academy recommends that `comp-augments.json` is missing, and comps the hand-edited files do not cover yet. CI (lint, typecheck, tests, build) also runs on every push and PR.

---

## 8. Ranking Algorithm

### 8.1 Item allocation

Each comp lists completed items with weights. Every item uses up two components, so the engine searches subsets of the comp's items that the player's components can actually build, and keeps the best:

```
value = Σ weight of crafted items
      + 0.35 × weight of each unbuilt item that a leftover component still goes into
```

The search drops a branch as soon as the components run out. A player holds only a handful of components, so the search stays small, and results are cached per comp and component set. Held completed items first count toward their own slots. A held artifact or emblem then takes the slot on its wearer that leaves the components the most to build.

### 8.2 Score

```
coverage = value / best possible value for the number of components held
score    = coverage × tier weight (S 1.0, A 0.85, B 0.7, C 0.5)
         + augment bonus        (≤ 0.5)
         + held-item bonus      (≤ 0.4 for one item, ≤ 0.45 for all)
         + board bonus          (≤ 0.05 / 0.1 / 0.15 by level)
         + star bonus           (reroll comps)
         − scout penalty
         − 0.3 for each held item with no holder
```

Then, in order: a reroll comp with none of its carries on the board drops one fit grade; a stretch economy drops one grade; levelling past a reroll drops two. An unplayable augment or an unrealistic economy grades the comp D and sorts it below every playable comp.

Dividing by the best possible value for the number of components held means a comp with a long flex list is not penalized for it.

### 8.3 Fit grade

The final score is shown as a letter: S ≥ 0.85, A ≥ 0.65, B ≥ 0.45, C ≥ 0.25, otherwise D. The grades are 0.2 apart, and every penalty above is defined as a number of grades. The letter describes how well the comp fits this game. It is not a win rate.

---

## 9. Design Principles

1. **Speed over depth at entry.** A player mid-game has about 30 seconds between fights. One round's update on the quick page should take a few keystrokes; the guided flow should give a ranking within its first three steps.
2. **Show the reasoning, not just the answer.** Every recommendation explains why it ranked where it did: items matched, augments, held items, board, stars, economy, scouting, and items with no holder.
3. **Progressive disclosure.** Flowchart → comp card (items and augments collapsed, reasons visible) → full comp page.
4. **Patch humility.** Show the patch in the header, check all data against the current snapshot at build time, and label hand-written judgement as editorial.
5. **No false precision.** Show letters (tiers S/A/B/C, fit grades S–D), not numeric scores. Economy verdicts are estimates, and a style is never called a stretch more than ten rounds ahead.
6. **Items before units.** *(New.)* Early boards are cheap to replace and items are not, so components drive the ranking and the early board only adjusts it.

---

## 10. Post-MVP Roadmap

| Phase | Feature | Notes |
|---|---|---|
| v2.1 | Patch selector and patch notes | Compare comp tiers with the previous patch during patch transitions |
| v2.1 | Hex board view | Standard 4×7 layout on comp pages |
| v2.1 | Usage analytics | Needed before any metric in §11 can be measured |
| v2.2 | Riot Games API integration | Live match data, automatic scouting |
| v2.2 | Mobile-responsive layout overhaul | MVP is designed for a second monitor first |
| v2.3 | Desktop overlay (Electron) | In-game display, similar to the MetaTFT app |
| v2.4 | Personalized recommendations | "You tend to play reroll; here are the reroll lines that match your components" |
| v3.0 | Measured weights | Replace hand-set item weights and augment strengths with values fitted to match placement data |
| v3.1 | Community augment voting | Players vote on augment strengths for each comp, weighted by rank |

---

## 11. Success Metrics

Targets are unchanged from v1.0. No analytics are set up yet, so none of them is measured.

| Metric | Target (3 months post-launch) | Status |
|---|---|---|
| Monthly active users | 5,000 | Not measured |
| Router sessions / DAU | > 2.0 | Not measured |
| Average session duration | > 3 minutes | Not measured |
| Patch update turnaround | < 48 hours after patch deploy | Met by design: the data refreshes daily and goes live automatically when the check passes |
| Comp database coverage | ≥ 90% of S/A-tier comps per patch | Met by design: every TFT Academy tier-list comp is converted |
| Bounce rate (landing → results) | < 40% | Not measured |

---

## 12. Risks and Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| A patch breaks the comp data overnight | High (every 2 weeks) | Every reference is checked at build time. The daily refresh never pushes failing data to `main`; it opens a PR instead. |
| An upstream source changes its format or renames guides (TFT Academy, tactics.tools) | Medium | The fetch scripts stop on an unknown style. A slug in `comp-augments.json` that matches no comp fails the build. |
| Hand-written data goes stale (augment strengths, economy estimates, offer lists) | Medium | Each file records its patch and the date it was checked. `fetch-comps` lists augments that are missing. |
| Comp writing depends on a single author | Medium, lower than v1.0 | Most comps are converted automatically. The comp JSON is open for community PRs. |
| Riot API terms restrict certain data uses | Low | Community Dragon only for now; audit the terms before Riot API integration. |
| MetaTFT's growing feature set overlaps with Dao TFT | Medium | Dao TFT stands apart by working from the player's current game: what they hold, their economy, and the augments in front of them. |
| The meta settles on a single dominant comp | Low | Scouting and the economy check still help the player decide whether to contest it. |

---

## 13. Open Questions

1. **Curation vs. stats** *(partly resolved).* Comp tiers follow TFT Academy, with two exceptions (Aphelios Flex, Ashe Fast 9) judged from tactics.tools placement data and labeled as editorial. Item weights and augment strengths are still editorial. Should they be fitted to placement data (v3.0)?
2. **Augment depth** *(resolved).* The cap is 10 augments per comp, kept manageable by having one shared file with style rules.
3. **Economy accuracy.** The model assumes a typical loss rate and a share of XP already banked, since the app does not ask for either. Is it worth asking for current XP, or win/loss streak?
4. **Naming and branding.** "Dao TFT" refers to the idea of a path or way (道), which fits a tool about finding a path through a game. Confirm it does not conflict with Riot's tool naming conventions before a wider launch.
5. **Monetization.** Out of scope for a portfolio project. Ad-free with Patreon/Ko-fi support is the norm for community TFT tools.

---

## Appendix A: Glossary

| Term | Definition |
|---|---|
| Component | A basic item in TFT; two components combine to form a completed item |
| BiS | Best-in-Slot; the best completed item for a given unit |
| Artifact / Emblem | Completed items that cannot be crafted from components (artifacts), or that give a trait (emblems) |
| Slam | Crafting a completed item right away instead of saving components |
| Opener | The early-game board played before the final comp comes together |
| Augment | A passive bonus picked at stages 2-1, 3-2 and 4-2 |
| Fast 8 / Fast 9 | Strategies that level quickly to 8 or 9 to find 4- and 5-cost units |
| Reroll | A strategy that stays at a low level and rolls to 3-star 1-, 2- or 3-cost units |
| Style | A comp's plan: `reroll-1`, `reroll-2`, `reroll-3`, `fast-8` or `fast-9` |
| Fit grade | Dao TFT's S–D label for how well a comp suits the player's current game |
| Lock-in / Flex enabler | An augment that makes one comp clearly best / that lifts a comp into the top 3 |
| Scout | Checking opponents' boards to inform your own decisions |
| Comp | Short for "composition": a set of units and traits played together |

---

*Dao TFT is an independent portfolio project by Eddie Huang. It is not affiliated with or endorsed by Riot Games.*
