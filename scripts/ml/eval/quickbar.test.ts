import { describe, expect, it } from "vitest";
import { StateUpdateSchema } from "../../../src/assistant/contract";
import { buildVocab } from "../vocab";
import { quickbarUpdate } from "./quickbar";

const lexicon = buildVocab().lexicon;
const strict = (t: string) => quickbarUpdate(t, lexicon, { lenient: false });
const lenient = (t: string) => quickbarUpdate(t, lexicon, { lenient: true });

describe("quick-bar baseline", () => {
  it("reads quick-bar lines as the contract labels them (A35-A40)", () => {
    expect(strict("52")).toEqual({ gold: 52 });
    expect(strict("52 l7 n")).toEqual({ level: 7, next: true, gold: 52 });
    expect(strict("n 38 h71 ie")).toEqual({ next: true, gold: 38, hp: 71, craft: [{ name: "ie" }] });
    // Jinx and Kog'Maw aren't in Set 18, so A38 uses Akali and Veigar.
    expect(strict("l8 bow -akali +ie veigar2")).toEqual({
      level: 8,
      remove: [{ name: "akali" }],
      add: [{ name: "ie" }],
      craft: [{ name: "bow" }, { name: "veigar", stars: 2 }],
    });
    expect(strict("veigar2")).toEqual({ craft: [{ name: "veigar", stars: 2 }] });
    expect(strict("u")).toEqual({ undo: true });
    expect(strict(" Undo ")).toEqual({ undo: true });
  });

  it("keeps names as typed and merges repeats into a count", () => {
    expect(strict("bow bow")).toEqual({ craft: [{ name: "bow", count: 2 }] });
    expect(strict("IE ie")).toEqual({ craft: [{ name: "IE", count: 2 }] });
    expect(strict("4-2 l7")).toEqual({ level: 7, stage: "4-2" });
  });

  it("gives {} for any word the quick bar can't read; lenient keeps the rest", () => {
    // "got", "bows" (no plural fallback in the quick bar), "and", "a" are unknown; 2 is gold.
    expect(strict("got 2 bows and a sword")).toEqual({});
    expect(lenient("got 2 bows and a sword")).toEqual({ gold: 2, craft: [{ name: "sword" }] });
  });

  it("fails what runQuick fails without a state", () => {
    expect(strict("g300 ie")).toEqual({}); // gold over 250
    expect(lenient("g300 ie")).toEqual({ craft: [{ name: "ie" }] });
    expect(strict("l11 ie")).toEqual({}); // level outside 2-10
    expect(strict("h101")).toEqual({});
    expect(strict("9-1 ie")).toEqual({}); // no such stage
    expect(strict("ie2")).toEqual({}); // a star level on an item
    expect(strict("-veigar2")).toEqual({}); // remove takes no star level
  });

  it("only outputs schema-valid labels", () => {
    for (const t of ["52", "n 38 h71 ie", "bow bow sword", "got 2 bows and a sword", "", "u"]) {
      expect(StateUpdateSchema.safeParse(lenient(t)).success, t).toBe(true);
    }
  });
});
