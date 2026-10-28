import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { compBySlug, economyModel } from "@/data";
import { advanceRound, starsOn, type QuickState } from "@/engine/quick";
import { scoutFromOpponents } from "@/engine/scout";
import type { AugmentId, ComponentId, GameState, ItemId, ScoutState, StarLevel, UnitId } from "@/engine/types";

export const OPPONENTS = 7;
export const LEVELS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Changes that can be undone. */
const HISTORY = 30;
/** Keystrokes in one field this close together undo as one change. */
const COALESCE_MS = 1000;

/** Everything about the game in progress: what is saved, and what undo restores. */
interface Game extends Omit<GameState, "scout"> {
  /** Comp slug each opponent is playing, or null if unknown. */
  opponents: (string | null)[];
  /** The flow moves on without a board / augment when the player says they have none yet. */
  boardSkipped: boolean;
  augmentSkipped: boolean;
  /** Gold was projected by "next round" rather than entered, so it may be off. */
  goldEstimated: boolean;
}

interface GameStore extends Game {
  history: Game[];
  /** Player level caps how many units can be on the board. */
  setLevel: (level: number) => void;
  setGold: (gold: number | null) => void;
  setHp: (hp: number | null) => void;
  setStage: (stage: string | null) => void;
  addComponent: (id: ComponentId) => void;
  removeComponent: (id: ComponentId) => void;
  addItem: (id: ItemId) => void;
  removeItem: (id: ItemId) => void;
  toggleUnit: (id: UnitId) => void;
  /** Star level of a unit already on the board. */
  setStars: (id: UnitId, stars: StarLevel) => void;
  skipBoard: () => void;
  skipAugment: () => void;
  /**
   * Select or deselect the augment for one selection (0 = 2-1, 1 = 3-2, 2 = 4-2).
   * Selections fill in order, so `augments[i]` is always the pick at selection i.
   */
  pickAugment: (selection: number, id: AugmentId) => void;
  setOpponent: (index: number, slug: string | null) => void;
  /** Applies a state worked out by the quick bar (`runQuick`). */
  apply: (next: QuickState) => void;
  /** Moves to the next round, adding a round's income to gold as an estimate. */
  nextRound: () => void;
  undo: () => void;
  reset: () => void;
}

export const initial: Game = {
  components: {},
  items: [],
  board: [],
  stars: {},
  level: 4,
  gold: null,
  goldEstimated: false,
  hp: null,
  stage: null,
  boardSkipped: false,
  augmentSkipped: false,
  augments: [],
  opponents: Array<string | null>(OPPONENTS).fill(null),
};
const GAME_KEYS = Object.keys(initial) as (keyof Game)[];
const gameOf = (s: Game): Game => Object.fromEntries(GAME_KEYS.map((k) => [k, s[k]])) as unknown as Game;

/** The quick bar's view of the game. */
export const quickStateOf = (s: Game): QuickState => ({
  components: s.components,
  items: s.items,
  board: s.board,
  stars: s.stars,
  augments: s.augments,
  level: s.level,
  gold: s.gold,
  goldEstimated: s.goldEstimated,
  hp: s.hp,
  stage: s.stage,
});

let last = { key: "", at: 0 };

export const useGame = create<GameStore>()(
  persist<GameStore, [], [], Game>(
    (set) => {
      /**
       * Every change goes through here so it can be undone. A change that returns
       * the state unchanged records nothing; repeats of one `coalesce` key in quick
       * succession (typing "52" into the gold field) undo together.
       */
      const change = (fn: (s: GameStore) => Partial<Game> | GameStore, coalesce = "") =>
        set((s) => {
          const patch = fn(s);
          if (patch === s) return s;
          const now = Date.now();
          const merge = coalesce !== "" && last.key === coalesce && now - last.at < COALESCE_MS;
          last = { key: coalesce, at: now };
          return merge ? patch : { ...patch, history: [...s.history, gameOf(s)].slice(-HISTORY) };
        });

      return {
        ...initial,
        history: [],
        addComponent: (id) => change((s) => ({ components: { ...s.components, [id]: (s.components[id] ?? 0) + 1 } })),
        removeComponent: (id) =>
          change((s) => {
            if (!s.components[id]) return s;
            const next = { ...s.components, [id]: s.components[id] - 1 };
            if (!next[id]) delete next[id];
            return { components: next };
          }),
        addItem: (id) => change((s) => ({ items: [...s.items, id] })),
        removeItem: (id) =>
          change((s) => {
            const i = s.items.lastIndexOf(id);
            return i < 0 ? s : { items: s.items.filter((_, j) => j !== i) };
          }),
        setLevel: (level) =>
          change((s) => {
            if (s.level === level) return s;
            const board = s.board.slice(0, level);
            return { level, board, stars: starsOn(board, s.stars) };
          }),
        setGold: (gold) => change((s) => (s.gold === gold ? s : { gold, goldEstimated: false }), "gold"),
        setHp: (hp) => change((s) => (s.hp === hp ? s : { hp }), "hp"),
        setStage: (stage) => change((s) => (s.stage === stage ? s : { stage })),
        toggleUnit: (id) =>
          change((s) => {
            if (s.board.includes(id)) {
              const board = s.board.filter((u) => u !== id);
              return { board, stars: starsOn(board, s.stars) };
            }
            return s.board.length < s.level ? { board: [...s.board, id] } : s;
          }),
        setStars: (id, stars) =>
          change((s) =>
            !s.board.includes(id) || (s.stars[id] ?? 1) === stars
              ? s
              : { stars: starsOn(s.board, { ...s.stars, [id]: stars }) },
          ),
        skipBoard: () => change((s) => (s.boardSkipped ? s : { boardSkipped: true })),
        skipAugment: () => change((s) => (s.augmentSkipped ? s : { augmentSkipped: true })),
        pickAugment: (selection, id) =>
          change((s) => {
            // Clearing a pick also clears the later ones, which depended on it.
            if (s.augments[selection] === id) return { augments: s.augments.slice(0, selection) };
            if (selection > s.augments.length || s.augments.some((a, i) => a === id && i !== selection)) return s;
            return { augments: [...s.augments.slice(0, selection), id, ...s.augments.slice(selection + 1)] };
          }),
        setOpponent: (index, slug) =>
          change((s) => ({ opponents: s.opponents.map((o, i) => (i === index ? slug : o)) })),
        apply: (next) => change(() => next),
        nextRound: () => change((s) => advanceRound(quickStateOf(s), economyModel)),
        undo: () =>
          set((s) => {
            if (!s.history.length) return s;
            last = { key: "", at: 0 };
            return { ...s.history.at(-1)!, history: s.history.slice(0, -1) };
          }),
        reset: () => change(() => initial),
      };
    },
    {
      name: "dao-tft-game",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => gameOf(s),
      // Rehydrated in RouterApp after mount, so the static HTML matches the first render.
      skipHydration: true,
    },
  ),
);

/** Units the lobby is contesting, from the comps picked for each opponent. */
export function useScout(): ScoutState {
  const opponents = useGame((s) => s.opponents);
  return useMemo(() => scoutFromOpponents(opponents.map((slug) => (slug ? compBySlug(slug) : undefined))), [opponents]);
}
