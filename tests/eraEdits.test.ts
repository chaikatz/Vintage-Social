import { describe, expect, it } from "vitest";
import {
  ERA_TITLE_MAX,
  NO_EDITS,
  cleanEraTitle,
  editEras,
  editedEraOf,
  editedEraSummary,
  moveChoices,
  moveToEra,
  readEdits,
  renameEra,
  sameEdits,
  type EraEdits,
} from "@/utils/eraEdits";
import { eraSummary, groupEras } from "@/utils/memories";
import { galleryRows } from "@/utils/profileViews";
import { eraHeading, eraMeta, eraSpan, eraSpanSpoken, erasEmpty } from "@/components/eraBook";

/**
 * A member's own arrangement of their eras, laid over the automatic
 * reading: names given and taken back, photographs moved and moved home,
 * moves that have gone stale, eras emptied or left with one, the order of
 * it all, the counts the foot of the page gives, and the gallery an
 * edited era opens. Dates are local-time strings, so none of this depends
 * on the zone.
 */

const post = (id: string, taken: string | null, location: string | null = null, created = "2026-09-01T12:00:00") => ({
  id,
  taken_at: taken,
  created_at: created,
  location,
});

// Three automatic eras, newest first: Kyoto 2024 (k1, k2), Lisbon 2023
// (l1, l2, l3), Summer 2021 (s1, s2); one photograph on its own (alone)
// and one without a date (undated).
const rows = [
  post("k1", "2024-03-02T12:00:00", "Kyoto"),
  post("k2", "2024-03-05T12:00:00", "Kyoto"),
  post("l1", "2023-05-02T12:00:00", "Lisbon"),
  post("l2", "2023-05-20T12:00:00", "Lisbon"),
  post("l3", "2023-06-11T12:00:00", "Lisbon"),
  post("s1", "2021-07-10T12:00:00"),
  post("s2", "2021-07-20T12:00:00"),
  post("alone", "2022-01-10T12:00:00", "Bar Pitti"),
  post("undated", null),
];

const edits = (titles: Record<string, string> = {}, moves: Record<string, string> = {}): EraEdits => ({ titles, moves });
const shape = (eras: { key: string; title: string; posts: { id: string }[] }[]) =>
  eras.map((e) => `${e.title} [${e.key}]: ${e.posts.map((p) => p.id).join(" ")}`);

describe("with no changes", () => {
  it("are exactly groupEras's eras, each keyed by its own title", () => {
    const automatic = groupEras(rows);
    const edited = editEras(rows);
    expect(edited.map(({ key, renamed, ...era }) => era)).toEqual(automatic);
    expect(edited.every((e) => e.key === e.title && !e.renamed)).toBe(true);
    expect(editEras(rows, NO_EDITS)).toEqual(edited);
  });

  it("count what they leave out as eraSummary does", () => {
    const { eras, ...counts } = editedEraSummary(rows);
    const { eras: automatic, ...before } = eraSummary(rows);
    expect(counts).toEqual(before);
    expect(counts).toEqual({ undated: 1, apart: 1 });
    expect(eras).toHaveLength(automatic.length);
  });
});

describe("a name the member gives", () => {
  it("shows in place of the automatic one, the key unchanged", () => {
    const [kyoto] = editEras(rows, edits({ "Kyoto 2024": "Cherry blossom week" }));
    expect(kyoto).toMatchObject({ key: "Kyoto 2024", title: "Cherry blossom week", renamed: true });
    expect(eraHeading(kyoto)).toBe("Cherry blossom week, 2 photographs");
  });

  it("is cleaned as it is kept: one line, closed up, at most sixty characters", () => {
    expect(cleanEraTitle("  The   long\n weekend  ")).toBe("The long weekend");
    expect(cleanEraTitle("   ")).toBe("");
    expect(Array.from(cleanEraTitle("é".repeat(80)))).toHaveLength(ERA_TITLE_MAX);
    // An emoji counts as one character and is never cut in half.
    const flags = cleanEraTitle("🗼".repeat(70));
    expect(Array.from(flags)).toHaveLength(ERA_TITLE_MAX);
    expect(flags).toBe("🗼".repeat(ERA_TITLE_MAX));
  });

  it("goes back to the automatic name when cleared, given as the automatic name, or reset", () => {
    const named = renameEra(NO_EDITS, "Kyoto 2024", "  Cherry   blossom week ");
    expect(named.titles).toEqual({ "Kyoto 2024": "Cherry blossom week" });
    for (const back of [null, "", "   ", "Kyoto 2024"]) {
      const reset = renameEra(named, "Kyoto 2024", back);
      expect(reset.titles).toEqual({});
      expect(editEras(rows, reset)[0]).toMatchObject({ title: "Kyoto 2024", renamed: false });
    }
  });

  it("leaves the other names and the moves as they were, and the edits it was given untouched", () => {
    const before = edits({ "Lisbon 2023": "Lisbon, slowly" }, { s1: "Lisbon 2023" });
    const after = renameEra(before, "Kyoto 2024", "Spring");
    expect(after).toEqual(edits({ "Lisbon 2023": "Lisbon, slowly", "Kyoto 2024": "Spring" }, { s1: "Lisbon 2023" }));
    expect(before.titles).toEqual({ "Lisbon 2023": "Lisbon, slowly" });
  });

  it("for an era that is not there is kept but shown nowhere", () => {
    expect(shape(editEras(rows, edits({ "Paris 1999": "Paris" })))).toEqual(shape(editEras(rows)));
  });

  it("may be the same as another era's: the keys keep them apart", () => {
    const twins = editEras(rows, edits({ "Kyoto 2024": "Away", "Lisbon 2023": "Away" }));
    expect(twins.filter((e) => e.title === "Away").map((e) => e.key)).toEqual(["Kyoto 2024", "Lisbon 2023"]);
  });
});

describe("a photograph the member moves", () => {
  it("leaves its era for the one it was moved into, newest capture first there", () => {
    const moved = editEras(rows, edits({}, { l3: "Kyoto 2024" }));
    expect(shape(moved)).toEqual([
      "Kyoto 2024 [Kyoto 2024]: k2 k1 l3",
      "Lisbon 2023 [Lisbon 2023]: l2 l1",
      "Summer 2021 [Summer 2021]: s2 s1",
    ]);
  });

  it("orders the eras by their newest capture once it has moved", () => {
    // Summer 2021 takes the newest Kyoto photograph and comes first.
    const moved = editEras(rows, edits({}, { k2: "Summer 2021" }));
    expect(moved.map((e) => e.key)).toEqual(["Summer 2021", "Kyoto 2024", "Lisbon 2023"]);
    expect(moved[0].posts.map((p) => p.id)).toEqual(["k2", "s2", "s1"]);
    expect(moved[0].latest).toEqual(new Date("2024-03-05T12:00:00"));
  });

  it("empties an era of its last photographs, and the era goes", () => {
    const moved = editEras(rows, edits({}, { s1: "Lisbon 2023", s2: "Lisbon 2023" }));
    expect(moved.map((e) => e.key)).toEqual(["Kyoto 2024", "Lisbon 2023"]);
    expect(moved[1].posts.map((p) => p.id)).toEqual(["l3", "l2", "l1", "s2", "s1"]);
  });

  it("leaves an era of one where one is left: the member's choice, not a photograph lost", () => {
    const moved = editEras(rows, edits({}, { k2: "Lisbon 2023" }));
    expect(moved.find((e) => e.key === "Kyoto 2024")?.posts.map((p) => p.id)).toEqual(["k1"]);
  });

  it("can bring in a photograph that was on its own, but never one without a date", () => {
    const moved = editEras(rows, edits({}, { alone: "Summer 2021", undated: "Summer 2021" }));
    expect(moved.find((e) => e.key === "Summer 2021")?.posts.map((p) => p.id)).toEqual(["alone", "s2", "s1"]);
  });

  it("is let go when its photograph is gone, or its era is: a stale change breaks nothing", () => {
    const stale = edits({}, { deleted: "Kyoto 2024", l1: "Paris 1999", l2: "" });
    expect(shape(editEras(rows, stale))).toEqual(shape(editEras(rows)));
  });

  it("into the era it is already in changes nothing", () => {
    expect(shape(editEras(rows, edits({}, { l1: "Lisbon 2023" })))).toEqual(shape(editEras(rows)));
  });

  it("finds the era it was moved into among emptied ones too, since every automatic era stays a place to go", () => {
    // Both of Summer 2021's moved out; then one moved back.
    const out = edits({}, { s1: "Kyoto 2024", s2: "Kyoto 2024" });
    expect(editEras(rows, out).some((e) => e.key === "Summer 2021")).toBe(false);
    const back = moveToEra(out, rows, "s1", "Summer 2021");
    expect(back.moves).toEqual({ s2: "Kyoto 2024" });
    expect(editEras(rows, back).find((e) => e.key === "Summer 2021")?.posts.map((p) => p.id)).toEqual(["s1"]);
  });
});

describe("moving, as the member does it", () => {
  it("records the move, and forgets it once the photograph is moved home again", () => {
    const there = moveToEra(NO_EDITS, rows, "l1", "Kyoto 2024");
    expect(there.moves).toEqual({ l1: "Kyoto 2024" });
    expect(moveToEra(there, rows, "l1", "Lisbon 2023").moves).toEqual({});
  });

  it("refuses an era the reading does not make, and a photograph not among the rows", () => {
    expect(moveToEra(NO_EDITS, rows, "l1", "Paris 1999")).toBe(NO_EDITS);
    expect(moveToEra(NO_EDITS, rows, "gone", "Kyoto 2024")).toBe(NO_EDITS);
  });

  it("lets go of the moves of deleted photographs on the way, and keeps the names", () => {
    const old = edits({ "Kyoto 2024": "Spring" }, { deleted: "Kyoto 2024", s1: "Lisbon 2023" });
    expect(moveToEra(old, rows, "l1", "Kyoto 2024")).toEqual(
      edits({ "Kyoto 2024": "Spring" }, { s1: "Lisbon 2023", l1: "Kyoto 2024" }),
    );
  });

  it("offers every era, as the page orders them, the one it is in marked, then any emptied", () => {
    const out = edits({ "Summer 2021": "That summer" }, { s1: "Kyoto 2024", s2: "Kyoto 2024" });
    const choices = moveChoices(rows, out, "l2");
    expect(choices.map((c) => [c.key, c.title, c.here, c.era?.posts.length ?? 0])).toEqual([
      ["Kyoto 2024", "Kyoto 2024", false, 4],
      ["Lisbon 2023", "Lisbon 2023", true, 3],
      ["Summer 2021", "That summer", false, 0],
    ]);
  });
});

describe("the counts at the foot of the page", () => {
  it("stay honest: every photograph in one era, or counted once as undated or on its own", () => {
    const cases: EraEdits[] = [
      NO_EDITS,
      edits({}, { l3: "Kyoto 2024" }),
      edits({}, { s1: "Lisbon 2023", s2: "Lisbon 2023" }),
      edits({}, { alone: "Summer 2021" }),
      edits({}, { undated: "Summer 2021", deleted: "Kyoto 2024" }),
    ];
    for (const c of cases) {
      const s = editedEraSummary(rows, c);
      const gathered = s.eras.flatMap((e) => e.posts.map((p) => p.id));
      expect(new Set(gathered).size).toBe(gathered.length);
      expect(gathered.length + s.undated + s.apart).toBe(rows.length);
    }
    expect(editedEraSummary(rows, edits({}, { alone: "Summer 2021" }))).toMatchObject({ undated: 1, apart: 0 });
  });

  it("make no eras of nothing, with or without changes", () => {
    expect(editedEraSummary([], edits({ "Kyoto 2024": "Spring" }, { k1: "Kyoto 2024" }))).toEqual({ eras: [], undated: 0, apart: 0 });
    expect(erasEmpty(editedEraSummary([post("a", "2021-07-10T12:00:00", "Bar Pitti")]))?.kind).toBe("scattered");
  });
});

describe("an era's lines once photographs have moved", () => {
  it("say a span across a year in full", () => {
    const moved = editEras(rows, edits({}, { l1: "Summer 2021" })).find((e) => e.key === "Summer 2021")!;
    expect(eraSpan(moved)).toBe("Jul 2021 – May 2023");
    expect(eraSpanSpoken(moved)).toBe("July 2021 to May 2023");
    expect(eraMeta(moved)).toBe("Jul 2021 – May 2023 · 3 photographs");
  });
});

describe("the gallery an edited era opens", () => {
  const arranged = edits({ "Lisbon 2023": "Lisbon, slowly" }, { k1: "Lisbon 2023" });

  it("holds the era as the member arranged it, titled with their name", () => {
    expect(galleryRows(rows, "taken", "Lisbon 2023", "l1", arranged)).toEqual({
      rows: [rows[0], rows[4], rows[3], rows[2]],
      era: "Lisbon, slowly",
    });
    // Opened from the moved photograph: the era it is in now.
    expect(galleryRows(rows, "taken", "Lisbon 2023", "k1", arranged).era).toBe("Lisbon, slowly");
    // And the era it left holds what is left of it.
    expect(galleryRows(rows, "taken", "Kyoto 2024", "k2", arranged).rows.map((p) => p.id)).toEqual(["k2"]);
  });

  it("finds the era by its key once the photograph tapped has gone, and by the name it showed from an older address", () => {
    const left = rows.filter((p) => p.id !== "l1");
    expect(galleryRows(left, "taken", "Lisbon 2023", "l1", arranged).rows.map((p) => p.id)).toEqual(["k1", "l3", "l2"]);
    expect(galleryRows(left, "taken", "Lisbon, slowly", "l1", arranged).era).toBe("Lisbon, slowly");
  });

  it("is the automatic era where there are no changes, as before", () => {
    expect(galleryRows(rows, "taken", "Lisbon 2023", "l1")).toEqual(galleryRows(rows, "taken", "Lisbon 2023", "l1", NO_EDITS));
    expect(galleryRows(rows, "taken", "Lisbon 2023", "l1").era).toBe("Lisbon 2023");
  });

  it("finds the era a photograph is in as arranged", () => {
    expect(editedEraOf(rows, "k1", arranged)?.key).toBe("Lisbon 2023");
    expect(editedEraOf(rows, "alone", arranged)).toBeNull();
    expect(editedEraOf(rows, "gone", arranged)).toBeNull();
  });
});

describe("an arrangement read from the server", () => {
  it("keeps two maps of words and nothing else", () => {
    expect(readEdits(null)).toEqual(NO_EDITS);
    expect(readEdits({ titles: [], moves: "x" })).toEqual(NO_EDITS);
    expect(
      readEdits({ titles: { "Kyoto 2024": "  Spring  ", "Lisbon 2023": 7, "Summer 2021": "   " }, moves: { k1: "Lisbon 2023", k2: null } }),
    ).toEqual(edits({ "Kyoto 2024": "Spring" }, { k1: "Lisbon 2023" }));
  });

  it("is the same as another when both say the same", () => {
    expect(sameEdits(edits({ a: "1" }, { p: "x" }), edits({ a: "1" }, { p: "x" }))).toBe(true);
    expect(sameEdits(edits({ a: "1" }), edits({ a: "2" }))).toBe(false);
    expect(sameEdits(edits({}, { p: "x" }), edits({}, { p: "x", q: "y" }))).toBe(false);
    expect(sameEdits(NO_EDITS, edits())).toBe(true);
  });
});
