"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { bagSize } from "@/engine/catalog";
import { useGame } from "@/store/useGame";

/** How long the undo offer stays up after starting over. */
const UNDO_MS = 8000;

const BUTTON = "whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-xs text-muted hover:border-muted hover:text-gold-bright";

/** Clears the guided game from the header, with a short window to undo it. Does nothing until something is entered. */
export function StartOver() {
  const path = usePathname();
  const reset = useGame((s) => s.reset);
  const undo = useGame((s) => s.undo);
  const changes = useGame((s) => s.history.length);
  const entered = useGame(
    (s) =>
      bagSize(s.components) > 0 ||
      s.items.length > 0 ||
      s.board.length > 0 ||
      s.augments.length > 0 ||
      s.stage !== null ||
      s.gold !== null ||
      s.opponents.some(Boolean),
  );
  // Undo history length right after starting over; any later change withdraws the undo offer.
  // History is capped, so its length alone may not move; anything entered also ends the offer.
  const [resetAt, setResetAt] = useState<number | null>(null);
  const justReset = resetAt === changes && !entered;

  useEffect(() => {
    if (!justReset) return;
    const t = setTimeout(() => setResetAt(null), UNDO_MS);
    return () => clearTimeout(t);
  }, [justReset]);

  if (path !== "/") return null;

  if (justReset)
    return (
      <button
        onClick={() => {
          undo();
          setResetAt(null);
        }}
        title="Cleared for a new game. Click to bring it back."
        className={BUTTON}
      >
        <span role="status">Undo Reset</span>
      </button>
    );

  return (
    <button
      onClick={() => {
        reset();
        setResetAt(useGame.getState().history.length);
        window.scrollTo({ top: 0, behavior: "smooth" });
      }}
      disabled={!entered}
      title={entered ? "Clear components, items, board, augments and opponents" : "Nothing to reset yet"}
      className={`${BUTTON} disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:text-muted`}
    >
      Reset
    </button>
  );
}
