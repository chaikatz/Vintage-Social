import { afterEach, describe, expect, it, vi } from "vitest";
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
  keyboardLift,
  madeNote,
  movedNote,
  takeOutMeta,
  takeOutTitle,
  takenOutNote,
} from "@/components/eraSheet";
import type { PostRow } from "@/types/db";
import type { AlertButton } from "@/utils/alert";

// The alerts as the browser has them (src/utils/alert.ts), and as Android has them where a
// test says so; nothing else here reaches React Native.
const rn = vi.hoisted(() => ({ Platform: { OS: "web" }, Alert: { alert: vi.fn(), prompt: vi.fn() } }));
vi.mock("react-native", () => rn);

/**
 * The sheet a member arranges their eras in, as it reads the arrangement:
 * what Move to offers a photograph (every era, New era… last, and the way
 * out of an era a move put it in), what ADD offers an era, what a new era
 * offers, when Create can be pressed, and the words said once a change is
 * made. And the browser's stand-in for a menu of several, which is how the
 * demo reaches "Add to an era…" among a post's options, and the same menu
 * as Android's dialog, which holds three buttons at most, can show it.
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

  it("lifts its foot over the keyboard by as far as the keyboard comes up from the foot of the screen", () => {
    // An iPhone 15: a screen 852 high, a sheet 59 below its top, a keyboard 336 high.
    // The whole of the keyboard, never the 277 measured from the sheet's own top.
    expect(keyboardLift(852 - 336, 852)).toBe(336);
    expect(keyboardLift(852 - 291.5, 852)).toBe(292);
    // Gone below the screen, or giving no place for itself: nothing.
    expect(keyboardLift(852, 852)).toBe(0);
    expect(keyboardLift(900, 852)).toBe(0);
    expect(keyboardLift(0, 852)).toBe(0);
    expect(keyboardLift(Number.NaN, 852)).toBe(0);
    expect(keyboardLift(500, 0)).toBe(0);
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

describe("a menu of several, in the browser", () => {
  async function menu(answer: string | null) {
    const { showAlert } = await import("@/utils/alert");
    const pressed: string[] = [];
    const asked: { message: string; preset: string | undefined }[] = [];
    vi.stubGlobal("window", {
      prompt: (message: string, preset?: string) => {
        asked.push({ message, preset });
        return answer;
      },
      confirm: () => {
        pressed.push("confirm asked");
        return true;
      },
      alert: () => undefined,
    });
    showAlert("Your post", undefined, [
      { text: "Edit caption", onPress: () => pressed.push("Edit caption") },
      { text: "Add to an era…", onPress: () => pressed.push("Add to an era…") },
      { text: "Delete post", style: "destructive", onPress: () => pressed.push("Delete post") },
      { text: "Cancel", style: "cancel", onPress: () => pressed.push("Cancel") },
    ]);
    vi.unstubAllGlobals();
    return { pressed, asked };
  }

  it("lists every one by number, the first written in, so OK alone does what it always did", async () => {
    const { pressed, asked } = await menu("1");
    expect(asked).toEqual([
      {
        message: "Your post\n\n1  Edit caption\n2  Add to an era…\n3  Delete post\n\nType the number of the one you want.",
        preset: "1",
      },
    ]);
    expect(pressed).toEqual(["Edit caption"]);
  });

  it("takes the one whose number is given", async () => {
    expect((await menu(" 2 ")).pressed).toEqual(["Add to an era…"]);
    expect((await menu("3")).pressed).toEqual(["Delete post"]);
  });

  it("cancels on Cancel, or on anything that is not one of the numbers", async () => {
    for (const answer of [null, "", "0", "4", "1.5", "two", "0x2", "-1"]) {
      expect((await menu(answer)).pressed, String(answer)).toEqual(["Cancel"]);
    }
  });

  it("still asks a single action as it did, OK or Cancel", async () => {
    const { showAlert } = await import("@/utils/alert");
    const pressed: string[] = [];
    let asked = "";
    vi.stubGlobal("window", {
      prompt: () => {
        throw new Error("no menu for one");
      },
      confirm: (message: string) => {
        asked = message;
        return true;
      },
    });
    showAlert("Delete this photograph?", "It’s removed for good.", [
      { text: "Delete", style: "destructive", onPress: () => pressed.push("Delete") },
      { text: "Cancel", style: "cancel", onPress: () => pressed.push("Cancel") },
    ]);
    vi.unstubAllGlobals();
    expect(asked).toBe("Delete this photograph?\n\nIt’s removed for good.\n\nOK → Delete");
    expect(pressed).toEqual(["Delete"]);
  });
});

describe("a menu of several, on Android", () => {
  type Shown = AlertButton;
  afterEach(() => {
    rn.Platform.OS = "web";
    rn.Alert.alert.mockReset();
  });
  /** What Android's dialog was given each time, and what each button and a dismissal did. */
  async function menu(os: string, buttons: Shown[]) {
    const { showAlert } = await import("@/utils/alert");
    rn.Platform.OS = os;
    showAlert("Your post", undefined, buttons);
    return rn.Alert.alert.mock.calls as [string, string | undefined, Shown[], { cancelable?: boolean; onDismiss?: () => void } | undefined][];
  }
  const pressed: string[] = [];
  const button = (text: string, style?: Shown["style"]): Shown => ({ text, style, onPress: () => void pressed.push(text) });
  const own = () => [button("Edit caption"), button("Add to an era…"), button("Delete post", "destructive"), button("Cancel", "cancel")];

  it("shows the three actions, Delete apart on the left, and closes on Back or a tap beside it, as Cancel", async () => {
    pressed.length = 0;
    const calls = await menu("android", own());
    expect(calls).toHaveLength(1);
    const [title, message, shown, options] = calls[0];
    expect([title, message]).toEqual(["Your post", undefined]);
    // Android puts the first on the left, apart, and the last on the right, where a confirm sits.
    expect(shown.map((b) => b.text)).toEqual(["Delete post", "Edit caption", "Add to an era…"]);
    expect(options?.cancelable).toBe(true);
    options?.onDismiss?.();
    shown[2].onPress?.();
    expect(pressed).toEqual(["Cancel", "Add to an era…"]);
  });

  it("never gives Android more than three, the last of them leading to the rest", async () => {
    pressed.length = 0;
    const five = ["One", "Two", "Three", "Four", "Five"].map((t) => button(t));
    const calls = await menu("android", [...five, button("Cancel", "cancel")]);
    expect(calls[0][2].map((b) => b.text)).toEqual(["One", "Two", "More…"]);
    calls[0][2][2].onPress?.();
    expect(calls).toHaveLength(2);
    expect(calls[1][2].map((b) => b.text)).toEqual(["Three", "Four", "Five"]);
    expect(calls[1][3]?.cancelable).toBe(true);
    calls[1][3]?.onDismiss?.();
    calls[1][2][1].onPress?.();
    expect(pressed).toEqual(["Cancel", "Four"]);
  });

  it("leaves a dialog of three or fewer as it was, and iOS's of any number", async () => {
    const confirm = [button("Delete", "destructive"), button("Cancel", "cancel")];
    expect(await menu("android", confirm)).toEqual([["Your post", undefined, confirm]]);
    rn.Alert.alert.mockReset();
    const four = own();
    expect(await menu("ios", four)).toEqual([["Your post", undefined, four]]);
  });
});
