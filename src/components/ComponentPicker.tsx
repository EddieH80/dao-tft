"use client";

import { catalog } from "@/data";
import { bagSize } from "@/engine/catalog";
import { useGame } from "@/store/useGame";
import { Icon } from "./Icon";
import { FlowNode } from "./flow";

const EXAMPLE = ["RecurveBow", "TearOfTheGoddess", "NeedlesslyLargeRod"];

const SHORT_NAME: Record<string, string> = {
  BFSword: "Sword",
  ChainVest: "Vest",
  FryingPan: "Pan",
  GiantsBelt: "Belt",
  NeedlesslyLargeRod: "Rod",
  NegatronCloak: "Cloak",
  RecurveBow: "Bow",
  SparringGloves: "Gloves",
  Spatula: "Spatula",
  TearOfTheGoddess: "Tear",
};

/** Snapshot order, with Spatula and Chain Vest swapped. */
const ORDER = (() => {
  const ids = [...catalog.componentIds];
  const a = ids.indexOf("Spatula");
  const b = ids.indexOf("ChainVest");
  if (a >= 0 && b >= 0) [ids[a], ids[b]] = [ids[b], ids[a]];
  return ids;
})();

export function ComponentPicker() {
  const components = useGame((s) => s.components);
  const add = useGame((s) => s.addComponent);
  const remove = useGame((s) => s.removeComponent);
  const total = bagSize(components);

  return (
    <FlowNode
      step={1}
      title="Your item components"
      hint={total ? `${total} component${total === 1 ? "" : "s"} · right-click to remove one` : "Click each component you are holding"}
    >
      <ul className="grid grid-cols-5 gap-2">
        {ORDER.map((id) => {
          const count = components[id] ?? 0;
          const name = catalog.componentName(id);
          return (
            <li key={id} className="flex flex-col items-center gap-1">
              <button
                onClick={() => add(id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  remove(id);
                }}
                aria-label={`Add ${name}`}
                className={`relative rounded-md border p-1 transition-colors ${
                  count ? "border-gold bg-panel-2" : "border-line hover:border-muted"
                }`}
              >
                <Icon src={catalog.componentIcon(id)} label={name} size={44} />
                {count > 0 && (
                  <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-xs font-bold text-ink">
                    {count}
                  </span>
                )}
              </button>
              <span className="text-[11px] leading-none text-muted">{SHORT_NAME[id] ?? name}</span>
              <button
                onClick={() => remove(id)}
                disabled={!count}
                aria-label={`Remove ${name}`}
                className="text-xs text-muted enabled:hover:text-bad disabled:opacity-30"
              >
                −
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 text-xs text-muted">
        <button
          onClick={() => EXAMPLE.forEach(add)}
          className={total ? "invisible" : "hover:text-gold-bright"}
        >
          Try Bow + Tear + Rod
        </button>
      </div>
    </FlowNode>
  );
}
