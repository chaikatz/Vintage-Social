import { afterEach, describe, expect, it } from "vitest";
import {
  MADE_ERA,
  NEW_ERA,
  NEW_ERA_TITLE,
  NOT_IN_AN_ERA,
  NO_EDITS,
  ROWS_PER_READ,
  addChoices,
  addToEra,
  createEra,
  deleteEra,
  editEras,
  editedEraOf,
  editedEraSummary,
  eraKeyFrom,
  isMadeEra,
  moveChoices,
  moveToEra,
  readEdits,
  renameEra,
  sameEdits,
  takeOut,
  takeOutChoice,
  type EraEdits,
} from "@/utils/eraEdits";
import { groupEras, sortByTaken, takenDate } from "@/utils/memories";
import { galleryRows } from "@/utils/profileViews";
import { eraMeta, eraSpan } from "@/components/eraBook";

/**
 * Eras the member makes, and photographs added to an era from anywhere:
 * an era made with a name and its photographs, under a key no automatic
 * title can be; where it falls among the others, and the months it says
 * it ran; photographs added from no era and from other eras, one with no
 * capture date among them; what ADD offers; taking a photograph out, and
 * deleting an era the member made; what a save lets go of; the row as the
 * server gives it back, and as a build from before eras could be made
 * reads it; the same in every time zone; and, over many changes made at
 * random, that no photograph is ever shown twice or lost.
 *
 * Dates in the fixtures without a zone are local-time strings, so those
 * cases do not depend on the zone; the zone cases switch process.env.TZ,
 * as era-zones.test.ts does.
 */

const post = (id: string, taken: string | null, location: string | null = null, created = "2026-09-01T12:00:00") => ({
  id,
  taken_at: taken,
  created_at: created,
  location,
});

// Three automatic eras, newest first: Kyoto 2024 (k1, k2), Lisbon 2023
// (l1, l2, l3), Summer 2021 (s1, s2); one photograph on its own (alone);
// one with no capture date, posted 1 September 2026 (undated); and one
// whose capture date cannot be read, posted 1 February 2025 (blank).
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
  post("blank", "not a date", null, "2025-02-01T12:00:00"),
];

const K = "~trip000001";
const K2 = "~trip000002";
const keyed = (key = K) => () => key;
const edits = (titles: Record<string, string> = {}, moves: Record<string, string> = {}): EraEdits => ({ titles, moves });
const shape = (eras: { key: string; title: string; posts: { id: string }[] }[]) =>
  eras.map((e) => `${e.title} [${e.key}]: ${e.posts.map((p) => p.id).join(" ")}`);

/** The long weekend: l3 from Lisbon, alone from no era, undated from no era. */
const weekend = createEra(NO_EDITS, rows, "  The long \n weekend ", ["l3", "alone", "undated", "gone", "l3"], keyed());

describe("an era the member makes", () => {
  it("holds the photographs it was made with, under the member's name and a key of its own", () => {
    expect(weekend.key).toBe(K);
    expect(weekend.edits).toEqual(edits({ [K]: "The long weekend" }, { l3: K, alone: K, undated: K }));
    expect(shape(editEras(rows, weekend.edits))).toEqual([
      "Kyoto 2024 [Kyoto 2024]: k2 k1",
      // Newest capture: the long weekend's is l3, from June 2023.
      "The long weekend [~trip000001]: undated l3 alone",
      "Lisbon 2023 [Lisbon 2023]: l2 l1",
      "Summer 2021 [Summer 2021]: s2 s1",
    ]);
    const made = editEras(rows, weekend.edits).find((e) => e.key === K)!;
    expect(made).toMatchObject({ made: true, renamed: false });
    expect(editEras(rows, weekend.edits).filter((e) => e.made)).toHaveLength(1);
  });

  it("has a key no automatic title can be, as every one ends in a space and a year", () => {
    expect(isMadeEra(K)).toBe(true);
    for (const key of ["Lisbon 2023", "Summer 2021", "~trip00000", "~trip0000001", "~TRIP000001", "~trip 00001", "trip0000001", NEW_ERA, ""]) {
      expect(isMadeEra(key), key).toBe(false);
    }
    // A place written as if it were a key is still read as a place and a year.
    const odd = [post("o1", "2022-03-01T12:00:00", "~abcdefghij"), post("o2", "2022-03-02T12:00:00", "~abcdefghij")];
    expect(groupEras(odd).map((e) => [e.title, isMadeEra(e.title)])).toEqual([["~abcdefghij 2022", false]]);
  });

  it("is never made without a name, a photograph of the member's, or a key that is a key and not in use", () => {
    for (const [name, ids] of [
      ["   ", ["l1"]],
      ["\n\t", ["l1"]],
      ["Away", []],
      ["Away", ["gone"]],
    ] as const) {
      const none = createEra(weekend.edits, rows, name, ids, keyed(K2));
      expect(none.key).toBeNull();
      expect(none.edits).toBe(weekend.edits);
    }
    for (const key of [K, "Lisbon 2023", "~TRIP000002", "~new", ""]) {
      expect(createEra(weekend.edits, rows, "Away", ["l1"], keyed(key)), key).toEqual({ edits: weekend.edits, key: null });
    }
    // A key in use only by a move, its name gone, is still not drawn twice.
    expect(createEra(edits({}, { l1: K2 }), rows, "Away", ["l2"], keyed(K2)).key).toBeNull();
  });

  it("takes its photographs from wherever they were, an era it empties going with them", () => {
    // The second era takes the long weekend's photographs, and the long weekend goes, name and all.
    const second = createEra(weekend.edits, rows, "Away", ["l3", "alone", "undated", "k1"], keyed(K2));
    expect(second.edits).toEqual(edits({ [K2]: "Away" }, { l3: K2, alone: K2, undated: K2, k1: K2 }));
    // Kyoto keeps k2, from 5 March; Away's newest capture is k1, from 2 March.
    expect(shape(editEras(rows, second.edits))).toEqual([
      "Kyoto 2024 [Kyoto 2024]: k2",
      "Away [~trip000002]: undated k1 l3 alone",
      "Lisbon 2023 [Lisbon 2023]: l2 l1",
      "Summer 2021 [Summer 2021]: s2 s1",
    ]);
  });

  it("stands among the eras by its newest capture, and runs over the months its photographs were taken", () => {
    const made = createEra(NO_EDITS, rows, "Two summers", ["s1", "l1", "undated"], keyed()).edits;
    const eras = editEras(rows, made);
    expect(eras.map((e) => e.key)).toEqual(["Kyoto 2024", "Lisbon 2023", K, "Summer 2021"]);
    const two = eras.find((e) => e.key === K)!;
    // Lisbon 2023 still has l3, from June; the made era's newest capture is l1, from May.
    expect(two.latest).toEqual(new Date("2023-05-02T12:00:00"));
    // The undated photograph, posted in 2026, sits first, and says nothing of when the era was.
    expect(two.posts.map((p) => p.id)).toEqual(["undated", "l1", "s1"]);
    expect(eraSpan(two)).toBe("Jul 2021 – May 2023");
    expect(eraMeta(two)).toBe("Jul 2021 – May 2023 · 3 photographs");
  });

  it("of photographs that do not say when they were taken, stands and runs by when they were posted", () => {
    const made = createEra(NO_EDITS, rows, "Scans", ["undated", "blank"], keyed()).edits;
    const eras = editEras(rows, made);
    expect(eras[0]).toMatchObject({ key: K, title: "Scans", latest: new Date("2026-09-01T12:00:00") });
    expect(eras[0].posts.map((p) => p.id)).toEqual(["undated", "blank"]);
    expect(eraSpan(eras[0])).toBe("Feb 2025 – Sep 2026");
    expect(editedEraSummary(rows, made)).toMatchObject({ undated: 0, apart: 1 });
  });

  it("takes a new name, and keeps the one it has when given nothing, having no automatic one to go back to", () => {
    const renamed = renameEra(weekend.edits, K, "  Porto, nearly ", rows);
    expect(renamed.titles).toEqual({ [K]: "Porto, nearly" });
    expect(editEras(rows, renamed).find((e) => e.key === K)).toMatchObject({ title: "Porto, nearly", renamed: false, made: true });
    for (const nothing of [null, "", "   "]) expect(renameEra(weekend.edits, K, nothing, rows)).toBe(weekend.edits);
    expect(renameEra(weekend.edits, K, "The long weekend", rows)).toBe(weekend.edits);
    // An era the member did not make, or has deleted, is not made by naming it.
    expect(renameEra(weekend.edits, K2, "Away", rows)).toBe(weekend.edits);
    // Its key as its name is a name like another.
    expect(renameEra(weekend.edits, K, K).titles).toEqual({ [K]: K });
  });

  it("is a place to move to, in the page's order, and the move sheet can offer to begin another", () => {
    const choices = moveChoices(rows, weekend.edits, "k1", { newEra: true });
    expect(choices.map((c) => [c.key, c.title, c.here, c.made, c.newEra])).toEqual([
      ["Kyoto 2024", "Kyoto 2024", true, false, false],
      [K, "The long weekend", false, true, false],
      ["Lisbon 2023", "Lisbon 2023", false, false, false],
      ["Summer 2021", "Summer 2021", false, false, false],
      [NEW_ERA, NEW_ERA_TITLE, false, true, true],
    ]);
    expect(NEW_ERA_TITLE).toBe("New era…");
    // Only when asked for, and never an era a photograph is moved into.
    expect(moveChoices(rows, weekend.edits, "k1").some((c) => c.newEra)).toBe(false);
    expect(moveToEra(weekend.edits, rows, "k1", NEW_ERA)).toBe(weekend.edits);
    expect(addToEra(weekend.edits, rows, NEW_ERA, ["k1"])).toBe(weekend.edits);
    expect(moveToEra(weekend.edits, rows, "k1", K).moves).toEqual({ l3: K, alone: K, undated: K, k1: K });
  });

  it("goes with its last photograph, and its name with it", () => {
    let left = weekend.edits;
    for (const id of ["l3", "alone"]) left = takeOut(left, rows, id);
    expect(shape(editEras(rows, left)).find((line) => line.includes(K))).toBe("The long weekend [~trip000001]: undated");
    left = takeOut(left, rows, "undated");
    expect(left).toEqual(NO_EDITS);
    expect(editEras(rows, left).some((e) => e.made)).toBe(false);
    // Moved away rather than taken out, the same.
    let moved = weekend.edits;
    for (const id of ["l3", "alone", "undated"]) moved = moveToEra(moved, rows, id, "Summer 2021");
    expect(moved).toEqual(edits({}, { l3: "Summer 2021", alone: "Summer 2021", undated: "Summer 2021" }));
  });

  it("is deleted whole: its name and every move into it, its photographs back where they fall", () => {
    const more = moveToEra(weekend.edits, rows, "s1", "Kyoto 2024");
    const gone = deleteEra(more, rows, K);
    expect(gone).toEqual(edits({}, { s1: "Kyoto 2024" }));
    expect(shape(editEras(rows, gone))).toEqual([
      "Kyoto 2024 [Kyoto 2024]: k2 k1 s1",
      "Lisbon 2023 [Lisbon 2023]: l3 l2 l1",
      "Summer 2021 [Summer 2021]: s2",
    ]);
    expect(editedEraSummary(rows, gone)).toMatchObject({ undated: 2, apart: 1 });
    // Nothing to delete: an automatic era, one not there, one already gone.
    for (const key of ["Kyoto 2024", K2, NEW_ERA]) expect(deleteEra(more, rows, key)).toBe(more);
    expect(deleteEra(gone, rows, K)).toBe(gone);
    // A name with no photographs left, or moves with no name, are deleted all the same.
    expect(deleteEra(edits({ [K]: "Empty" }), rows, K)).toEqual(NO_EDITS);
    expect(deleteEra(edits({}, { l1: K }), rows, K)).toEqual(NO_EDITS);
  });

  it("opens the gallery held to it, by the photograph tapped or by its key", () => {
    expect(galleryRows(rows, "taken", K, "l3", weekend.edits)).toEqual({
      rows: [rows[8], rows[4], rows[7]],
      era: "The long weekend",
    });
    const left = rows.filter((p) => p.id !== "l3");
    expect(galleryRows(left, "taken", K, "l3", weekend.edits).rows.map((p) => p.id)).toEqual(["undated", "alone"]);
    expect(editedEraOf(rows, "undated", weekend.edits)?.key).toBe(K);
  });
});

describe("adding photographs to an era", () => {
  it("brings them from no era and from other eras, dated or not, as one change", () => {
    const added = addToEra(NO_EDITS, rows, "Kyoto 2024", ["l1", "alone", "undated", "blank", "k1", "gone", "l1"]);
    expect(added).toEqual(edits({}, { l1: "Kyoto 2024", alone: "Kyoto 2024", undated: "Kyoto 2024", blank: "Kyoto 2024" }));
    expect(shape(editEras(rows, added))[0]).toBe("Kyoto 2024 [Kyoto 2024]: undated blank k2 k1 l1 alone");
    // Its months, and its place first among the eras, are its captures': March 2024.
    const kyoto = editEras(rows, added)[0];
    expect(kyoto.latest).toEqual(new Date("2024-03-05T12:00:00"));
    expect(eraSpan(kyoto)).toBe("Jan 2022 – Mar 2024");
    expect(editedEraSummary(rows, added)).toMatchObject({ undated: 0, apart: 0 });
  });

  it("brings one home rather than recording a move into the era it falls in", () => {
    const away = edits({}, { l1: "Kyoto 2024", s1: "Kyoto 2024" });
    expect(addToEra(away, rows, "Lisbon 2023", ["l1", "s1"])).toEqual(edits({}, { s1: "Lisbon 2023" }));
  });

  it("fills an era moves have emptied, which stays a place to go", () => {
    const out = edits({}, { s1: "Kyoto 2024", s2: "Kyoto 2024" });
    expect(addToEra(out, rows, "Summer 2021", ["undated"])).toEqual(edits({}, { s1: "Kyoto 2024", s2: "Kyoto 2024", undated: "Summer 2021" }));
  });

  it("changes nothing, and gives the arrangement back, where nothing would move", () => {
    const start = weekend.edits;
    for (const [key, ids] of [
      ["Lisbon 2023", ["l1", "l2"]],
      [K, ["l3", "alone"]],
      ["Lisbon 2023", []],
      ["Lisbon 2023", ["gone"]],
      ["Bar Pitti 2022", ["l1"]],
      ["Paris 1999", ["l1"]],
      [K2, ["l1"]],
      [NEW_ERA, ["l1"]],
      ["", ["l1"]],
    ] as const) {
      expect(addToEra(start, rows, key, ids), `${key} ${ids.join(" ")}`).toBe(start);
    }
    // Already in Lisbon of itself, a move into an era that has gone notwithstanding.
    const stale = edits({}, { l1: "Paris 1999" });
    expect(addToEra(stale, rows, "Lisbon 2023", ["l1"])).toBe(stale);
    expect(moveToEra(stale, rows, "l1", "Lisbon 2023")).toBe(stale);
  });

  it("lets go of what no longer applies on the way", () => {
    const stale = edits({ "Kyiv 2022": "Home", [K2]: "Forgotten" }, { deleted: "Kyoto 2024", l1: "Kyiv 2022" });
    expect(addToEra(stale, rows, "Kyoto 2024", ["undated"])).toEqual(edits({}, { undated: "Kyoto 2024" }));
  });
});

describe("what ADD offers", () => {
  it("is every photograph not in the era: those in none first, then each era by the name it shows, newest first", () => {
    const named = { ...weekend.edits, titles: { ...weekend.edits.titles, "Summer 2021": "That summer" } };
    const groups = addChoices(rows, named, "Lisbon 2023");
    expect(groups.map((g) => [g.key, g.title, g.posts.map((p) => p.id).join(" ")])).toEqual([
      [null, NOT_IN_AN_ERA, "blank"],
      ["Kyoto 2024", "Kyoto 2024", "k2 k1"],
      [K, "The long weekend", "undated l3 alone"],
      ["Summer 2021", "That summer", "s2 s1"],
    ]);
    expect(NOT_IN_AN_ERA).toBe("Not in an era");
    expect(groups[0].era).toBeNull();
    expect(groups[2].era?.made).toBe(true);
  });

  it("puts the photographs in no era newest first, by when each was taken, or posted", () => {
    expect(addChoices(rows, NO_EDITS, "Kyoto 2024")[0].posts.map((p) => p.id)).toEqual(["undated", "blank", "alone"]);
  });

  it("leaves out a group with nothing in it", () => {
    const all = addToEra(NO_EDITS, rows, "Summer 2021", ["alone", "undated", "blank"]);
    expect(addChoices(rows, all, "Kyoto 2024").map((g) => g.key)).toEqual(["Lisbon 2023", "Summer 2021"]);
    expect(addChoices(rows, NO_EDITS, "Kyoto 2024").map((g) => g.key)).toEqual([null, "Lisbon 2023", "Summer 2021"]);
  });

  it("offers every photograph for an era yet to be made, and nothing for one that cannot take one", () => {
    expect(addChoices(rows, weekend.edits, null).flatMap((g) => g.posts.map((p) => p.id)).sort()).toEqual(rows.map((p) => p.id).sort());
    for (const key of ["Paris 1999", "Bar Pitti 2022", K2, NEW_ERA]) expect(addChoices(rows, weekend.edits, key), key).toEqual([]);
  });

  it("offers an emptied era everything, and an era the member made all but its own", () => {
    const out = edits({}, { s1: "Kyoto 2024", s2: "Kyoto 2024" });
    expect(addChoices(rows, out, "Summer 2021").flatMap((g) => g.posts).length).toBe(rows.length);
    expect(addChoices(rows, weekend.edits, K).flatMap((g) => g.posts).length).toBe(rows.length - 3);
  });
});

describe("taking a photograph out of an era", () => {
  it("sends it back where the automatic reading puts it: its own era, or none", () => {
    const moved = edits({}, { l1: "Kyoto 2024", alone: "Kyoto 2024", undated: "Kyoto 2024" });
    expect(editedEraOf(rows, "l1", takeOut(moved, rows, "l1"))?.key).toBe("Lisbon 2023");
    const alone = takeOut(moved, rows, "alone");
    expect(alone).toEqual(edits({}, { l1: "Kyoto 2024", undated: "Kyoto 2024" }));
    expect(editedEraOf(rows, "alone", alone)).toBeNull();
    expect(editedEraSummary(rows, alone)).toMatchObject({ undated: 1, apart: 1 });
    expect(editedEraOf(rows, "undated", takeOut(moved, rows, "undated"))).toBeNull();
  });

  it("is nothing for a photograph no move put where it is", () => {
    const stale = edits({}, { l1: "Paris 1999", l2: "Lisbon 2023" });
    for (const id of ["k1", "l1", "l2", "alone", "undated", "gone"]) expect(takeOut(stale, rows, id), id).toBe(stale);
  });

  it("says where it would go, or that there is nothing to take it out of", () => {
    const moved = edits({}, { l1: "Kyoto 2024", alone: "Kyoto 2024" });
    expect(takeOutChoice(rows, moved, "l1")?.back?.key).toBe("Lisbon 2023");
    expect(takeOutChoice(rows, moved, "alone")).toEqual({ back: null });
    expect(takeOutChoice(rows, moved, "k1")).toBeNull();
    // Out of Kyoto, a photograph Kyoto's own era was holding together alone: k1 left by itself goes too.
    const lone = edits({}, { k2: "Lisbon 2023", l1: "Kyoto 2024" });
    expect(takeOutChoice(rows, lone, "l1")).toEqual({ back: expect.objectContaining({ key: "Lisbon 2023" }) });
    expect(editEras(rows, takeOut(lone, rows, "l1")).some((e) => e.key === "Kyoto 2024")).toBe(true);
  });
});

describe("what a save lets go of, with eras the member made", () => {
  it("keeps the name of one while a move into it is of a photograph still there", () => {
    const left = rows.filter((p) => p.id !== "l3" && p.id !== "alone");
    expect(renameEra(weekend.edits, "Kyoto 2024", "Spring", left)).toEqual(
      edits({ [K]: "The long weekend", "Kyoto 2024": "Spring" }, { undated: K }),
    );
  });

  it("lets it go, name and moves, once every photograph moved into it has been deleted", () => {
    const left = rows.filter((p) => !["l3", "alone", "undated"].includes(p.id));
    expect(renameEra(weekend.edits, "Kyoto 2024", "Spring", left)).toEqual(edits({ "Kyoto 2024": "Spring" }));
    // Seen in the meantime, before any save: an era of nothing is no era.
    expect(editEras(left, weekend.edits).some((e) => e.made)).toBe(false);
  });

  it("lets go of a name no move holds, and of moves into a key with no name", () => {
    const loose = edits({ [K2]: "Nobody's" }, { l1: K, l2: "Kyoto 2024" });
    expect(addToEra(loose, rows, "Kyoto 2024", ["l3"])).toEqual(edits({}, { l2: "Kyoto 2024", l3: "Kyoto 2024" }));
    // The photograph moved into a key with no name is where the automatic reading puts it.
    expect(editedEraOf(rows, "l1", loose)?.key).toBe("Lisbon 2023");
  });

  it("is nothing when the photographs may not all have been read", () => {
    const many = Array.from({ length: ROWS_PER_READ }, (_, i) => post(`m${i}`, "2020-07-10T12:00:00", "Milan"));
    const kept = edits({ [K]: "Away", [K2]: "Empty" }, { deleted: K });
    expect(renameEra(kept, "Milan 2020", "Milano", many)).toEqual(edits({ [K]: "Away", [K2]: "Empty", "Milan 2020": "Milano" }, { deleted: K }));
    expect(renameEra(kept, "Milan 2020", "Milano", many.slice(1)).titles).toEqual({ "Milan 2020": "Milano" });
  });
});

describe("an arrangement read from the server, with an era the member made", () => {
  it("keeps the era's key and name, and the moves into it", () => {
    const read = readEdits({ titles: { [K]: "  The long\nweekend " }, moves: { l3: K, undated: K }, time_zone: "Europe/Lisbon" });
    expect(read).toEqual({ titles: { [K]: "The long weekend" }, moves: { l3: K, undated: K }, zone: "Europe/Lisbon" });
    expect(shape(editEras(rows, read)).find((line) => line.includes(K))).toBe("The long weekend [~trip000001]: undated l3");
  });

  it("shows nothing of one whose name is not there: its photographs are where they fall", () => {
    const read = readEdits({ titles: { [K]: "   " }, moves: { l3: K, undated: K } });
    expect(shape(editEras(rows, read))).toEqual(shape(editEras(rows)));
    // Nor of one whose name is there but cleans to nothing, as a change in hand might hold.
    const blank = edits({ [K]: " \n\u0000 " }, { l3: K, undated: K });
    expect(shape(editEras(rows, blank))).toEqual(shape(editEras(rows)));
    expect(moveChoices(rows, blank, "l1").some((c) => c.key === K)).toBe(false);
  });
});

describe("as a build from before eras could be made reads them", () => {
  // editEras at 5a9e4a7, word for word, with groupEras and the rest as they were then.
  function before<T extends { id: string; taken_at: string | null; created_at: string; location: string | null }>(posts: T[], arranged: EraEdits) {
    const dated = (p: T) => Boolean(p.taken_at) && !Number.isNaN(takenDate(p).getTime());
    const buckets = groupEras(posts, 1, arranged.zone);
    const held = new Map<string, T[]>(buckets.map((bucket) => [bucket.title, [...bucket.posts]]));
    const home = new Map<string, string>();
    for (const bucket of buckets) for (const p of bucket.posts) home.set(p.id, bucket.title);
    const byId = new Map(posts.map((p) => [p.id, p]));
    const joined = new Set<string>();
    for (const [id, key] of Object.entries(arranged.moves)) {
      const p = byId.get(id);
      const into = held.get(key);
      if (!p || !into || !dated(p)) continue;
      const from = home.get(id);
      if (from === key) continue;
      if (from !== undefined) held.set(from, held.get(from)!.filter((q) => q.id !== id));
      into.push(p);
      joined.add(key);
    }
    const out: { key: string; title: string; posts: T[] }[] = [];
    for (const bucket of buckets) {
      const gathered = held.get(bucket.title)!;
      if (gathered.length === 0) continue;
      if (bucket.posts.length < 2 && !joined.has(bucket.title)) continue;
      const own = arranged.titles[bucket.title];
      out.push({ key: bucket.title, title: own && own !== bucket.title ? own : bucket.title, posts: sortByTaken(gathered) });
    }
    return out;
  }

  it("skips the moves into an era it does not know, and shows those photographs in their automatic eras, once each", () => {
    const arranged = addToEra(weekend.edits, rows, "Summer 2021", ["k1", "blank"]);
    expect(shape(before(rows, arranged))).toEqual([
      "Kyoto 2024 [Kyoto 2024]: k2",
      "Lisbon 2023 [Lisbon 2023]: l3 l2 l1",
      "Summer 2021 [Summer 2021]: k1 s2 s1",
    ]);
    const shown = before(rows, arranged).flatMap((e) => e.posts.map((p) => p.id));
    expect(new Set(shown).size).toBe(shown.length);
    expect(before(rows, arranged).some((e) => e.title === "The long weekend")).toBe(false);
  });
});

describe("eras the member made, in every time zone", () => {
  const was = process.env.TZ;
  afterEach(() => {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  });
  function on<R>(zone: string, read: () => R): R {
    const before = process.env.TZ;
    process.env.TZ = zone;
    try {
      return read();
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  }
  const ZONES = ["Europe/Lisbon", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"];
  // n1 is the last half hour of 2023 in Lisbon, n2 and n3 the first hour of 2024; u1 was posted with no capture date.
  const nye = [
    { id: "n1", taken_at: "2023-12-31T23:30:00Z", created_at: "2024-01-02T09:00:00Z", location: "Lisbon" },
    { id: "n2", taken_at: "2024-01-01T00:30:00Z", created_at: "2024-01-02T09:00:00Z", location: "Lisbon" },
    { id: "n3", taken_at: "2024-01-01T01:00:00Z", created_at: "2024-01-02T09:00:00Z", location: "Lisbon" },
    { id: "u1", taken_at: null, created_at: "2024-01-02T10:00:00Z", location: null },
  ];
  const lines = (eras: { key: string; title: string; posts: { id: string }[] }[]) => eras.map((e) => `${e.title} [${e.key}]: ${e.posts.map((p) => p.id).join(" ")}`);

  // Made on the author's phone in Lisbon, the zone kept with the arrangement.
  const author = on("Europe/Lisbon", () => {
    const made = createEra({ ...NO_EDITS, zone: "Europe/Lisbon" }, nye, "First light", ["n3", "u1"], keyed());
    return made.edits;
  });

  it("are the same eras, in the same order, by the same names, on every phone", () => {
    for (const zone of ZONES) {
      expect(on(zone, () => lines(editEras(nye, author))), zone).toEqual(["First light [~trip000001]: u1 n3", "Lisbon 2024 [Lisbon 2024]: n2"]);
      expect(on(zone, () => editedEraSummary(nye, author)), zone).toMatchObject({ undated: 0, apart: 1 });
    }
  });

  it("offer the same photographs to add, and the same places to move to, on every phone", () => {
    for (const zone of ZONES) {
      on(zone, () => {
        expect(addChoices(nye, author, K).map((g) => [g.key, g.posts.map((p) => p.id).join(" ")]), zone).toEqual([
          [null, "n1"],
          ["Lisbon 2024", "n2"],
        ]);
        expect(moveChoices(nye, author, "n1").map((c) => [c.key, c.here]), zone).toEqual([
          [K, false],
          ["Lisbon 2024", false],
        ]);
        // n1 is Lisbon 2023's in the kept zone, and Lisbon 2023 is no era of two: it cannot be moved there.
        expect(moveToEra(author, nye, "n1", "Lisbon 2023"), zone).toBe(author);
        expect(addToEra(author, nye, K, ["n1"]).moves, zone).toEqual({ n3: K, u1: K, n1: K });
        expect(takeOut(author, nye, "n3").moves, zone).toEqual({ u1: K });
      });
    }
  });

  it("hold their photographs whatever zone the automatic eras are read in, the arrangement kept without one", () => {
    const unzoned = { titles: { [K]: "First light" }, moves: { n1: K, n2: K } };
    for (const zone of ZONES) {
      const made = on(zone, () => editEras(nye, unzoned).find((e) => e.key === K));
      expect(made?.posts.map((p) => p.id), zone).toEqual(["n2", "n1"]);
    }
  });

  it("let go of the same things on every phone as a save is made", () => {
    const left = nye.filter((p) => p.id !== "n3" && p.id !== "u1");
    for (const zone of ZONES) {
      expect(on(zone, () => renameEra(author, "Lisbon 2024", "New Year", left)), zone).toEqual({
        titles: { "Lisbon 2024": "New Year" },
        moves: {},
        zone: "Europe/Lisbon",
      });
    }
  });
});

describe("a new era's key, from random bytes", () => {
  it("is a letter or digit for each byte under 252, every one of them as likely", () => {
    const counts = new Map<string, number>();
    for (let byte = 0; byte < 252; byte++) {
      const key = eraKeyFrom(new Array(10).fill(byte));
      const letter = key!.slice(1, 2);
      expect(key).toBe(`~${letter.repeat(10)}`);
      counts.set(letter, (counts.get(letter) ?? 0) + 1);
    }
    expect(counts.size).toBe(36);
    expect([...counts.values()].every((n) => n === 7)).toBe(true);
  });

  it("passes over the bytes that would lean, and is null when too few are left", () => {
    expect(eraKeyFrom([252, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 35, 36, 71])).toBe("~012345678z");
    expect(eraKeyFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, 252, 253, 254, 255])).toBeNull();
    expect(eraKeyFrom([0, 1, 2, 3, 4, 5, 6, 7, 8, -1, 1.5, 300, Number.NaN])).toBeNull();
    expect(eraKeyFrom(new Uint8Array(16))).toBe("~0000000000");
    expect(MADE_ERA.test(eraKeyFrom(new Uint8Array(16).fill(251))!)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Many changes, made at random
// ---------------------------------------------------------------------------

/** A small, seeded source of randomness, so a failure can be played again. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Row = ReturnType<typeof post>;

describe("over many changes made at random", () => {
  const was = process.env.TZ;
  afterEach(() => {
    if (was === undefined) delete process.env.TZ;
    else process.env.TZ = was;
  });

  const ZONES = ["Europe/Lisbon", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "UTC"];
  const PLACES = ["Lisbon", "Kyoto", "Porto", null, null, "~abcdefghij"];
  const NAMES = ["Away", "  The long  weekend ", "   ", "🗼".repeat(70), "Lisbon 2023", "", "Home\nagain"];

  function photographs(rand: () => number, n: number): Row[] {
    const iso = (from: number, to: number) => new Date(from + rand() * (to - from)).toISOString();
    const out: Row[] = [];
    for (let i = 0; i < n; i++) {
      const r = rand();
      // Some near a New Year, where a zone changes the year.
      const near = rand() < 0.2;
      const taken =
        r < 0.12 ? null : r < 0.16 ? "not a date" : near ? iso(Date.UTC(2022, 11, 31, 10), Date.UTC(2023, 0, 1, 14)) : iso(Date.UTC(2021, 0, 1), Date.UTC(2024, 11, 31));
      out.push(post(`p${i}`, taken, PLACES[Math.floor(rand() * PLACES.length)], iso(Date.UTC(2025, 0, 1), Date.UTC(2026, 10, 1))));
    }
    return out;
  }

  /** Everything that must hold of an arrangement over its photographs, whatever was done to get there. */
  function holds(posts: Row[], arranged: EraEdits, at: string) {
    const summary = editedEraSummary(posts, arranged);
    const shown = summary.eras.flatMap((e) => e.posts.map((p) => p.id));
    // Never shown twice, never lost: every photograph in one era, or counted once.
    expect(new Set(shown).size, at).toBe(shown.length);
    expect(shown.length + summary.undated + summary.apart, at).toBe(posts.length);
    const ids = new Set(posts.map((p) => p.id));
    expect(shown.every((id) => ids.has(id)), at).toBe(true);
    const keys = summary.eras.map((e) => e.key);
    expect(new Set(keys).size, at).toBe(keys.length);
    for (const era of summary.eras) {
      expect(era.posts.length, at).toBeGreaterThan(0);
      expect(era.made, at).toBe(isMadeEra(era.key));
      if (era.made) {
        expect(era.renamed, at).toBe(false);
        expect(era.title.length > 0 && Array.from(era.title).length <= 60, at).toBe(true);
      }
      expect(Number.isNaN(era.latest.getTime()), at).toBe(false);
      expect(eraSpan(era), at).toMatch(/^[A-Z][a-z]{2}( \d{4})?( – [A-Z][a-z]{2})? \d{4}$/);
    }
    // In the page's order.
    for (let i = 1; i < summary.eras.length; i++) {
      expect(summary.eras[i - 1].latest.getTime(), at).toBeGreaterThanOrEqual(summary.eras[i].latest.getTime());
    }
  }

  /** What a save leaves in the row: nothing that does not apply to a photograph there now. */
  function tidy(posts: Row[], arranged: EraEdits, at: string) {
    const automatic = new Set(groupEras(posts, 1, arranged.zone).map((e) => e.title));
    const ids = new Set(posts.map((p) => p.id));
    for (const [id, key] of Object.entries(arranged.moves)) {
      expect(ids.has(id), `${at}: move of ${id}`).toBe(true);
      expect(automatic.has(key) || (isMadeEra(key) && typeof arranged.titles[key] === "string"), `${at}: move into ${key}`).toBe(true);
    }
    for (const key of Object.keys(arranged.titles)) {
      const held = Object.entries(arranged.moves).some(([, into]) => into === key);
      expect(isMadeEra(key) ? held : automatic.has(key), `${at}: name of ${key}`).toBe(true);
    }
  }

  for (const seed of [1, 7, 42, 2026, 90210]) {
    it(`no photograph is ever shown twice or lost, and every change does what it says (seed ${seed})`, () => {
      const rand = seeded(seed);
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];
      let posts = photographs(rand, 36);
      let arranged: EraEdits = rand() < 0.5 ? NO_EDITS : { ...NO_EDITS, zone: pick(ZONES) };
      let drawn = 0;
      const draw = () => `~${String(++drawn).padStart(10, "0")}`;
      const some = () => {
        const ids = posts.filter(() => rand() < 0.15).map((p) => p.id);
        return rand() < 0.1 ? [...ids, "gone"] : ids;
      };
      // What the walk did, so it is known to have done each thing, and seen each case.
      const did = { made: 0, added: 0, moved: 0, takenOut: 0, deleted: 0, renamed: 0, deletedPhotos: 0, undatedInEra: 0, madeShown: 0 };

      for (let step = 0; step < 160; step++) {
        process.env.TZ = pick(ZONES);
        const at = `seed ${seed}, step ${step}, ${process.env.TZ}`;
        const prev = arranged;
        const eras = editEras(posts, prev);
        const madeKeys = Object.keys(prev.titles).filter(isMadeEra);
        const roll = rand();
        let next = prev;

        if (roll < 0.2) {
          const ids = some();
          const name = pick(NAMES);
          const made = createEra(prev, posts, name, ids, rand() < 0.1 ? () => pick([...madeKeys, "nope"]) : draw);
          next = made.edits;
          if (made.key) {
            const era = editEras(posts, next).find((e) => e.key === made.key)!;
            expect(era.made, at).toBe(true);
            expect(era.posts.map((p) => p.id).sort(), at).toEqual([...new Set(ids)].filter((id) => posts.some((p) => p.id === id)).sort());
          } else {
            expect(next, at).toBe(prev);
          }
        } else if (roll < 0.45) {
          const choices = moveChoices(posts, prev, pick(posts).id).map((c) => c.key);
          const key = pick([...choices, ...choices, "Paris 1999", NEW_ERA, "~zzzzzzzzzz", ""]);
          const ids = some();
          next = addToEra(prev, posts, key, ids);
          if (choices.includes(key)) {
            for (const id of ids) if (posts.some((p) => p.id === id)) expect(editedEraOf(posts, id, next)?.key, `${at}: ${id} → ${key}`).toBe(key);
          } else {
            expect(next, at).toBe(prev);
          }
          expect(addToEra(next, posts, key, ids), `${at}: again`).toBe(next);
        } else if (roll < 0.6) {
          const id = pick(posts).id;
          const choices = moveChoices(posts, prev, id);
          expect(choices.filter((c) => c.here).length, at).toBe(editedEraOf(posts, id, prev) ? 1 : 0);
          const key = pick(choices.map((c) => c.key).concat(NEW_ERA));
          next = moveToEra(prev, posts, id, key);
          const choice = choices.find((c) => c.key === key);
          expect(next !== prev, `${at}: ${id} → ${key}`).toBe(choice != null && !choice.here);
          if (choice) expect(editedEraOf(posts, id, next)?.key, at).toBe(key);
        } else if (roll < 0.75) {
          const id = pick(posts).id;
          next = takeOut(prev, posts, id);
          if (next !== prev) {
            expect(next.moves[id], at).toBeUndefined();
            const home = groupEras(posts, 1, prev.zone).find((e) => e.posts.some((p) => p.id === id))?.title;
            const now = editedEraOf(posts, id, next)?.key;
            expect(now === undefined || now === home, at).toBe(true);
            expect(takeOut(next, posts, id), `${at}: again`).toBe(next);
          }
        } else if (roll < 0.85) {
          const key = pick([...madeKeys, ...eras.map((e) => e.key), "~zzzzzzzzzz"]);
          next = deleteEra(prev, posts, key);
          if (!isMadeEra(key)) expect(next, at).toBe(prev);
          expect(editEras(posts, next).some((e) => e.key === key && e.made), at).toBe(false);
          expect(Object.values(next.moves).includes(key) && isMadeEra(key), at).toBe(false);
          expect(deleteEra(next, posts, key), `${at}: again`).toBe(next);
        } else if (roll < 0.95) {
          const key = pick([...eras.map((e) => e.key), ...madeKeys, "Paris 1999"]);
          next = renameEra(prev, key, rand() < 0.2 ? null : pick(NAMES), posts);
          if (isMadeEra(key)) expect(next.titles[key] === undefined, at).toBe(prev.titles[key] === undefined);
        } else if (posts.length > 4) {
          // A photograph deleted, elsewhere: the arrangement is not saved again until the next change.
          const gone = pick(posts).id;
          posts = posts.filter((p) => p.id !== gone);
        }

        // A new arrangement is a real change (but for a name given to an era that is not there,
        // let go as it is given), and leaves nothing behind that no longer applies.
        const renaming = roll >= 0.85 && roll < 0.95;
        if (next !== prev) {
          expect(sameEdits(next, prev) && !renaming, at).toBe(false);
          tidy(posts, next, at);
          const kind = roll < 0.2 ? "made" : roll < 0.45 ? "added" : roll < 0.6 ? "moved" : roll < 0.75 ? "takenOut" : roll < 0.85 ? "deleted" : "renamed";
          did[kind]++;
        } else if (roll >= 0.95 && posts.length > 4) did.deletedPhotos++;
        arranged = next;
        holds(posts, arranged, at);
        const now = editEras(posts, arranged);
        if (now.some((e) => e.posts.some((p) => !p.taken_at || p.taken_at === "not a date"))) did.undatedInEra++;
        if (now.some((e) => e.made)) did.madeShown++;

        // What ADD offers is every photograph not in the era, each once, those in no era first.
        const target = pick([...moveChoices(posts, arranged, posts[0].id).map((c) => c.key), null]);
        const offered = addChoices(posts, arranged, target).flatMap((g) => g.posts.map((p) => p.id));
        const inTarget = target === null ? [] : (editEras(posts, arranged).find((e) => e.key === target)?.posts ?? []).map((p) => p.id);
        expect(new Set(offered).size, at).toBe(offered.length);
        expect([...offered, ...inTarget].sort(), at).toEqual(posts.map((p) => p.id).sort());
      }
      for (const [what, times] of Object.entries(did)) expect(times, `seed ${seed}: ${what}`).toBeGreaterThan(0);
    });
  }
});
