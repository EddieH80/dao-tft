import Link from "next/link";
import { catalog } from "@/data";
import { augmentStrength, type AugmentStrength } from "@/data/schema";
import type { HitTarget, Recommendation } from "@/engine/types";
import { REROLL_MISS } from "@/engine/router";
import { carrySwaps, openFrontline } from "@/engine/scout";
import { Icon } from "./Icon";
import { FitBadge, TagPill, TierPill } from "./ui";

interface Props {
  rec: Recommendation;
  rank: number;
  ranking: Recommendation[];
  contested: Record<string, number>;
  hits: HitTarget[];
  /** Augments the player has taken. */
  taken: string[];
}

const HITS_SHOWN = 3;

/** A bonus in fit grades, as the card says it: "half a fit grade", "one fit grade", "two fit grades". */
function grades(bonus: number): string {
  const n = Math.round((bonus / REROLL_MISS) * 2) / 2;
  if (n === 0.5) return "half a fit grade";
  return `${n === 1 ? "one" : n === 2 ? "two" : n} fit grade${n === 1 ? "" : "s"}`;
}

/** Augments worth calling out on a card; the comp page lists the merely good ones too. */
const CALLOUT: Partial<Record<AugmentStrength, { label: string; style: string }>> = {
  core: { label: "Core", style: "border-gold text-gold" },
  strong: { label: "Strong", style: "border-good text-good" },
  avoid: { label: "Avoid", style: "border-warn text-warn" },
  unplayable: { label: "Unplayable", style: "border-bad text-bad" },
};

export function RecommendationCard({ rec, rank, ranking, contested, hits, taken }: Props) {
  const { comp, allocation } = rec;
  const slams = allocation.built.filter((b) => !b.held);
  const held = allocation.built.filter((b) => b.held);
  const scout = { contested };
  const swaps = rec.scoutPenalty > 0 ? carrySwaps(comp, ranking, scout) : [];
  const frontline = rec.scoutPenalty > 0 ? openFrontline(comp, scout) : [];
  const carry = catalog.unit(comp.carries[0]);
  const callouts = comp.augmentModifiers
    .map((m) => ({ ...m, strength: augmentStrength(m) }))
    .filter((m) => CALLOUT[m.strength]);

  return (
    <article className="rounded-lg border border-line bg-panel p-4">
      <header>
        <div className="flex items-center gap-3">
          <span className="w-3 text-sm text-muted">{rank}</span>
          <Icon src={carry.icon} label={carry.name} size={44} rounded="full" />
          <div className="min-w-0 flex-1">
            <Link href={`/comp/${comp.slug}`} className="text-lg font-semibold leading-tight hover:text-gold">
              {comp.name}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <TierPill tier={comp.tier} />
              {rec.tags.map((t) => (
                <TagPill key={t} tag={t} />
              ))}
            </div>
          </div>
          <FitBadge fit={rec.fit} />
        </div>
        <p className="mt-2 text-sm text-muted">{comp.summary}</p>
        {rec.economy?.verdict === "unrealistic" && (
          <p className="mt-1 text-sm font-medium text-bad">✕ Not realistic for your economy. {rec.economy.note}</p>
        )}
        {rec.unplayable.map((n) => (
          <p key={n} className="mt-1 text-sm font-medium text-bad">
            ✕ Not playable with your augments. {n}
          </p>
        ))}
      </header>

      <div className="mt-3 space-y-3">
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-good">Slam now</h3>
          {slams.length ? (
            <ul className="space-y-1.5">
              {slams.map((b) => {
                const item = catalog.item(b.item);
                const note = comp.slams.find((s) => s.item === b.item)?.note;
                return (
                  <li key={b.item + b.unit} className="flex items-start gap-2 text-sm">
                    <Icon src={item.icon} label={item.name} size={24} />
                    <div>
                      <p>
                        {item.name} <span className="text-xs text-muted">on {catalog.unit(b.unit).name}</span>
                      </p>
                      <p className="text-xs text-muted">
                        {b.uses.map((c) => catalog.componentName(c)).join(" + ")}
                        {note && <span className="text-gold-bright"> · {note}</span>}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">Nothing completes for this comp yet. Hold your components.</p>
          )}
          {held.length > 0 && (
            <p className="mt-1 text-xs text-muted">
              Already holding{" "}
              {held
                .map(
                  (b) =>
                    `${catalog.holdable(b.item)?.name ?? b.item} for ${catalog.unit(b.unit).name}` +
                    (b.replaces ? ` (in place of ${catalog.item(b.replaces).name})` : ""),
                )
                .join(", ")}
              .
            </p>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-gold">Hit next</h3>
          {hits.length ? (
            <ul className="space-y-1">
              {hits.slice(0, HITS_SHOWN).map((t) => {
                const name = catalog.componentName(t.component);
                return (
                  <li key={t.component} className="flex items-center gap-2 text-sm">
                    <Icon src={catalog.componentIcon(t.component)} label={name} size={24} />
                    <span>{name}</span>
                    <span className="text-xs text-muted">
                      {t.unlocks.length > 0
                        ? `completes ${t.unlocks.map((i) => catalog.item(i).name).join(", ")}`
                        : t.toward
                          ? `toward ${catalog.item(t.toward).name}`
                          : "adds item progress"}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted">No single component moves this comp forward.</p>
          )}
        </div>
        <div>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-warn">Still missing</h3>
          <ul className="space-y-1">
            {allocation.pending.slice(0, 3).map((p) => (
              <li key={p.item + p.unit} className="flex flex-wrap items-center gap-x-2 text-sm">
                <span>{catalog.item(p.item).name}</span>
                <span className="text-xs text-muted">
                  needs {p.need.map((c) => catalog.componentName(c)).join(" + ")}
                  {p.have.length > 0 && ` (have ${p.have.map((c) => catalog.componentName(c)).join(", ")})`}
                </span>
              </li>
            ))}
          </ul>
        </div>
        {callouts.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">Augments</h3>
            <ul className="space-y-1.5">
              {callouts.map((m) => {
                const name = catalog.augmentName(m.augment);
                const { label, style } = CALLOUT[m.strength]!;
                return (
                  <li key={m.augment} className="flex items-start gap-2 text-sm">
                    <Icon src={catalog.augmentIcon(m.augment)} label={name} size={24} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <span className={taken.includes(m.augment) ? "font-semibold text-gold-bright" : ""}>{name}</span>
                        <span className={`rounded border px-1 text-[10px] uppercase tracking-wide ${style}`}>{label}</span>
                        {taken.includes(m.augment) && <span className="text-xs text-gold">taken</span>}
                      </p>
                      <p className="text-xs text-muted">{m.note}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {(rec.itemNotes.length > 0 ||
        rec.augmentNotes.length > 0 ||
        rec.scoutPenalty > 0 ||
        rec.rerollPenalty > 0 ||
        rec.starredCarry !== null ||
        rec.orphanItems.length > 0 ||
        rec.economy?.verdict === "stretch" ||
        rec.boardMatches.length > 0) && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
          {rec.itemNotes.map((n) => (
            <li key={n} className="text-good">
              + {n}
            </li>
          ))}
          {rec.boardMatches.length > 0 && (
            <li className="text-good">
              + Your board already plays {rec.boardMatches.map((u) => catalog.unit(u).name).join(", ")}.
            </li>
          )}
          {rec.starredCarry && (
            <li className="text-good">
              + Your {catalog.unit(rec.starredCarry.unit).name} is already {rec.starredCarry.stars}-star, so this reroll
              comp is ranked {grades(rec.starBonus)} higher.
            </li>
          )}
          {rec.augmentNotes.map((n) => (
            <li key={n} className="text-good">
              + {n}
            </li>
          ))}
          {[...new Set(rec.orphanItems)].map((id) => (
            <li key={id} className="text-bad">
              − No unit in this comp uses your {catalog.holdable(id)?.name ?? id} well, so it is ranked lower.
            </li>
          ))}
          {rec.economy?.verdict === "stretch" && (
            <li className="text-warn">− A stretch for your economy, so it is ranked one fit grade lower. {rec.economy.note}</li>
          )}
          {rec.rerollPenalty > 0 && (
            <li className="text-bad">
              − Your board has no {comp.carries.map((u) => catalog.unit(u).name).join(" or ")}. Reroll comps need
              their carries early, so it is ranked one fit grade lower.
            </li>
          )}
          {rec.scoutPenalty > 0 && (
            <li className="text-bad">− Opponents are playing this comp&apos;s units, so it is ranked lower.</li>
          )}
          {swaps.length > 0 && (
            <li className="text-muted">
              Same items, less contested:{" "}
              {swaps.map((s, i) => (
                <span key={s.comp.slug}>
                  {i > 0 && ", "}
                  <Link href={`/comp/${s.comp.slug}`} className="text-gold-bright underline decoration-line">
                    {s.comp.name}
                  </Link>{" "}
                  ({s.sharedItems.map((i) => catalog.item(i).name).join(", ")})
                </span>
              ))}
            </li>
          )}
          {frontline.length > 0 && (
            <li className="text-muted">
              Open frontline options: {frontline.map((u) => catalog.unit(u).name).join(", ")}
            </li>
          )}
        </ul>
      )}
    </article>
  );
}
