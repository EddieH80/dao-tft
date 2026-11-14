# Game-state contract

What the on-device model outputs for one player message, how the app applies it, and how to label
training and test data. This is step 2 of `docs/ml-plan.md`. The schema lives in
`src/assistant/contract.ts`; `src/assistant/contract.test.ts` shows valid and invalid outputs.

The model only translates (see the core design rule). It copies the player's words into a fixed
shape. Everything that needs game knowledge (which id a name means, what a recipe uses, whether the
board has room, what an augment selection offers) is done by code that already exists in
`src/engine/quick.ts`, against the snapshot loaded at runtime.

## 1. The output

The model emits one JSON object, a **partial update**: fields it leaves out are unchanged. `{}` means
"nothing to update" (questions, plans, scouting).

```ts
StateUpdate = {
  undo?:   true                         // lone "u" / "undo"; nothing else with it
  level?:  int 2–10
  next?:   true                         // "n", "next", "next round"
  gold?:   int 0–200
  hp?:     int 0–100
  stage?:  "N-M", N 2–7, M 1–7          // the current round
  clear?:  ("components" | "items" | "board" | "augments")[]
  set?:    Mention[]                    // what the player holds (no event verb)
  remove?: Mention[]                    // sold / lost / used
  add?:    Mention[]                    // got / hit / took
  craft?:  Mention[]                    // made / built / slammed; bare names in quick-bar syntax
}
Mention = {
  name:   string, 1–40 chars, as the player typed it
  count?: int 2–20                      // left out for one
  stars?: 1 | 2 | 3
  at?:    "2-1" | "3-2" | "4-2"         // augment selection
}
```

Limits match the quick bar (`MIN_LEVEL`, `MAX_LEVEL`, `MAX_GOLD`, `MAX_HP`) and `StageLabel` in
`src/data/schema.ts`. The schema also rejects:

- unknown keys, anywhere (strict objects);
- `null` and `false` (leave a field out instead), and empty lists;
- `undo` together with any other field;
- `count: 1` (leave it out), so each label has exactly one form;
- `count` with `stars`, and `at` with either;
- the same name (case-insensitive, with the same `stars` and `at`) twice in one list (merge it into
  `count`).

**Serialization for training:** compact JSON, keys in the order above, mentions in the order the
player said them. Evals parse the JSON and compare objects, so key order doesn't affect scoring;
the fixed order just makes training targets consistent.

**Prompt input:** the player's message only. The model is not given the current state or the
catalog. It doesn't need them, because every field is either absolute (`level: 7`) or an event
(`add`) that the app applies to the state it already has.

## 2. Applying an update

```
text → model → JSON.parse → StateUpdateSchema.safeParse → resolve names → reduce → preview → useGame.apply(next)
                    └── any failure here: fall back to runQuick(text) ──┘
```

0. **Every message goes to the model** when it's loaded, including quick-bar syntax (decided
   2026-11-14: no routing around it). Quick-bar lines are labeled to mean what the quick bar would
   do (rules 22–25), so they keep working.
1. **Validate.** Bad JSON or a failed `safeParse` means the output is discarded and the quick bar
   parses the text instead (project rule). `{undo: true}` skips the remaining steps and calls
   `useGame.undo()`.
2. **Resolve** each `name` to an id (section 4).
3. **Reduce** the update to a new `QuickState`, step by step, using the quick bar's own logic (table
   below). Each step produces a preview chip (`QuickStep`) exactly like the quick bar's.
4. **Preview and apply.** As in `QuickBar`, the player sees the chips. If every chip is ok, one
   `useGame.apply(next)` commits the whole update as **one undo step**. If any chip is red, nothing
   is applied.

Calling the individual store actions instead would record one undo step per field and skip the
preview. That's why the update goes through `QuickState` and `apply`, the quick bar's path.

### Mapping onto existing code

| Update field | Store action it stands for | Code reused in the reducer |
|---|---|---|
| `level` | `setLevel` | `fitBoard` (drops the last-added units if the board shrinks), as `runQuick`'s `level` case |
| `undo` | `undo` | called directly, as `QuickBar` does for a lone `u` |
| `next` | `nextRound` | `advanceRound` (stage +1, gold plus income, `goldEstimated: true`) |
| `gold` | `setGold` | `runQuick`'s `gold` case (also sets `goldEstimated: false`) |
| `hp` | `setHp` | `runQuick`'s `hp` case |
| `stage` | `setStage` | `runQuick`'s `stage` case (checks against `stageLabels`) |
| `add` component | `addComponent` | `change(s, "add", …)` component branch |
| `remove` component | `removeComponent` | `change(s, "remove", …)` |
| `add` item | `addItem` | `change(…, keepComponents: true)`: quick bar's `+name` |
| `craft` (any name) | `addItem` + 2× `removeComponent`, or the plain add | `change(s, "add", …, keepComponents: false)`: the quick bar's plain name. An item uses both components when held; anything else is added as by `add` |
| `remove` item | `removeItem` | `change(s, "remove", …)` (refits the board when a Tactician's item goes) |
| `add`/`set` unit | `toggleUnit` / `setStars` | `change` unit branch (team-size check, `starsOn`) |
| `remove` unit | `toggleUnit` | `change(s, "remove", …)` |
| `add`/`set` augment | `pickAugment` | `change` augment branch (`augmentProblem`: order, duplicates, stage pool) |
| `at` on an augment | `pickAugment(selection, id)` | `pickAugment`'s rule: selection *i* must be ≤ the number of picks made |
| `clear`, `set` components/items | `apply` | new: replace the category, then reuse the above per mention |

**Order.** Steps run in this fixed order, whatever order the player wrote them in:
`level → next → clear → set → remove → add → craft → stage → gold → hp`. Level comes first so unit
additions see the right team size. `next` runs before `stage` and `gold`, so "n 38" means "next
round, and I have 38" (the quick bar's usual line). The quick bar is order-sensitive and reads
"38 n" as 38 plus a round's income; here it is 38. That's a known difference, and a rare line. `remove` runs before `add` so "sold jinx, put in vi" works on a
full board. `add` runs before `craft` so "got a sword and made IE" can use the new sword.

**`set` semantics** (from your answers):

- **Components, items:** if `set` names any component, the component bag becomes exactly what's
  named; same for items. A category `set` doesn't name is unchanged.
- **Units:** upsert. A unit not on the board is added (at `stars`, or 1); a unit already there gets
  `stars` if given, otherwise nothing changes. The rest of the board stays. To replace the board, the
  label adds `clear: ["board"]`.
- **Augments:** upsert, like units: an augment not yet taken fills the next selection (or `at`).
  To replace them, the label adds `clear: ["augments"]`. Players usually name the pick they just
  made, and replacing would drop the earlier picks (confirmed 2026-11-14).

**Tolerances where the reducer differs from the quick bar,** because the model can't see the state:

- `count` on a unit is ignored ("2 jinx" means the unit goes on the board, stars unchanged; see your answer).
- `stars` in `remove` is ignored ("sold my 2 star jinx").
- A unit in `set` that's already on the board with no `stars`, or an augment in `set` that's
  already taken, is a no-op, not an error.
- `remove` of something not held is a no-op with a neutral chip, not an error.
- `stars` on a non-unit, `count` on an augment, or `at` on a non-augment is an error chip, as in
  the quick bar. (`craft` of a non-item is a plain add, so quick-bar lines label kind-free.)

### Changes this needs in step 7 (not done here)

- Export the per-action reducer from `quick.ts` (`change` and the scalar cases of `runQuick`) so the
  quick bar and the assistant share one implementation.
- Move `pickAugment`'s selection rule out of the store into a pure helper, for `at`.
- Two resolver additions from section 4: plural fallback and name-plus-number fallback.

## 3. Scope

### In scope for v1

| Field | Why |
|---|---|
| Level, gold, HP, stage | Core engine inputs; absolute values; trivial to validate |
| Components with counts | The main input to item allocation |
| Completed items, emblems, artifacts | Feed allocation and item pull; the catalog's `holdables` already covers all three |
| Crafting (`craft`) | Players say "slammed IE" constantly; the quick bar's recipe logic does the work |
| Board units with star levels | Board fit and reroll star bonuses |
| Augments, with selection (`at`) | Augment modifiers and unplayable rules |
| `clear` | Lets "no components" and full-board statements be expressed without a separate field |
| `next`, `undo` | Every message reaches the model, so the quick bar's `n` and `u` must survive it. The app does the work (`advanceRound`, `undo`); the model only flags them |

### Deferred

| Thing | Example | Why deferred |
|---|---|---|
| Opponents / scouting | "two people on ashe" | Needs mapping text to comps, a separate UI (`setOpponent`) and phrasing; v1 labels `{}` |
| Relative gold / HP | "+10 gold", "lost 12 hp", "spent 20" | Needs current state and arithmetic; absolute values cover the common case |
| Bench units, unit copies | "2 jinx on bench" | The store has no bench; only board units exist |
| Which unit holds an item | "IE on ashe" | The store keeps items as one flat list |
| XP, streaks, shop, rolls | "8 xp to 7", "4 win streak" | Not in the store |
| Plans and intentions | "going 8 at 4-1", "rolling at 3-2" | Not state, and acting on them would be the model deciding |
| Flow flags | "no augment yet" → `skipAugment` | UI-flow state, not game state; the flow handles it |
| Loose undo / reset | "scratch that", "new game" | Destructive and easy to misread; there are buttons, and a lone `u` / `undo` is in scope |
| Questions | "should I slam IE?" | A different job (explanation), labeled `{}` here |

## 4. Names to ids

The model never outputs ids: ids are game facts, and the snapshot changes daily. It copies names; the
app resolves them with the existing `QuickLexicon` (built from the snapshot and `src/data/aliases.json`).

1. `normalize(name)` (as in quick.ts): NFD, lowercase, keep only `a–z 0–9 +`. So `Kha'Zix`, `khazix`
   and `KHA ZIX` are equal.
2. `lexicon.exact(key)`: an alias first (`ie` → `DA_InfinityEdge`, `bow` → `RecurveBow`), then a
   full name.
3. **New:** a plural fallback. If the key ends in `s`, retry without it, then without `es` (`bows`,
   `swords`). Exact matches only.
4. **New:** a number fallback for `stars` on something that isn't a unit. Retry with the number
   appended as a digit and as a roman numeral (`glass cannon` + 2 → `glasscannon2`, `glasscannonii`),
   in case a labeler or the model split a numbered name.
5. `lexicon.prefix(key)`: the unique name starting with the key (`kha` → Kha'Zix).
6. No match → red chip `Unknown "…"`. Several matches → red chip `"…" could be A, B, C`, as in the quick bar.

Kind (component, item, unit, augment) comes from the resolved entry, not from the model. The labeling
rules below are mostly kind-free for that reason: a number before a name is always `count`, a number
after it is always `stars`. The resolver then applies each to whatever the name turns out to be.

**Duplicate augment names** (your answer: players qualify them with champion or tier words). The
qualifier stays in `name`, so the label is `"sivir beast within"`. These aliases are in
`src/data/aliases.json` (alias keys may contain `+`, matching `normalize`):

| Player says | Id | Alias keys |
|---|---|---|
| sivir beast within | `DA_18_PrimalAugment_Sivir` | `sivirbeastwithin` |
| nidalee beast within | `DA_18_PrimalAugment_Nidalee` | `nidaleebeastwithin` |
| sivir beast within+ | `DA_18_PrimalAugmentPlus_Sivir` | `sivirbeastwithin+` |
| nidalee beast within+ | `DA_18_PrimalAugmentPlus_Nidalee` | `nidaleebeastwithin+` |
| gold tons of stats / tons of stats 1 / I | `DA_TonsOfStatsI` (gold tier) | `goldtonsofstats`, `tonsofstats1`, `tonsofstatsi` |
| prismatic tons of stats / tons of stats 2 / II | `DA_TonsOfStatsII` (prismatic tier) | `prismatictonsofstats`, `tonsofstats2`, `tonsofstatsii` |

Tons of Stats I is gold and II is prismatic in `augments-3-2.json` / `augments-4-2.json`; neither is
silver. An unqualified "beast within" or "tons of stats" still matches both and is reported as ambiguous.

**Other slang in aliases.json:** `<trait> spat` for every emblem (`lunarspat` → Lunar Emblem, also
`floraspat`, `juggspat`), and `uplink` → Cybernetic Uplink. Emblem aliases name Set 18 ids, so a new
set's refresh fails the build until they're updated (the existing `validateAliases` check).

## 5. Labeling rules

Apply these in order. When a rule says "leave out", the information isn't labeled anywhere. First
check rule 22: a quick-bar line uses rules 1–8 for names and numbers on names, then rules 23–25
instead of the list rules (9–14) and the bare-number part of rule 16.

**Names**

1. `name` is the player's words for the thing, copied as typed (case, spelling, typos, plurals). Leave
   out count words, star markers, articles (`a`, `the`, `my`) and verbs.
2. If the words, *including a number or `+` after them*, match a snapshot name or alias (ignoring
   case, punctuation, and roman vs arabic numerals), the whole run is the name: `gain 21 gold`,
   `glass cannon 2`, `heroic grab bag+`. This is the quick bar's "longest name wins" rule, and the
   only rule that needs the snapshot.
3. Keep qualifiers that pick between same-name things: `sivir beast within`, `prismatic tons of stats`,
   `lunar emblem`.
4. Typos are not corrected. `jnx 2` → `{name: "jnx", stars: 2}`. The resolver reports it.
5. A name repeated in one list is merged: `sword sword bow` → `sword ×2, bow`. A correction replaces
   the earlier mention: `2 bows, no wait 3` → `bows ×3`.

**Numbers on names**

6. **count:** a number (digits or words) or `x2`/`2x` directly before the name, or `x2` after it.
   `a`, `an`, `one` → no count. `couple`, `pair (of)` → 2. Vague amounts (`some`, `a few`,
   `several`) → leave the mention out.
7. **stars:** `N`, `N*`, `N star`, `N-star` or `**` directly after the name (N 1–3), or `N star` /
   `N*` / `N-star` before it. A bare number before a name is a count, never stars (`2 jinx` → count 2;
   the resolver ignores it for units). A number after a name outside 1–3 is left out (`jinx 4`).
8. A star marker binds only to the name next to it: `jinx and vi 2` → jinx (no stars), vi ★2.

**Which list**

9. **add**: event verbs for gaining: *got, hit, took, grabbed, picked (up), gained, bought, added,
   put in, fielded, 2-starred / 3-starred*, a leading `+`.
10. **craft**: *made, built, crafted, slammed, combined, finished*. The components in "made IE from
    sword and glove" aren't labeled; crafting uses them up.
11. **remove**: *sold, lost, used, removed, benched* (unit off the board), *gave away*, a leading `-`,
    and "don't have X" / "no X" for a **specific** thing.
12. **set**: everything else that states a holding: bare lists, *I have, I've got, I'm holding,
    my augments are*. "I've got" / "have got" is possession → set; any other "got" is an event →
    add (A7).
13. **clear**: "no components / items / augments", "empty board", and alongside `set` when the
    player gives the full board ("my board is", "board:", "playing X Y Z", "my team is") or all
    augments ("my augments are").
14. A unit named only as an item's holder isn't labeled: `slammed IE on ashe` → craft IE. In a full
    board list it is labeled, because it's named as a board member.

**Scalars**

15. **level**: `level N`, `lvl N`, `lv N`, `lN`, `N level`, and, when no cue word or name follows
    the number: "I'm N" / "I am N", "hit N", "went N", "N now" (N 2–10). "hit 2 bows" is an add
    (a name follows); "hit 50 gold" is gold. "I'm at N" isn't level. Out of range → leave out.
16. **gold**: `N gold`, `Ng`, `gN`, `gold N`, `$N`. A bare number with no cue → leave out, except
    in a quick-bar line (rule 23).
17. **hp**: `N hp`, `hp N`, `hN`, `N health`. "at N" alone → leave out.
18. **stage**: `N-M` not linked to a mention, `stage N-M`, `on/at N-M`, `it's N-M`, `stage N round M`.
    Other forms (`3.2`, `stage 3` alone) → leave out.
19. **at**: a selection stage (2-1, 3-2, 4-2) linked to an augment by *at, on, for, from*, or
    "my/the N-M (augment) was/is X". A stage merely next to a name ("2-1 uplink") is the current
    stage, not `at`. A stage linked to a non-augment ("got a bow at 3-2") → leave the stage out.
20. A value stated twice → the last one wins (`level 6, actually 7` → 7).

**Never label**

21. Plans, hypotheticals and questions ("going 8", "if I hit a sword", "should I…"), opponents, and
    everything in the Deferred table. A message with nothing else → `{}`.

**Quick-bar lines** (every message reaches the model, so these must mean what the quick bar does)

22. A message is a **quick-bar line** when every word is a quick-bar command or a name, and it
    has at least one quick-bar-only token, or is a single bare number.
    - Commands: `N`, `gN`, `Ng`, `lN`, `lvN`, `lvlN`, `hN`, `hpN`, `Nhp`, `N-M`, `n`, `next`, `u`, `undo`.
    - Names: may carry a leading `-` or `+` or an attached star digit (`jinx2`). Cue words,
      verbs and connectives used by rules 6–21 (`level`, `lvl`, `gold`, `hp`, `health`, `stage`,
      `round`, `star`, `and`, `I'm`, `my`, `no`, `got`, …) never count as names, even when one
      prefix-matches a name ("level" → Level Up!). So `level 6 g30` is not a quick-bar line.
    - Quick-bar-only tokens: a number with its cue attached (`l7`, `g52`, `52g`, `h64`), a signed
      name (`-jinx`, `+ie`), a name with an attached star digit (`jinx2`), `n`, `next`, `u`, `undo`.
    - So `52`, `52 l7 n` and `bow sword -jinx` are quick-bar lines. `2 bows`, `sword sword bow` and
      `lvl 6 32 2 bows` are not, because no token is quick-bar-only, and they follow rules 1–21.
23. In a quick-bar line, a bare number is **gold** (0–200; anything higher is left out), never a
    count: `l7 2 bows` is level 7, 2 gold and bows. The one exception is rule 7's 1–3 directly after
    a name, which is a star level. Counts in a quick-bar line come only from repetition (`bow bow`).
24. In a quick-bar line, a plain name → **craft**, `+name` → **add**, `-name` → **remove**, and
    `name2` → that mention with `stars: 2`. Rule 7 still holds: `jinx 2` with a space is a 2-star
    Jinx, not 2 gold (the quick bar would read gold; a 1–3 gold entry is implausible). Rule 7's
    "left out" for numbers above 3 doesn't apply here: `jinx 52` in a quick-bar line is Jinx and
    52 gold, as the quick bar reads it.
25. `n`, `next`, or "next round" in any message → `next: true`. A lone `u` / `undo` (nothing else
    in the message) → `{undo: true}`. Anywhere else these words are left out.

## 6. Ambiguous inputs

| # | Player types | Label | Why |
|---|---|---|---|
| A1 | `level 6, 32 gold, two bows and a sword` | `{level:6, gold:32, set:[{name:"bows",count:2},{name:"sword"}]}` | Bare list = full holdings: components become exactly 2 bows + 1 sword |
| A2 | `2 bows` | `{set:[{name:"bows",count:2}]}` | Bare, so it replaces the components |
| A3 | `got 2 bows` / `hit 2 bows` | `{add:[{name:"bows",count:2}]}` | Event verb |
| A4 | `jinx 2` / `2* jinx` / `2 star jinx` / `jinx **` | `{set:[{name:"jinx",stars:2}]}` | Stars; units in `set` are upserts, so the board stays |
| A5 | `2 jinx` / `two jinx` | `{set:[{name:"jinx",count:2}]}` | Your answer: ambiguous. Labeled kind-free as a count; the reducer drops it for units, so Jinx goes on the board with stars unchanged |
| A6 | `took the 2-1 augment` | `{}` | No name; nothing to resolve |
| A7 | `I've got IE and a bow` vs `just got IE` | `{set:[{name:"IE"},{name:"bow"}]}` vs `{add:[{name:"IE"}]}` | "have got" = possession; "got" as an event = add |
| A8 | `took cybernetic uplink at 2-1` | `{add:[{name:"cybernetic uplink",at:"2-1"}]}` | Stage linked by "at" → `at`, not `stage` |
| A9 | `2-1 cybernetic uplink` | `{stage:"2-1", set:[{name:"cybernetic uplink"}]}` | No link word → current stage; the augment fills the next selection |
| A10 | `my 3-2 was glass cannon 2` | `{set:[{name:"glass cannon 2",at:"3-2"}]}` | Rule 2: "Glass Cannon II" is a snapshot name, so the 2 belongs to it |
| A11 | `took gain 21 gold` | `{add:[{name:"gain 21 gold"}]}` | Rule 2 beats the gold cue |
| A12 | `made IE` / `slammed IE` | `{craft:[{name:"IE"}]}` | Uses sword + gloves when held |
| A13 | `got IE from carousel` | `{add:[{name:"IE"}]}` | Your answer: only craft verbs use up components |
| A14 | `slammed IE on ashe` | `{craft:[{name:"IE"}]}` | Holder isn't labeled (deferred) |
| A15 | `sold jinx, put in vi` | `{remove:[{name:"jinx"}], add:[{name:"vi"}]}` | Remove runs before add |
| A16 | `my board is ashe 2, draven, taric` | `{clear:["board"], set:[{name:"ashe",stars:2},{name:"draven"},{name:"taric"}]}` | Framed as the board → replace |
| A17 | `ashe draven taric` | `{set:[{name:"ashe"},{name:"draven"},{name:"taric"}]}` | Not framed → upsert; other board units stay |
| A18 | `no components` / `no items yet` | `{clear:["components"]}` / `{clear:["items"]}` | Explicit "none" |
| A19 | `no spat` | `{remove:[{name:"spat"}]}` | Specific thing → remove (no-op if not held) |
| A20 | `I'm 7 at 4-1` | `{level:7, stage:"4-1"}` | Your answer: "I'm N" = level |
| A20b | `hit 8` / `went 8` / `8 now` | `{level:8}` | Your answer: these mean level |
| A21 | `I'm at 45` | `{}` | "at N" alone isn't level, HP or gold |
| A22 | `lvl 6 32 2 bows` | `{level:6, set:[{name:"bows",count:2}]}` | Your answer: a bare number isn't gold. Not a quick-bar line: `lvl 6` has a space, and nothing is quick-bar-only |
| A23 | `jinx and vi 2` | `{set:[{name:"jinx"},{name:"vi",stars:2}]}` | Stars bind to the adjacent name |
| A24 | `jinx 4` | `{set:[{name:"jinx"}]}` | Not a star level; the number is left out |
| A25 | `jnx 2` | `{set:[{name:"jnx",stars:2}]}` | Typos are copied; the resolver reports `Unknown "jnx"` |
| A26 | `sivir beast within` / `tons of stats` | `{set:[{name:"sivir beast within"}]}` / `{set:[{name:"tons of stats"}]}` | Qualifier kept; an unqualified duplicate gets "could be …" from the resolver |
| A27 | `lunar spat` | `{set:[{name:"lunar spat"}]}` | Slang kept; the `lunarspat` alias resolves it to Lunar Emblem |
| A28 | `+10 gold`, `lost 12 hp` | `{}` | Relative: deferred |
| A29 | `going 8 at 4-1` | `{}` | Plan, not state |
| A30 | `2 people on ashe` | `{}` | Opponents: deferred |
| A31 | `sword sword bow` | `{set:[{name:"sword",count:2},{name:"bow"}]}` | Repeats merge |
| A32 | `level 6 actually 7` | `{level:7}` | Last value wins |
| A33 | `a couple bows` / `some bows` | `{set:[{name:"bows",count:2}]}` / `{}` | "couple" = 2; vague amounts are left out |
| A34 | `bow 2` | `{set:[{name:"bow",stars:2}]}` | Kind-free rule 7; the resolver tries "bow 2" / "bow II", finds nothing, then reports "only units have a star level" |
| A35 | `52` | `{gold:52}` | A lone bare number is a quick-bar line (rule 22) |
| A36 | `52 l7 n` | `{level:7, next:true, gold:52}` | Quick-bar line; `next` runs before `gold`, so gold ends at 52 |
| A37 | `n 38 h71 ie` | `{next:true, gold:38, hp:71, craft:[{name:"ie"}]}` | The quick bar's own example; a plain name crafts when the components are held |
| A38 | `l8 bow -jinx +ie kog2` | `{level:8, remove:[{name:"jinx"}], add:[{name:"ie"}], craft:[{name:"bow"},{name:"kog",stars:2}]}` | Quick-bar line: plain → craft (a bow is just added), `+` → add, `-` → remove |
| A39 | `jinx2` | `{craft:[{name:"jinx",stars:2}]}` | The attached digit makes it a quick-bar line; same effect as A4 |
| A40 | `u` / `undo` | `{undo:true}` | Alone only |
| A41 | `next round, 40 gold` | `{next:true, gold:40}` | "next round" works in plain text too |
| A42 | `undo the bow` | `{}` | Not a lone `u`/`undo`: loose undo is deferred |

## 7. Open questions

1. ~~**Bare augment mentions: upsert or replace?**~~ Settled 2026-11-14: upsert, like units (section 2).
2. ~~**"hit 8" / "went 8" / "8 now": level?**~~ Settled 2026-11-14: yes (rule 15).
3. ~~**Slang aliases.**~~ Added 2026-11-14 (section 4). More slang can go into aliases.json as it
   turns up in the hand-written test set.
4. ~~**Route quick-bar syntax around the model?**~~ Settled 2026-11-14: no. Every message goes to the
   model, and quick-bar lines are labeled to mean what the quick bar does (rules 22–25, `next` and
   `undo`).

None open. Next: step 3 (data).
