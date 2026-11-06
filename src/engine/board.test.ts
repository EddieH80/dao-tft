import { describe, expect, it } from "vitest";
import { TEAM_SIZE_ITEMS, extraSlots, fitBoard, teamSize } from "./board";
import { catalog } from "./fixtures";

describe("team size", () => {
  it("knows every Tactician's item, crafted from two Spatulas / Frying Pans", () => {
    for (const id of TEAM_SIZE_ITEMS) {
      const item = catalog.item(id);
      expect(item.kind).toBe("emblem");
      expect(item.components.every((c) => c === "Spatula" || c === "FryingPan")).toBe(true);
    }
    expect(new Set([...TEAM_SIZE_ITEMS].map((id) => catalog.item(id).components.join("+")))).toEqual(
      new Set(["FryingPan+Spatula", "Spatula+Spatula", "FryingPan+FryingPan"]),
    );
  });

  it("adds one slot per held copy", () => {
    expect(teamSize(3, [])).toBe(3);
    expect(teamSize(3, ["DA_TacticiansCrown"])).toBe(4);
    expect(teamSize(3, ["DA_TacticiansCrown", "DA_TacticiansCrown", "DA_TacticiansShield", "DA_InfinityEdge"])).toBe(6);
    expect(extraSlots(["DA_InfinityEdge"])).toBe(0);
  });

  it("drops the units added last when the board is over size", () => {
    const board = ["a", "b", "c", "d"];
    const fit = fitBoard(board, { b: 2, d: 3 }, 3, []);
    expect(fit).toEqual({ board: ["a", "b", "c"], stars: { b: 2 }, dropped: ["d"] });
    expect(fitBoard(board, {}, 3, ["DA_TacticiansCape"]).board).toBe(board);
  });
});
