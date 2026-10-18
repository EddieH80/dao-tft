import Link from "next/link";
import { catalog } from "@/data";
import type { HitTarget, Recommendation } from "@/engine/types";
import { Icon } from "./Icon";
import { FitBadge } from "./ui";

interface Props {
  ranking: Recommendation[];
  hits: Map<string, HitTarget[]>;
  stage: string | null;
  level: number;
  gold: number | null;
  goldEstimated: boolean;
  hp: number | null;
}

const SHOWN = 3;

const VERDICT: Record<string, { label: string; style: string }> = {
  stretch: { label: "Stretch", style: "text-warn" },
  unrealistic: { label: "Not realistic", style: "text-bad" },
};

/** The answer at a glance, for a player alt-tabbing out of a game: the top comps, one line each. */
export function LiveSummary({ ranking, hits, stage, level, gold, goldEstimated, hp }: Props) {
  const facts = [
    stage,
    `Level ${level}`,
    gold !== null && `${goldEstimated ? "~" : ""}${gold} gold`,
    hp !== null && `${hp} HP`,
  ].filter(Boolean);

  return (
    <section className="mx-auto mb-6 max-w-5xl rounded-lg border border-line bg-panel p-3" aria-label="Top comps">
      <p className="mb-2 text-xs text-muted">
        {facts.join(" · ")}
        {goldEstimated && <span> · gold is estimated, type it to correct</span>}
      </p>
      <ol className="space-y-1.5">
        {ranking.slice(0, SHOWN).map((rec, i) => {
          const carry = catalog.unit(rec.comp.carries[0]);
          const slam = rec.allocation.built.find((b) => !b.held);
          const hit = hits.get(rec.comp.slug)?.[0];
          const verdict = rec.unplayable.length ? VERDICT.unrealistic : rec.economy && VERDICT[rec.economy.verdict];
          return (
            <li key={rec.comp.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-3 text-muted">{i + 1}</span>
              <FitBadge fit={rec.fit} />
              <Icon src={carry.icon} label={carry.name} size={24} rounded="full" />
              <Link href={`/comp/${rec.comp.slug}`} className="font-semibold hover:text-gold">
                {rec.comp.name}
              </Link>
              {verdict && <span className={`text-xs ${verdict.style}`}>{verdict.label}</span>}
              <span className="text-xs text-muted">
                {slam ? (
                  <>
                    Slam <span className="text-good">{catalog.item(slam.item).name}</span>
                  </>
                ) : (
                  "Nothing to slam"
                )}
                {hit && (
                  <>
                    {" · "}Hit <span className="text-gold">{catalog.componentName(hit.component)}</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
