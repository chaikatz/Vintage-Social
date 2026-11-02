import { describe, expect, it } from "vitest";
import { NEW_ERA, NEW_ERA_TITLE, NOT_IN_AN_ERA, NO_EDITS, createEra, moveToEra, type EraEdits } from "@/utils/eraEdits";
import {
  CREATE,
  NEW_ERA_HEAD,
  addConfirm,
  addHead,
  addedNote,
  canCreate,
  chosenCount,
  deletedNote,
  eraSheetView,
  madeNote,
  movedNote,
  takeOutMeta,
  takeOutTitle,
  takenOutNote,
} from "@/components/eraSheet";
import type { PostRow } from "@/types/db";

/**
 * The sheet a member arranges their eras in, as it reads the arrangement:
 * what Move to offers a photograph (every era, New era… last, and the way
 * out of an era a move put it in), what ADD offers an era, what a new era
 * offers, when Create can be pressed, and the words said once a change is
 * made.
 */

const post = (id: string, taken: string | null, location: string | null = null) =>
  ({ id, taken_at: taken, created_at: "2026-09-01T12:00:00", location }) as unknown as PostRow;

// Kyoto 2024 (k1, k2), Lisbon 2023 (l1, l2), and one photograph on its own.
const rows = [
  post("k1", "2024-03-02T12:00:00", "Kyoto"),
  post("k2", "2024-03-05T12:00:00", "Kyoto"),
  post("l1", "2023-05-02T12:00:00", "Lisbon"),
  post("l2", "2023-05-20T12:00:00", "Lisbon"),
  post("alone", "2022-01-10T12:00:00", "Bar Pitti"),
];
const byId = (id: string) => rows.find((p) => p.id === id)!;
const K = "~trip000001";

describe("Move to", () => {
  it("offers every era, the one it is in marked, and New era… last", () => {
    const view = eraSheetView(rows, NO_EDITS, { kind: "move", post: byId("k1") });
    expect(view?.kind).toBe("move");
    if (view?.kind !== "move") return;
    expect(view.choices.map((c) => [c.title, c.here, c.newEra])).toEqual([
      ["Kyoto 2024", true, false],
      ["Lisbon 2023", false, false],
      [NEW_ERA_TITLE, false, true],
    ]);
    expect(view.choices.at(-1)?.key).toBe(NEW_ERA);
    expect(view.post).toBe(byId("k1"));
  });

  it("offers no way out of an era the photograph fell in of itself", () => {
    const view = eraSheetView(rows, NO_EDITS, { kind: "move", post: byId("l1") });
    expect(view?.kind === "move" && view.out).toBeNull();
  });

  it("offers the way back for one a move put where it is: to its own era, or to none", () => {
    const moved = moveToEra(NO_EDITS, rows, "k1", "Lisbon 2023");
    const back = eraSheetView(rows, moved, { kind: "move", post: byId("k1") });
    expect(back?.kind === "move" && back.out).toEqual({ from: "Lisbon 2023", back: "Kyoto 2024" });

    const alone = moveToEra(NO_EDITS, rows, "alone", "Kyoto 2024");
    const none = eraSheetView(rows, alone, { kind: "move", post: byId("alone") });
    expect(none?.kind === "move" && none.out).toEqual({ from: "Kyoto 2024", back: null });
  });

  it("names the era by the name the member gave it", () => {
    const named: EraEdits = { titles: { "Lisbon 2023": "The long summer" }, moves: { k1: "Lisbon 2023" } };
    const view = eraSheetView(rows, named, { kind: "move", post: byId("k1") });
    expect(view?.kind === "move" && view.out).toEqual({ from: "The long summer", back: "Kyoto 2024" });
  });
});

describe("ADD", () => {
  it("offers every photograph not in the era, those in none first, then by era", () => {
    const view = eraSheetView(rows, NO_EDITS, { kind: "add", key: "Kyoto 2024" });
    expect(view?.kind).toBe("add");
    if (view?.kind !== "add") return;
    expect(view.title).toBe("Kyoto 2024");
    expect(view.groups.map((g) => [g.title, g.posts.map((p) => p.id)])).toEqual([
      [NOT_IN_AN_ERA, ["alone"]],
      ["Lisbon 2023", ["l2", "l1"]],
    ]);
  });

  it("is headed by the name the era shows", () => {
    const view = eraSheetView(rows, { titles: { "Kyoto 2024": "Cherry blossom" }, moves: {} }, { kind: "add", key: "Kyoto 2024" });
    expect(view?.kind === "add" && view.title).toBe("Cherry blossom");
  });

  it("is nothing once its era has gone from the page, so the sheet closes", () => {
    expect(eraSheetView(rows, NO_EDITS, { kind: "add", key: "Paris 2020" })).toBeNull();
    expect(eraSheetView(rows, NO_EDITS, null)).toBeNull();
  });
});

describe("a new era", () => {
  it("offers every photograph, with those already chosen", () => {
    const view = eraSheetView(rows, NO_EDITS, { kind: "new", chosen: ["k1"] });
    expect(view?.kind).toBe("new");
    if (view?.kind !== "new") return;
    expect(view.chosen).toEqual(["k1"]);
    expect(view.groups.flatMap((g) => g.posts.map((p) => p.id)).sort()).toEqual(["alone", "k1", "k2", "l1", "l2"]);
  });

  it("can be made with a name left once cleaned, and a photograph", () => {
    expect(canCreate("Saturdays", ["k1"])).toBe(true);
    expect(canCreate("Saturdays", [])).toBe(false);
    expect(canCreate("   ", ["k1"])).toBe(false);
    expect(canCreate("\n\t", ["k1"])).toBe(false);
    expect(canCreate("", [])).toBe(false);
  });

  it("is offered among the eras once made, under its name", () => {
    const made = createEra(NO_EDITS, rows, "Saturdays", ["l1"], () => K).edits;
    const view = eraSheetView(rows, made, { kind: "add", key: K });
    expect(view?.kind === "add" && view.title).toBe("Saturdays");
  });
});

describe("the words", () => {
  it("say what the button does, and how many", () => {
    expect(addHead("Kyoto 2024")).toBe("Add to Kyoto 2024");
    expect(addConfirm(0)).toBe("Add");
    expect(addConfirm(3)).toBe("Add 3");
    expect(NEW_ERA_HEAD).toBe("New era");
    expect(CREATE).toBe("Create");
    expect(chosenCount(0)).toBe("None chosen yet");
    expect(chosenCount(1)).toBe("1 photograph");
    expect(chosenCount(4)).toBe("4 photographs");
  });

  it("say where a photograph goes back to", () => {
    expect(takeOutTitle({ from: "Saturdays", back: "Kyoto 2024" })).toBe("Take out of Saturdays");
    expect(takeOutMeta({ from: "Saturdays", back: "Kyoto 2024" })).toBe("Back to Kyoto 2024");
    expect(takeOutMeta({ from: "Saturdays", back: null })).toBe("Back to no era, where it was");
  });

  it("say what was done, once it was", () => {
    expect(movedNote("Kyoto 2024")).toBe("Moved to Kyoto 2024");
    expect(addedNote(3, "Kyoto 2024")).toBe("Added 3 to Kyoto 2024");
    expect(madeNote("  Saturdays \n")).toBe("Made Saturdays");
    expect(takenOutNote({ from: "Saturdays", back: "Kyoto 2024" })).toBe("Back in Kyoto 2024");
    expect(takenOutNote({ from: "Saturdays", back: null })).toBe("Taken out of Saturdays");
    expect(deletedNote("Saturdays")).toBe("Deleted Saturdays");
  });
});
