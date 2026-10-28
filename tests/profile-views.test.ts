import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PROFILE_VIEWS, galleryRows, opensGallery, revealOffset, type ProfileView } from "@/utils/profileViews";

/**
 * The six ways a profile reads: their order on the toggle, where a tap in
 * each one goes, what the gallery holds when an era opens it, and, read
 * from the source, the lines that keep Eras to a member's own photographs
 * and off a page that is locked.
 */

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the toggle's order", () => {
  it("puts Eras between Timeline and Map, and Places last", () => {
    expect(PROFILE_VIEWS.map((v) => v.label)).toEqual(["Posted", "Taken", "Timeline", "Eras", "Map", "Places"]);
    expect(PROFILE_VIEWS.map((v) => v.view)).toEqual(["posted", "taken", "timeline", "eras", "map", "places"]);
  });
});

describe("a tap on a photograph", () => {
  const all: ProfileView[] = ["posted", "taken", "timeline", "eras", "map", "places"];

  it("opens the gallery from the grids and the eras, the post from the rest", () => {
    expect(all.filter((v) => opensGallery(v, {}))).toEqual(["posted", "taken", "eras"]);
  });

  it("always opens a photograph you were tagged in on its own", () => {
    for (const v of all) expect(opensGallery(v, { tagged_in: true })).toBe(false);
  });
});

describe("the gallery an era opens", () => {
  const post = (id: string, taken: string | null, location: string | null, created: string) => ({
    id,
    taken_at: taken,
    created_at: created,
    location,
  });
  const rows = [
    post("new", "2026-01-02T12:00:00", "Kyoto", "2026-01-03T12:00:00"),
    post("s1", "2023-04-02T12:00:00", "St. Barths", "2025-06-01T12:00:00"),
    post("x", null, null, "2025-05-01T12:00:00"),
    post("s2", "2023-04-05T12:00:00", "St. Barths", "2024-01-01T12:00:00"),
  ];

  it("holds that era alone, newest capture first", () => {
    expect(galleryRows(rows, "taken", "St. Barths 2023")).toEqual({ rows: [rows[3], rows[1]], era: "St. Barths 2023" });
  });

  it("falls back to the whole taken order once the era has come apart", () => {
    const left = rows.filter((p) => p.id !== "s2");
    const shown = galleryRows(left, "taken", "St. Barths 2023");
    expect(shown.era).toBeNull();
    expect(shown.rows.map((p) => p.id)).toEqual(["new", "x", "s1"]);
  });

  it("is the grid's own order without one", () => {
    expect(galleryRows(rows, "posted", undefined)).toEqual({ rows, era: null });
    expect(galleryRows(rows, "taken", undefined).rows.map((p) => p.id)).toEqual(["new", "x", "s2", "s1"]);
  });
});

describe("the toggle's scroll", () => {
  it("stays put when the current option is in view", () => {
    expect(revealOffset({ x: 10, width: 40 }, 300, 340, 16)).toBe(0);
  });

  it("brings an option past the edge into view, with room after it", () => {
    expect(revealOffset({ x: 290, width: 40 }, 300, 340, 16)).toBe(40); // never past the end of the row
    expect(revealOffset({ x: 250, width: 40 }, 300, 400, 16)).toBe(6);
  });

  it("never scrolls a row that fits", () => {
    expect(revealOffset({ x: 260, width: 40 }, 300, 300, 16)).toBe(0);
  });
});

describe("the toggle, read from the source", () => {
  const toggle = code("src/components/GridSortToggle.tsx");

  it("draws its options from the one list, each a radio", () => {
    expect(toggle).toMatch(/PROFILE_VIEWS\.map\(/);
    expect(toggle).toMatch(/accessibilityRole="radio"/);
    expect(toggle).toMatch(/accessibilityRole="radiogroup" accessibilityLabel="Profile view"/);
    expect(toggle).not.toMatch(/label="(Posted|Taken|Timeline|Eras|Map|Places)"/);
  });

  it("drops the visible label, and keeps the group's name for VoiceOver", () => {
    expect(toggle).not.toMatch(/Profile view:/);
  });

  it("opens with the current option in view, without a visible scroll", () => {
    expect(toggle).toMatch(/scrollTo\(\{ x, animated: false \}\)/);
    expect(toggle).toMatch(/onContentSizeChange=/);
    expect(toggle).toMatch(/placed\.current = true/);
  });
});

describe("Eras on the profiles, read from the source", () => {
  const own = code("app/(tabs)/profile.tsx");
  const member = code("app/user/[username].tsx");
  const eras = (screen: string) => screen.match(/view === "eras"[^?]*\? \(\s*<EraList[\s\S]*?\/>/)?.[0] ?? "";

  it("are drawn on your own page from your own photographs, not the ones you were tagged in", () => {
    const branch = eras(own);
    expect(branch).toMatch(/posts=\{posts\.data \?\? \[\]\}/);
    expect(branch).not.toMatch(/rows|tagged/);
    expect(branch).toMatch(/onOpenPost=\{openEra\}/);
  });

  it("are drawn on a member's page only when it is not locked, from their own photographs", () => {
    const branch = eras(member);
    expect(branch).toMatch(/^view === "eras" && !locked \?/);
    expect(branch).toMatch(/posts=\{postsQ\.data \?\? \[\]\}/);
    expect(branch).not.toMatch(/shown|rows|taggedQ/);
    expect(branch).toMatch(/member=\{profile\.username\}/);
  });

  it("sit between the timeline and the grid in both screens, every view here guarded", () => {
    expect(member).toMatch(/view === "timeline" && !locked \?[\s\S]*?view === "eras" && !locked \?/);
    expect(own).toMatch(/view === "timeline" \?[\s\S]*?view === "eras" \?/);
  });

  it("open the author's gallery held to the era, in taken order", () => {
    for (const screen of [own, member]) {
      expect(screen).toMatch(/const openEra = \(p: PostRow, era: string\) =>/);
      expect(screen).toMatch(/params: \{ authorId: p\.author_id, postId: p\.id, sort: "taken", era \}/);
      expect(screen).toMatch(/if \(!opensGallery\(view, p\)\)/);
    }
  });
});

describe("the Eras view, read from the source", () => {
  const list = code("src/components/EraList.tsx");

  it("draws every print as the grid's small copy", () => {
    expect(list).toMatch(/import \{ PhotoTile \} from "\.\/PhotoGrid"/);
    expect(list).not.toMatch(/mediaUrl|<Image\b|expo-image/);
  });

  it("gathers with the eras On this day uses", () => {
    expect(list).toMatch(/eraSummary\(posts\)/);
    expect(list).not.toMatch(/groupByPlace|groupEras\(/);
  });

  it("names the eras as headers and the prints as image buttons", () => {
    expect(list).toMatch(/accessibilityRole="header" accessibilityLabel=\{eraHeading\(era\)\}/);
    expect(list.match(/accessibilityLabel=\{printLabel\(/g)).toHaveLength(2);
    const tile = code("src/components/PhotoGrid.tsx");
    expect(tile).toMatch(/accessibilityRole=\{accessibilityLabel \? "imagebutton" : undefined\}/);
  });

  it("shows the grid's skeleton while the photographs arrive", () => {
    expect(list).toMatch(/\{loading \? \(\s*<GridSkeleton \/>/);
  });
});

describe("the gallery, read from the source", () => {
  const gallery = code("app/gallery.tsx");

  it("reads the era from its address and holds it through galleryRows", () => {
    expect(gallery).toMatch(/const \{ authorId, postId, sort, era \} = useLocalSearchParams/);
    expect(gallery).toMatch(/galleryRows\(postsQ\.data \?\? \[\], sort, era\)/);
    expect(gallery).toMatch(/title: shown\.era \?\? authorQ\.data\?\.username \?\? ""/);
  });
});
