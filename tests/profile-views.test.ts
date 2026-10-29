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
    expect(galleryRows(rows, "taken", "St. Barths 2023", "s1")).toEqual({ rows: [rows[3], rows[1]], era: "St. Barths 2023" });
  });

  it("falls back to the whole taken order once the era has come apart", () => {
    const left = rows.filter((p) => p.id !== "s2");
    const shown = galleryRows(left, "taken", "St. Barths 2023", "s1");
    expect(shown.era).toBeNull();
    expect(shown.rows.map((p) => p.id)).toEqual(["new", "x", "s1"]);
  });

  it("falls back the same for a photograph that is in no era", () => {
    const shown = galleryRows(rows, "taken", "St. Barths 2023", "x");
    expect(shown.era).toBeNull();
    expect(shown.rows.map((p) => p.id)).toEqual(["new", "x", "s2", "s1"]);
  });

  it("keeps the rest of the era when the photograph tapped leaves while the gallery is open", () => {
    const trip = [...rows, post("s3", "2023-04-07T12:00:00", "St. Barths", "2024-01-02T12:00:00")];
    const left = trip.filter((p) => p.id !== "s1");
    expect(galleryRows(left, "taken", "St. Barths 2023", "s1")).toEqual({ rows: [left[3], left[2]], era: "St. Barths 2023" });
    // And by the title alone when no photograph was named.
    expect(galleryRows(trip, "taken", "St. Barths 2023", undefined).era).toBe("St. Barths 2023");
    // Gone, and its title no longer an era: the whole taken order.
    expect(galleryRows(rows, "taken", "Somewhere else 1999", "gone").era).toBeNull();
  });

  // What expo-router hands the gallery: the title encoded once on the way
  // out, then decoded twice on the way in.
  const throughAddress = (title: string) => {
    const once = new URL(`/gallery?era=${encodeURIComponent(title)}`, "https://vintage.example").searchParams.get("era") ?? "";
    try {
      return decodeURIComponent(once);
    } catch {
      return once;
    }
  };

  it("finds the era by its photograph, whatever the address made of its title", () => {
    for (const place of ["Studio %41", "Bar 50%25", "Café & Bar", "東京 🗼", "A+B/C?d=e#f"]) {
      const trip = [
        post("t1", "2024-05-02T12:00:00", place, "2024-05-03T12:00:00"),
        post("t2", "2024-05-04T12:00:00", place, "2024-05-05T12:00:00"),
        ...rows,
      ];
      const title = `${place} 2024`;
      const shown = galleryRows(trip, "taken", throughAddress(title), "t1");
      expect(shown.era).toBe(title);
      expect(shown.rows.map((p) => p.id)).toEqual(["t2", "t1"]);
    }
    expect(throughAddress("Studio %41 2024")).toBe("Studio A 2024"); // the address really does change it
  });

  it("titles the gallery with the era's own title, not the address's", () => {
    expect(galleryRows(rows, "taken", "Somewhere else 1999", "s2").era).toBe("St. Barths 2023");
  });

  it("is the grid's own order without one", () => {
    expect(galleryRows(rows, "posted", undefined, "s1")).toEqual({ rows, era: null });
    expect(galleryRows(rows, "taken", undefined, "s1").rows.map((p) => p.id)).toEqual(["new", "x", "s2", "s1"]);
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

  const style = (name: string) => toggle.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";
  const num = (block: string, prop: string) => Number(block.match(new RegExp(`${prop}: ([\\d.]+)`))?.[1]);
  const scrollView = toggle.slice(toggle.search(/<ScrollView\s/), toggle.indexOf("</ScrollView>"));

  it("draws its options from the one list, each a radio", () => {
    expect(toggle).toMatch(/PROFILE_VIEWS\.map\(/);
    expect(toggle).toMatch(/accessibilityRole="radio"/);
    expect(toggle).not.toMatch(/label="(Posted|Taken|Timeline|Eras|Map|Places)"/);
  });

  it("names the group with the label on screen, held still outside the scroll", () => {
    const label = toggle.match(/<Text nativeID=\{labelId\} style=\{styles\.label\} numberOfLines=\{1\}>\s*Profile view\s*<\/Text>/);
    expect(label).not.toBeNull();
    expect(toggle.indexOf(label![0])).toBeLessThan(toggle.search(/<ScrollView\s/));
    expect(scrollView).not.toContain("Profile view");
    // The readers that announce a group take its name from those words, so there is no second copy to drift.
    expect(toggle).toMatch(/const labelId = useId\(\);/);
    expect(toggle).toMatch(/<View style=\{styles\.row\} accessibilityRole="radiogroup" aria-labelledby=\{labelId\}>/);
    expect(toggle).not.toMatch(/accessibilityLabel="Profile view"/);
  });

  it("lets VoiceOver hear the group's name once: the label, then six radios that say only their own", () => {
    // The old stand-in for the missing label, "Profile view, Posted", would now say it twice.
    expect(toggle).not.toMatch(/Profile view,|spoken/);
    const option = toggle.slice(toggle.indexOf("function Option"), toggle.indexOf("const styles"));
    expect(option).toMatch(/accessibilityRole="radio" accessibilityState=\{\{ selected: active \}\}/);
    expect(option).not.toMatch(/accessibilityLabel/);
    // Making the row an element would swallow the radios.
    expect(toggle).not.toMatch(/\baccessible\b/);
  });

  it("keeps the views' names their own size, the label below them, and the current one in ink", () => {
    expect(num(style("option"), "fontSize")).toBe(9);
    expect(num(style("option"), "letterSpacing")).toBe(1.2);
    expect(num(style("label"), "fontSize")).toBeLessThan(num(style("option"), "fontSize"));
    expect(style("label")).toMatch(/fontFamily: type\.mono/);
    expect(style("label")).toMatch(/color: colors\.inkFaint/);
    expect(style("label")).toMatch(/flexShrink: 0/);
    expect(style("optionOn")).toMatch(/color: colors\.ink\b/);
    expect(toggle).toMatch(/style=\{\[styles\.option, active && styles\.optionOn\]\}/);
  });

  it("fits the six beside the label on a 390 pt phone, and lets them run out to the edge where they do not", () => {
    // Courier New sets every letter 0.6 em wide; a divider is narrower than 0.3 em of its size.
    const words = PROFILE_VIEWS.map((v) => v.label);
    const optionSize = num(style("option"), "fontSize");
    const tracked = (text: string, size: number, tracking: number) => text.length * (size * 0.6 + tracking);
    const views =
      words.reduce((sum, w) => sum + tracked(w, optionSize, num(style("option"), "letterSpacing")), 0) +
      (words.length - 1) * num(style("divider"), "fontSize") * 0.3 +
      (words.length * 2 - 2) * num(style("options"), "gap");
    const gap = Number(toggle.match(/const LABEL_GAP = (\d+);/)?.[1]);
    const label = tracked("Profile view", num(style("label"), "fontSize"), num(style("label"), "letterSpacing"));
    const margin = 16; // spacing.lg, on the left of the row and inside the scroll on the right
    expect(margin + label + gap + 1 + gap + views + margin).toBeLessThanOrEqual(390);
    // The row has no right margin of its own: a row that scrolls is cut by the edge of the phone.
    expect(style("row")).toMatch(/paddingLeft: spacing\.lg/);
    expect(style("row")).not.toMatch(/paddingHorizontal|paddingRight/);
    expect(style("options")).toMatch(/paddingRight: spacing\.lg/);
  });

  it("opens with the current option in view, measured against the scroll's own window", () => {
    expect(toggle).toMatch(/scrollTo\(\{ x, animated: false \}\)/);
    expect(toggle).toMatch(/onContentSizeChange=/);
    expect(toggle).toMatch(/placed\.current = true/);
    // The label takes its width from the row, so only the ScrollView knows how much is left for the views.
    expect(scrollView).toMatch(/onLayout=\{\(e\) => \{\s*room\.current\.viewport = e\.nativeEvent\.layout\.width;/);
    expect(toggle.match(/room\.current\.viewport =/g)).toHaveLength(1);
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

  it("can always be left on a member's page, however few photographs remain", () => {
    // One photograph makes no era: without the toggle, Eras would hide it.
    expect(member).toMatch(/\(postsQ\.data \?\? \[\]\)\.length > 1 \|\| view !== "posted" \? \(\s*<GridSortToggle /);
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

  it("draws every print with the grid's own tile, so each is filtered and postered as the grid's are", () => {
    expect(list).toMatch(/import \{ PhotoTile \} from "\.\/PhotoGrid"/);
    expect(list).not.toMatch(/mediaUrl|<Image\b|expo-image|needsDisplayFilter|cssFilterFor/);
  });

  it("draws only a lead full size, and only once its chapter has come near the screen", () => {
    expect(list.match(/<PhotoTile\b[\s\S]*?\/>/g)?.filter((t) => /\bfull=/.test(t))).toEqual([
      expect.stringMatching(/post=\{lead\}[\s\S]*full=\{near\}/),
    ]);
    expect(list).toMatch(/near=\{near\.has\(era\.title\)\}/);
    expect(list).toMatch(/setNear\(\(prev\) => chaptersNear\(prev, spans\.current, offset\.current, height\)\)/);
    expect(list).toMatch(/onScroll=\{\(e\) => \{\s*offset\.current = e\.nativeEvent\.contentOffset\.y;\s*look\(\);/);
    expect(list).toMatch(/scrollEventThrottle=\{100\}/);
    expect(list).toMatch(/spans\.current\.set\(era\.title, \{ top: y, height: tall \}\);\s*look\(\);/);
  });

  it("gives a full lead the photograph over its small copy, and a film only its poster", () => {
    const tile = code("src/components/PhotoGrid.tsx");
    expect(tile).toMatch(/const large = full && !isVideo \? mediaUrl\("media", post\.media_path\) : null;/);
    expect(tile).toMatch(/const url = large \?\? small;/);
    expect(tile).toMatch(/placeholder=\{large \? small : undefined\}\s*placeholderContentFit="cover"/);
    // The film's look is the post's, whichever copy is drawn.
    expect(tile).toMatch(/const live = needsDisplayFilter\(post\) \? cssFilterFor\(getFilter\(post\.filter_id\)\)\.filter : null;/);
    expect(tile.match(/<Image\b/g)).toHaveLength(1);
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
    expect(gallery).toMatch(/galleryRows\(postsQ\.data \?\? \[\], sort, era, postId\)/);
    expect(gallery).toMatch(/title: shown\.era \?\? authorQ\.data\?\.username \?\? ""/);
  });
});
