import { afterEach, describe, expect, it } from "vitest";
import { groupEras, sortByTaken, takenDate, type Era } from "@/utils/memories";
import { NO_EDITS, deviceZone, editEras, editedEraSummary, moveChoices, moveToEra, renameEra, type EraEdits } from "@/utils/eraEdits";
import { galleryRows } from "@/utils/profileViews";

/**
 * Eras across time zones. A year, and a season, depend on where they are
 * read: three photographs from New Year's Eve in Lisbon fall in 2024 there
 * and in Tokyo, and in 2023 in New York. A member's names and moves are
 * kept once, keyed by what their own phone read, so the photographs are
 * read in the zone kept with them wherever they are laid over them: the
 * author's phone wherever they travel, and every reader's. Without a zone,
 * groupEras reads exactly as it always has.
 *
 * Each case runs with the process's own zone switched (process.env.TZ),
 * which is the zone a phone's Date reads in.
 */

const post = (id: string, taken: string | null, location: string | null = null) => ({
  id,
  taken_at: taken,
  created_at: "2026-09-01T12:00:00Z",
  location,
});

// Lisbon is on UTC in winter: n1 is the last half hour of 2023 there, n2
// and n3 the first hour of 2024. In New York all three are still 2023; in
// Tokyo all three are already 2024.
const nye = [
  post("n1", "2023-12-31T23:30:00Z", "Lisbon"),
  post("n2", "2024-01-01T00:30:00Z", "Lisbon"),
  post("n3", "2024-01-01T01:00:00Z", "Lisbon"),
];

const ZONES = ["Europe/Lisbon", "America/New_York", "Asia/Tokyo", "Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC"];

const was = process.env.TZ;
afterEach(() => {
  if (was === undefined) delete process.env.TZ;
  else process.env.TZ = was;
});

/** `read` as a phone set to `zone` reads it. */
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

const counted = (eras: { title: string; posts: unknown[] }[]) => eras.map((e) => `${e.title}: ${e.posts.length}`);

describe("eras read on each phone's own calendar", () => {
  it("differ from zone to zone, as they always have where nothing is arranged", () => {
    expect(on("Europe/Lisbon", () => counted(groupEras(nye)))).toEqual(["Lisbon 2024: 2"]);
    expect(on("America/New_York", () => counted(groupEras(nye)))).toEqual(["Lisbon 2023: 3"]);
    expect(on("Asia/Tokyo", () => counted(groupEras(nye)))).toEqual(["Lisbon 2024: 3"]);
    expect(on("America/New_York", () => counted(editEras(nye)))).toEqual(["Lisbon 2023: 3"]);
  });

  it("are exactly what groupEras made before it could be given a zone", () => {
    // The groupEras of before, word for word.
    const SEASONS = ["Winter", "Winter", "Spring", "Spring", "Spring", "Summer", "Summer", "Summer", "Autumn", "Autumn", "Autumn", "Winter"];
    function before<T extends { taken_at: string | null; created_at: string; location: string | null }>(posts: T[], minSize = 2): Era<T>[] {
      const buckets = new Map<string, Era<T>>();
      for (const post of posts) {
        if (!post.taken_at) continue;
        const taken = takenDate(post);
        if (Number.isNaN(taken.getTime())) continue;
        const place = post.location?.trim();
        const title = place ? `${place} ${taken.getFullYear()}` : `${SEASONS[taken.getMonth()]} ${taken.getFullYear()}`;
        const era = buckets.get(title);
        if (era) {
          era.posts.push(post);
          if (taken > era.latest) era.latest = taken;
        } else {
          buckets.set(title, { title, posts: [post], latest: taken });
        }
      }
      return [...buckets.values()]
        .filter((e) => e.posts.length >= minSize)
        .map((e) => ({ ...e, posts: sortByTaken(e.posts) }))
        .sort((a, b) => b.latest.getTime() - a.latest.getTime());
    }
    const grid = [
      ...nye,
      post("w1", "2024-02-29T23:30:00Z"),
      post("w2", "2024-02-29T22:00:00Z"),
      post("s1", "2024-03-01T00:30:00Z"),
      post("s2", "2024-03-01T09:00:00Z"),
      post("x1", "2021-07-10T12:00:00", "  Bar Pitti "),
      post("x2", "2021-07-11T12:00:00", "Bar Pitti"),
      post("u1", null, "Lisbon"),
      post("u2", "not a date"),
    ];
    for (const zone of ZONES) {
      on(zone, () => {
        for (const minSize of [1, 2, 3]) {
          expect(JSON.stringify(groupEras(grid, minSize)), `${zone} ${minSize}`).toBe(JSON.stringify(before(grid, minSize)));
          expect(JSON.stringify(groupEras(grid, minSize, undefined))).toBe(JSON.stringify(before(grid, minSize)));
        }
        expect(JSON.stringify(groupEras(grid))).toBe(JSON.stringify(before(grid)));
      });
    }
  });
});

describe("eras read in a zone given", () => {
  it("are the same on every phone", () => {
    for (const zone of ZONES) {
      expect(on(zone, () => counted(groupEras(nye, 2, "Europe/Lisbon"))), zone).toEqual(["Lisbon 2024: 2"]);
      expect(on(zone, () => counted(groupEras(nye, 1, "America/New_York"))), zone).toEqual(["Lisbon 2023: 3"]);
    }
  });

  it("read a season in that zone too", () => {
    // The last hours of February in Lisbon are already March in Tokyo.
    const turn = [post("w1", "2024-02-29T22:00:00Z"), post("w2", "2024-02-29T23:30:00Z")];
    expect(on("Asia/Tokyo", () => counted(groupEras(turn)))).toEqual(["Spring 2024: 2"]);
    expect(on("Asia/Tokyo", () => counted(groupEras(turn, 2, "Europe/Lisbon")))).toEqual(["Winter 2024: 2"]);
  });

  it("are read on the calendar once: a grid read again, as every change reads it, is not read anew", () => {
    // A zone no other case reads in.
    const formatToParts = Intl.DateTimeFormat.prototype.formatToParts;
    let reads = 0;
    try {
      Intl.DateTimeFormat.prototype.formatToParts = function (date) {
        reads++;
        return formatToParts.call(this, date);
      };
      const first = counted(groupEras(nye, 1, "Australia/Eucla"));
      expect(reads).toBe(nye.length);
      expect(counted(groupEras(nye, 1, "Australia/Eucla"))).toEqual(first);
      expect(reads).toBe(nye.length);
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = formatToParts;
    }
  });

  it("are read on the phone's own calendar where the zone cannot be read", () => {
    for (const zone of ZONES) {
      on(zone, () => expect(counted(groupEras(nye, 2, "Not/A_Zone"))).toEqual(counted(groupEras(nye))));
    }
    // A zone no other case reads in, so nothing of it has been kept from before.
    const formatToParts = Intl.DateTimeFormat.prototype.formatToParts;
    try {
      Intl.DateTimeFormat.prototype.formatToParts = () => {
        throw new RangeError("no calendar here");
      };
      expect(on("America/New_York", () => counted(groupEras(nye, 2, "Asia/Kathmandu")))).toEqual(["Lisbon 2023: 3"]);
    } finally {
      Intl.DateTimeFormat.prototype.formatToParts = formatToParts;
    }
  });
});

describe("a member's names and moves, wherever they are read", () => {
  // The author, at home in Lisbon, names the era their phone shows, and
  // moves the last photograph of 2023 into it. Their first save keeps
  // their phone's zone (changeEraEdits); here it is put on by hand.
  const author = on("Europe/Lisbon", () => {
    const zone = deviceZone();
    let edits: EraEdits = renameEra(NO_EDITS, "Lisbon 2024", "New Year", nye);
    edits = moveToEra(edits, nye, "n1", "Lisbon 2024");
    return { ...edits, zone };
  });

  it("keep the zone of the phone that first saved them", () => {
    expect(author).toEqual({ titles: { "Lisbon 2024": "New Year" }, moves: { n1: "Lisbon 2024" }, zone: "Europe/Lisbon" });
  });

  it("give the author and a reader in any other zone the same eras, by the same names", () => {
    for (const zone of ZONES) {
      const eras = on(zone, () => editEras(nye, author));
      expect(
        eras.map((e) => [e.key, e.title, e.posts.map((p) => p.id).join(" ")]),
        zone,
      ).toEqual([["Lisbon 2024", "New Year", "n3 n2 n1"]]);
    }
  });

  it("before the move, show the name over the same two photographs everywhere", () => {
    const named = { ...author, moves: {} };
    for (const zone of ZONES) {
      const summary = on(zone, () => editedEraSummary(nye, named));
      expect(counted(summary.eras), zone).toEqual(["New Year: 2"]);
      expect(summary.apart, zone).toBe(1);
    }
  });

  it("offer the same places to move to, and open the same gallery, everywhere", () => {
    for (const zone of ZONES) {
      on(zone, () => {
        expect(moveChoices(nye, author, "n1").map((c) => [c.key, c.title, c.here]), zone).toEqual([["Lisbon 2024", "New Year", true]]);
        expect(galleryRows(nye, "taken", "Lisbon 2024", "n2", author), zone).toEqual({ rows: [nye[2], nye[1], nye[0]], era: "New Year" });
        // The move, made again from any zone (the author travelling), is the same move.
        expect(moveToEra({ ...author, moves: {} }, nye, "n1", "Lisbon 2024"), zone).toEqual(author);
      });
    }
  });

  it("are lost on a reader in another zone without the zone, as they were before it was kept", () => {
    const unzoned = { titles: author.titles, moves: author.moves };
    expect(on("America/New_York", () => counted(editEras(nye, unzoned)))).toEqual(["Lisbon 2023: 3"]);
  });
});
