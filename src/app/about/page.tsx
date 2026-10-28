import type { Metadata } from "next";
import { Panel } from "@/components/ui";
import { comps, snapshot } from "@/data";

export const metadata: Metadata = { title: "Dao TFT - About" };

export default function About() {
  return (
    <main className="mx-auto max-w-3xl space-y-4 px-4 py-6">
      <h1 className="text-3xl font-semibold">How Dao TFT works</h1>
      <p className="text-muted">
        Most TFT tools answer &ldquo;what is the best final board?&rdquo; Dao TFT answers the question you actually have at
        2-1: given the components I hold right now, what should I be playing toward?
      </p>

      <Panel title="The ranking">
        <div className="space-y-3 text-sm text-muted">
          <p>
            Each curated comp lists the completed items it wants, with a weight from 1 (flex) to 3 (core). Every item
            uses two components, so items compete for the same pool. Dao TFT searches every subset of a comp&apos;s items
            that your components can build and keeps the best one. Building an item earns its weight; a leftover
            component that is half of an unbuilt item earns 35% of that item&apos;s weight.
          </p>
          <p>
            That value is divided by the most a comp could score from the number of components you hold, so a comp with
            a long flex list is not punished. It is then multiplied by the comp&apos;s tier (S 1.0, A 0.85, B 0.7, C 0.5).
            Augments add a bonus, held artifacts and emblems add a bonus (below), units on your board add a smaller one
            (full credit for a unit the comp plays, half for one that shares a trait), and opponents playing the same
            units subtract a penalty. The letter shown on each card is a label for that final score, not a win rate.
          </p>
          <p>
            The same search powers &ldquo;Slam now&rdquo; (items it chose to build) and &ldquo;Hit next&rdquo; (it re-runs with one
            extra component and reports the gain).
          </p>
        </div>
      </Panel>

      <Panel title="Items before units">
        <div className="space-y-3 text-sm text-muted">
          <p>
            Units on a level 3-6 board are cheap to replace; items are not. So your board adds at most 0.05 to a
            comp&apos;s score until level 7 (0.1), and only counts fully (0.15) from level 8.
          </p>
          <p>
            Artifacts and emblems point you at comps. A held one takes one of its wearer&apos;s item slots (the unit a guide
            puts it on, or the carry tactics.tools rates best with it), so that comp needs one fewer crafted item. It also
            adds 0.2 if TFT
            Academy builds it in that comp, plus the placement gain tactics.tools measures for it on the comp&apos;s
            carry (or, at half strength, another unit on its board). An emblem also helps comps that already run its
            trait. One item adds at most 0.4, and all of them together 0.45.
          </p>
        </div>
      </Panel>

      <Panel title="Your economy">
        <div className="space-y-3 text-sm text-muted">
          <p>
            Give your stage, gold and HP next to your level, and Dao TFT checks which comp styles you can still reach.
            It plays the game forward round by round, saving gold and taking free XP while you lose most fights, until
            you can buy up to the style&apos;s roll level (5 for a 1-cost reroll up to 9 for Fast 9) and still roll.
          </p>
          <p>
            A style you would reach only after its cutoff, or would die before reaching, is graded D and listed last. One
            you reach late or at a heavy HP cost drops a grade. At level 8 with 30 gold and 20 HP on 4-2, Fast 9 is out;
            at level 5 with 60 gold on 3-5, only 1- and 2-cost rerolls are realistic. These are estimates: streaks and
            board strength matter more than the projection early on, so nothing is called a stretch more than ten
            rounds ahead.
          </p>
        </div>
      </Panel>

      <Panel title="Augments and scouting">
        <div className="space-y-3 text-sm text-muted">
          <p>
            Augments are judged against your components, not a global tier list. An augment can lift a comp into your
            top 3 (<em>flex enabler</em>) or make one comp clearly the best line (<em>lock-in</em>). Some augments rule
            comps out instead: No Scout No Pivot locks in the units that fight, so no level 8-9 comp is playable with it.
          </p>
          <p>
            Scouting is manual: pick the comp each opponent is playing. A contested carry or frontline lowers a
            comp&apos;s score, and Dao TFT suggests uncontested comps that reuse your items.
          </p>
        </div>
      </Panel>

      <Panel title="Data and limits">
        <ul className="list-disc space-y-2 pl-5 text-sm text-muted">
          <li>
            Units, traits, items and augments come from Community Dragon (Set {snapshot.set}, fetched {snapshot.fetchedAt}).
            CI checks every comp against that snapshot, so a renamed or removed unit fails the build.
          </li>
          <li>
            The {comps.length} comps come from two places: a hand-curated set informed by the BunnyMuffins Patch 18.3b
            guide, with tiers updated to TFT Academy&apos;s 18.4b list, and the rest converted from that tier list (its
            Situational comps are listed as C tier). Treat tiers as editorial judgement, not statistics.
          </li>
          <li>Opener, slam and stage notes are short drafts. They are not a replacement for reading the full guides.</li>
          <li>Not yet built: patch history, a live overlay, and automatic scouting through the Riot API.</li>
        </ul>
      </Panel>
    </main>
  );
}
