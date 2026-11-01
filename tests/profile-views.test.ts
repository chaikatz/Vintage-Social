import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PROFILE_VIEWS, galleryRows, opensGallery, revealOffset, type ProfileView } from "@/utils/profileViews";
import { dark, light } from "@/theme";

// The theme reads the platform for its faces and its dynamic colours; the toggle's inks are read from its plain strings.
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  DynamicColorIOS: (o: { dark: string }) => o.dark,
}));

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
    // Nor one spread to its window, the last option ending on the margin.
    expect(revealOffset({ x: 246, width: 38 }, 300, 300, 16)).toBe(0);
  });
});

describe("the toggle, read from the source", () => {
  const toggle = code("src/components/GridSortToggle.tsx");

  const style = (name: string) => toggle.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";
  const num = (block: string, prop: string) => Number(block.match(new RegExp(`${prop}: ([\\d.]+)`))?.[1]);
  const scrollView = toggle.slice(toggle.search(/<ScrollView\s/), toggle.indexOf("</ScrollView>"));
  const constant = (name: string) => Number(toggle.match(new RegExp(`const ${name} = ([\\d.]+);`))?.[1]);
  // Courier New sets every letter 0.6 em wide; iOS grows the letters with the text size, not the tracking between them.
  const tracked = (text: string, size: number, tracking: number, scale = 1) => text.length * (size * 0.6 * scale + tracking);
  // A view's name as the row sets it, the tracking after its last letter given back.
  const word = (text: string, scale = 1) =>
    tracked(text, num(style("option"), "fontSize"), constant("TRACKING"), scale) - constant("TRACKING");

  const MARGIN = 16; // spacing.lg, on the left of the row and inside the scroll on the right
  const EDGE = 16; // the room revealOffset leaves after the current option

  /**
   * The row on a phone `screen` points wide, at text size `scale`, as
   * Yoga lays it out: the window the views have once the label has its
   * width, and the line in it, which is as long as the words, the dots and
   * the least room either side of each dot, or as the window, whichever
   * is longer, any room to spare shared out evenly between them. A
   * divider is narrower than 0.3 em of its size. `spots` are the views'
   * places on the line, as their onLayout reports them.
   */
  const lay = (screen: number, scale = 1) => {
    const labelGap = constant("LABEL_GAP");
    const labelSize = Math.min(scale, constant("LABEL_CAP"));
    const label = tracked("Profile view", num(style("label"), "fontSize"), num(style("label"), "letterSpacing"), labelSize);
    const window = screen - MARGIN - label - labelGap - num(style("labelRule"), "width");
    const items = PROFILE_VIEWS.flatMap(({ view, label: name }, i) => [
      ...(i > 0 ? [{ view: null, width: num(style("divider"), "fontSize") * 0.3 * scale }] : []),
      { view, width: word(name, scale) },
    ]);
    const least = items.reduce((sum, it) => sum + it.width, 0) + (items.length - 1) * constant("DOT_GAP");
    const natural = labelGap + least + MARGIN;
    const content = Math.max(window, natural);
    const between = constant("DOT_GAP") + (content - natural) / (items.length - 1);
    const spots = new Map<ProfileView, { x: number; width: number }>();
    let x = labelGap;
    for (const it of items) {
      if (it.view) spots.set(it.view, { x, width: it.width });
      x += it.width + between;
    }
    return { window, content, between, spots, scrolls: natural > window };
  };

  it("draws its options from the one list, each a radio", () => {
    expect(toggle).toMatch(/PROFILE_VIEWS\.map\(/);
    expect(toggle).toMatch(/accessibilityRole="radio"/);
    expect(toggle).not.toMatch(/label="(Posted|Taken|Timeline|Eras|Map|Places)"/);
  });

  it("names the group with the label on screen, held still outside the scroll", () => {
    const label = toggle.match(
      /<Text nativeID=\{labelId\} style=\{styles\.label\} numberOfLines=\{1\} maxFontSizeMultiplier=\{LABEL_CAP\}>\s*Profile view\s*<\/Text>/,
    );
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
    expect(constant("TRACKING")).toBe(1.2);
    expect(style("option")).toMatch(/letterSpacing: TRACKING,/);
    expect(num(style("label"), "fontSize")).toBeLessThan(num(style("option"), "fontSize"));
    expect(style("label")).toMatch(/fontFamily: type\.mono/);
    expect(style("label")).toMatch(/color: colors\.inkSoft/);
    expect(style("label")).toMatch(/flexShrink: 0/);
    expect(style("option")).toMatch(/color: colors\.inkSoft/);
    expect(style("optionOn")).toMatch(/color: colors\.ink\b/);
    expect(toggle).toMatch(/style=\{\[styles\.option, active && styles\.optionOn\]\}/);
  });

  it("sets the label and every view at 4.5:1 or better on the paper, on either print", () => {
    // WCAG's contrast ratio, from each colour's relative luminance.
    const luminance = (hex: string) => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const c = parseInt(hex.slice(i, i + 2), 16) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    expect(style("row")).toMatch(/backgroundColor: colors\.paper\b/);
    for (const name of ["label", "option", "optionOn"]) {
      const ink = style(name).match(/color: colors\.(\w+)/)?.[1] as keyof typeof light;
      for (const print of [light, dark]) {
        expect(print[ink], name).toMatch(/^#[0-9A-F]{6}$/i);
        expect(ratio(print[ink], print.paper), `${name} in ${ink}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("keeps the label small enough at the largest text size that the longest view still shows whole on a 320 pt phone", () => {
    const AX5 = 3.571; // iOS's largest accessibility size, as React Native reads it
    expect(constant("LABEL_CAP")).toBeGreaterThan(1);
    // The views are held to no cap, so at AX5 each is as wide as it gets.
    const longest = Math.max(...PROFILE_VIEWS.map((v) => word(v.label, AX5)));
    expect(longest + EDGE).toBeLessThanOrEqual(lay(320, AX5).window);
  });

  it("grows the line to the window and shares out the room to spare, the same either side of each dot", () => {
    expect(scrollView).toMatch(/contentContainerStyle=\{styles\.options\}/);
    expect(style("options")).toMatch(/flexGrow: 1,/);
    expect(style("options")).toMatch(/justifyContent: "space-between",/);
    expect(style("options")).toMatch(/gap: DOT_GAP,/);
    expect(style("options")).toMatch(/paddingLeft: LABEL_GAP,/);
    expect(style("options")).toMatch(/paddingRight: spacing\.lg\b/);
    // The dots are the line's own children, between the words, so the room goes about them as about the words.
    expect(scrollView).toMatch(/\{i > 0 \? <Text style=\{styles\.divider\}>·<\/Text> : null\}\s*<Option\b/);
    // And a word ends where its ink does, though iOS tracks after its last letter too.
    expect(style("option")).toMatch(/marginRight: -TRACKING,/);
    // The row has no right margin of its own: a row that scrolls is cut by the edge of the phone.
    expect(style("row")).toMatch(/paddingLeft: spacing\.lg/);
    expect(style("row")).not.toMatch(/paddingHorizontal|paddingRight/);
  });

  it("sets the six across the line from 390 pt up, Places ending on the right margin", () => {
    expect([320, 375, 390, 393, 402, 430, 440].filter((screen) => lay(screen).scrolls)).toEqual([320, 375]);
    for (const screen of [390, 393, 402, 430, 440]) {
      const row = lay(screen);
      expect(row.content).toBe(row.window);
      // From the screen's left edge: where the window starts, then along the line.
      const places = row.spots.get("places")!;
      expect(screen - row.window + places.x + places.width, `${screen} pt`).toBeCloseTo(screen - MARGIN, 9);
      // A line that fits is never moved, whichever view is current.
      for (const spot of row.spots.values()) expect(revealOffset(spot, row.window, row.content, EDGE)).toBe(0);
    }
  });

  it("gives the words more room than they had where they fit, and plainly more on the larger phones", () => {
    // Before: 4 pt either side of a dot, and the 1.2 pt of tracking left after each word.
    const before = 4 + 1.2 + 4;
    const room = (screen: number) => 2 * lay(screen).between;
    for (const screen of [390, 393, 402, 430, 440]) expect(room(screen), `${screen} pt`).toBeGreaterThan(before);
    for (const screen of [430, 440]) expect(room(screen), `${screen} pt`).toBeGreaterThanOrEqual(1.75 * before);
    // Where the row scrolls, about what it was, now even about the dot.
    expect(room(375)).toBeCloseTo(before, 0);
  });

  it("scrolls where they do not fit, on the narrower phones or at larger text, opening on the current view", () => {
    const XLARGE = 1.118; // a step up from iOS's default text size, as React Native reads it
    const AX5 = 3.571;
    for (const [screen, scale] of [
      [320, 1],
      [375, 1],
      [393, XLARGE],
      [440, AX5],
    ]) {
      const row = lay(screen, scale);
      const at = `${screen} pt at ${scale}`;
      expect(row.scrolls, at).toBe(true);
      expect(row.between, at).toBe(constant("DOT_GAP"));
      for (const [view, spot] of row.spots) {
        // Scrolled to, a view is whole in the window, clear of the hairline, with the edge's room after it.
        const x = revealOffset(spot, row.window, row.content, EDGE);
        expect(spot.x - x, `${view}, ${at}`).toBeGreaterThanOrEqual(0);
        expect(spot.x + spot.width - x, `${view}, ${at}`).toBeLessThanOrEqual(row.window - EDGE + 1e-9);
      }
      // The last takes the row to its end and no further, where it ends on the margin.
      const places = row.spots.get("places")!;
      expect(revealOffset(places, row.window, row.content, EDGE), at).toBeCloseTo(row.content - row.window, 9);
      expect(revealOffset(row.spots.get("posted")!, row.window, row.content, EDGE), at).toBe(0);
    }
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
    expect(list).toMatch(/near=\{near\.has\(era\.key\)\}/);
    expect(list).toMatch(/setNear\(\(prev\) => chaptersNear\(prev, spans\.current, offset\.current, height\)\)/);
    expect(list).toMatch(/onScroll=\{\(e\) => \{\s*offset\.current = e\.nativeEvent\.contentOffset\.y;\s*look\(\);/);
    expect(list).toMatch(/scrollEventThrottle=\{100\}/);
    expect(list).toMatch(/spans\.current\.set\(era\.key, \{ top: y, height: tall \}\);\s*look\(\);/);
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

  it("gathers with the eras On this day uses, as their member arranged them", () => {
    expect(list).toMatch(/editedEraSummary\(posts, arranged\)/);
    expect(list).toMatch(/const arranged = edits \?\? NO_EDITS;/);
    expect(list).not.toMatch(/groupByPlace|groupEras\(|eraSummary\(posts\)/);
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
    expect(gallery).toMatch(/galleryRows\(postsQ\.data \?\? \[\], sort, era, postId, eraEdits\.data\?\.edits\)/);
    // The author's arrangement, read only when an era opened it, and the rows held until it is in.
    expect(gallery).toMatch(/const eraEdits = useEraEdits\(authorId, Boolean\(era\)\);/);
    expect(gallery).toMatch(/const waiting = Boolean\(era\) && !eraEdits\.isFetched;/);
    expect(gallery).toMatch(/if \(!author \|\| waiting\) return \[\];/);
    expect(gallery).toMatch(/title: shown\.era \?\? authorQ\.data\?\.username \?\? ""/);
  });
});
