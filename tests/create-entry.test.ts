import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PostRow } from "@/types/db";

/**
 * The Post tab, where a post begins: read from the source, the few lines
 * that decide where each tap goes and that a tap can only open one thing,
 * how the page is set so its two ways in are plain at a glance; and,
 * without a phone, the one print its On this day line may carry.
 *
 * The tab's privacy contract (it never reads or asks for the library) and
 * the Memory Room's words on it are held in darkroom-surfaces.test.ts.
 */

// The public address of a stored file, as the app builds it, without a Supabase client.
vi.mock("@/api/media", () => ({
  mediaUrl: (bucket: string, p: string | null) => {
    if (!p) return null;
    if (/^(https?:|blob:|data:|file:)/.test(p)) return p;
    return `https://cdn.test/${bucket}/${p}`;
  },
}));
vi.mock("@/demo/photos", () => ({ DEMO_PREFIX: "demo:" }));

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const tab = code("app/(tabs)/create.tsx");
const gate = code("src/components/gate/GateButton.tsx");
/** One entry of a StyleSheet, as written. */
const style = (src: string, name: string) => src.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";
/** The Memory Room's part of the page, and the library's. */
const room = tab.slice(tab.indexOf("function MemoryRoomDoor"), tab.indexOf("function QuietWay"));
const library = tab.slice(tab.indexOf("<View style={styles.section}>"), tab.indexOf("<OnThisDay"));

describe("the ways in", () => {
  it("go through the ordinary picker, the camera and the clip picker, then the editor", () => {
    expect(tab).toMatch(/import \{ pickFromLibrary, takeForCompose, type PickedParams \} from "@\/utils\/pickForCompose"/);
    expect(tab).toMatch(/onPress=\{\(\) => openWith\("photo", \(\) => pickFromLibrary\("photo"\)\)\}/);
    expect(tab).toMatch(/onPress=\{\(\) => openWith\("camera", takeForCompose\)\}/);
    expect(tab).toMatch(/onPress=\{\(\) => openWith\("video", \(\) => pickFromLibrary\("video"\)\)\}/);
    const open = tab.slice(tab.indexOf("const openWith"), tab.indexOf("const native"));
    expect(open).toMatch(/const params = await get\(\);\s*if \(params\) router\.push\(\{ pathname: "\/compose", params \}\);/);
    expect(tab.match(/pathname: "\/compose"/g)).toHaveLength(1);
  });

  it("never prepares a photograph itself, or opens a picker of its own", () => {
    // The native prepare (2048 px, sRGB) and the clip's trimmer live behind pickForCompose.
    expect(tab).not.toMatch(/@\/media\/nativeMedia|expo-image-manipulator|expo-image-picker|expo-media-library|vintage-library/);
    expect(tab).not.toMatch(/prepareImage|launchImageLibraryAsync|launchCameraAsync|manipulateAsync/);
  });

  it("keeps the camera to the phone", () => {
    expect(tab).toMatch(/const native = Platform\.OS !== "web";/);
    const camera = tab.slice(tab.indexOf("{native ? ("), tab.indexOf('label="Short video"'));
    expect(camera).toMatch(/label="Camera"/);
  });

  it("opens each one in a single tap, with nothing to confirm on the way", () => {
    expect(tab).not.toMatch(/showAlert|Alert\.alert|ActionSheet|Modal\b/);
    // The room is one tap from the page, as the picker is: no sheet, no second page in front of it.
    expect(room).toMatch(/onPress=\{\(\) => router\.push\("\/darkroom"\)\}/);
  });

  it("never scrolls sideways inside the pager", () => {
    expect(tab).not.toMatch(/horizontal|FlatList|ScrollView/);
    expect(tab).toMatch(/<Screen padded=\{false\} scroll>/);
  });

  it("mounts no renderer: the filters are the editor's", () => {
    expect(tab).not.toMatch(/FilteredImage|GLView|expo-gl|@\/filters/);
  });

  it("says the clip's limit on the page, where no trimmer may hold a clip to it", () => {
    expect(tab).toMatch(/import \{ MAX_VIDEO_SECONDS \} from "@\/utils\/validation"/);
    const note = tab.match(/<Text style=\{styles\.waysNoteText\}[^>]*>([^<]*)<\/Text>/)?.[1] ?? "";
    expect(note.trim()).toBe("Clips up to {MAX_VIDEO_SECONDS} seconds.");
    // Under the ways on every platform, and still in the clip's hint.
    const under = tab.slice(tab.indexOf('label="Short video"'), tab.indexOf("<OnThisDay"));
    expect(under).toContain("styles.waysNote");
    expect(under).not.toMatch(/Platform\.OS|native \?/);
    // It is drawn up into the foot of their touch boxes, so it lets their taps through, from a
    // View: Android's Text ignores pointerEvents.
    expect(tab).toMatch(/<View style=\{styles\.waysNote\} pointerEvents="none">\s*<Text style=\{styles\.waysNoteText\}/);
    expect(tab).not.toMatch(/<Text[^>]*pointerEvents/);
    expect(tab).toMatch(/hint=\{`Up to \$\{MAX_VIDEO_SECONDS\} seconds, same feed, same grid`\}/);
  });
});

describe("the page, at a glance", () => {
  it("says what it is for in its one serif line, whether or not there is a Memory Room", () => {
    expect(tab).toMatch(/<Text style=\{styles\.title\}[^>]*>\s*Share a photograph\.\s*<\/Text>/);
    expect(tab.indexOf("Share a photograph.")).toBeLessThan(tab.indexOf("{door ?"));
    expect(tab.match(/fontFamily: type\.serif/g)).toHaveLength(1);
    expect(style(tab, "title")).toMatch(/fontFamily: type\.serif/);
    expect(tab).not.toMatch(/type\.title|fontStyle: "italic"/);
  });

  it("sets its two ways in alike: an eyebrow that names it, one line, and one bar", () => {
    expect(room).toMatch(
      /<Text style=\{\[styles\.eyebrow, styles\.roomEyebrow\]\} accessibilityRole="header"[^>]*>\s*The Memory Room\s*<\/Text>\s*<Text style=\{styles\.line\}[^>]*>\s*\{returnLine \?\? "Rediscover something worth sharing\."\}\s*<\/Text>\s*<GateButton\s+title="Enter the Memory Room"/,
    );
    expect(library).toMatch(
      /<Text style=\{styles\.eyebrow\} accessibilityRole="header"[^>]*>\s*From your library\s*<\/Text>\s*<Text style=\{styles\.line\}[^>]*>\s*The one you have in mind\.\s*<\/Text>\s*<GateButton\s+title="Choose a photograph"/,
    );
    // The room comes first.
    expect(tab.indexOf("<MemoryRoomDoor")).toBeLessThan(tab.indexOf('title="Choose a photograph"'));
  });

  it("gives the two bars the same size, and does not let them look alike", () => {
    expect(tab.match(/<GateButton\b/g)).toHaveLength(2);
    for (const part of [room, library]) {
      const bar = part.match(/<GateButton\b[\s\S]*?\/>/)?.[0] ?? "";
      expect(bar).toMatch(/style=\{styles\.bar\}/);
      expect(bar).toMatch(/maxFontSizeMultiplier=\{BAR_TYPE_CAP\}/);
      expect(bar).toMatch(/disabled=\{held\}/);
    }
    expect(room).toMatch(/title="Enter the Memory Room"\s+variant="card"/);
    expect(library).toMatch(/title="Choose a photograph"\s+variant=\{door \? "outline" : "solid"\}/);
    // The room's bar is the invitation card's brown, ruled and lettered in gold; the library's is ruled in ink.
    expect(style(gate, "card")).toMatch(/backgroundColor: colors\.card, borderWidth: 1, borderColor: colors\.goldSoft/);
    expect(style(gate, "outline")).toMatch(/borderWidth: 1, borderColor: colors\.ink/);
    expect(gate).toMatch(/labelCard: \{ color: colors\.gold \}/);
    expect(gate).toMatch(/: card\s*\? colors\.gold/);
    // Neither variant changes the bar's height: that is the page's.
    expect(style(gate, "card")).not.toMatch(/height|padding|margin/);
  });

  it("keeps the room's bar to its route, and its words to the Memory Room", () => {
    expect(room).toMatch(/router\.push\("\/darkroom"\)/);
    expect(tab).not.toMatch(/Darkroom/);
  });

  it("leaves out the words it used to carry", () => {
    for (const gone of [
      "New post",
      "monthDay",
      "Your best photos",
      "From further back than you’d think to look.",
      "Or the one you came with.",
      "One picture at a time.",
      "Nothing here is ranked.",
      "What you posted on this date in other years\"",
    ]) {
      expect(tab).not.toContain(gone);
    }
  });

  it("names its two parts as headers, so VoiceOver can go from one to the other", () => {
    expect(tab.match(/accessibilityRole="header"/g)).toHaveLength(2);
  });
});

describe("at the largest text sizes on the narrowest phones", () => {
  it("wraps the ways rather than running off the page", () => {
    expect(style(tab, "ways")).toMatch(/flexDirection: "row",\s*flexWrap: "wrap"/);
    expect(style(tab, "ways")).toMatch(/rowGap: spacing\.\w+/);
  });

  it("keeps each bar's centred label clear of its arrow on either side, and lets the bar grow", () => {
    expect(style(tab, "bar")).toMatch(/paddingHorizontal: BAR_INSET/);
    expect(style(tab, "bar")).toMatch(/height: undefined,\s*minHeight: 52/);
    const inset = Number(tab.match(/const BAR_INSET = (\d+);/)?.[1]);
    const right = Number(gate.match(/arrow: \{ position: "absolute", right: (\d+) \}/)?.[1]);
    const size = Number(gate.match(/name="arrow-right" size=\{(\d+)\}/)?.[1]);
    expect(right).toBeGreaterThan(0);
    expect(size).toBeGreaterThan(0);
    expect(inset).toBeGreaterThan(right + size);
  });

  it("holds nothing to one line, so no word is cut short", () => {
    expect(tab).not.toMatch(/numberOfLines/);
  });
});

describe("one tap, one editor", () => {
  const open = tab.slice(tab.indexOf("const openWith"), tab.indexOf("const native"));

  it("is guarded by a ref, checked and set in the tap before anything awaits", () => {
    expect(tab).toMatch(/const opening = useRef\(false\);/);
    const firstAwait = open.indexOf("await");
    expect(firstAwait).toBeGreaterThan(-1);
    const check = open.indexOf("if (opening.current) return;");
    const set = open.indexOf("opening.current = true;");
    expect(check).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(check);
    expect(set).toBeLessThan(firstAwait);
    // Rendered state alone let two taps in one frame both through.
    expect(open).not.toMatch(/if \(busy|if \(opening\) return/);
  });

  it("lets go however the picker ends: a choice, a cancel or a failure", () => {
    const after = open.slice(open.indexOf("finally"));
    expect(after).toMatch(/opening\.current = false;/);
    expect(after).toMatch(/setBusy\(null\);/);
  });

  it("shows the spinner only on the way that was tapped, and rests the others", () => {
    expect(tab).toMatch(/loading=\{busy === "photo"\}/);
    expect(tab).toMatch(/busy=\{busy === "camera"\}/);
    expect(tab).toMatch(/busy=\{busy === "video"\}/);
    expect(tab).toMatch(/const held = busy !== null;/);
    // The two bars, each quiet way's own Pressable, and On this day.
    expect(tab.match(/disabled=\{held\}/g)).toHaveLength(4);
    // Handed to the camera, the clip, the shelf, the room's part of the page and On this day.
    expect(tab.match(/\bheld=\{held\}/g)).toHaveLength(5);
    expect(tab).toMatch(/<MemoryRoomDoor held=\{held\} \/>/);
    expect(tab).toMatch(/<OnThisDay held=\{held\}/);
    // The old busy ring, shown on the library whatever was tapped, is gone.
    expect(tab).not.toMatch(/busy=\{opening\}|Feather/);
  });
});

describe("the Memory Room's way in", () => {
  it("is shown only where there is a Memory Room", () => {
    expect(tab).toMatch(/const door = darkroomAvailable\(\);/);
    expect(tab).toMatch(/\{door \? <MemoryRoomDoor held=\{held\} \/> : null\}/);
  });

  it("says where the member left off, in place of its line, when they were in the room lately", () => {
    expect(room).toMatch(/setReturnLine\(placeLine\(\)\);/);
    expect(room).toMatch(/\{returnLine \?\? "Rediscover something worth sharing\."\}/);
  });

  it("puts SET ASIDE under its bar, counted, and only when something is set aside", () => {
    const shelf = room.slice(room.indexOf("{n > 0 ? ("));
    expect(shelf).toMatch(/^\{n > 0 \? \(\s*<View style=\{\[styles\.ways, styles\.shelf\]\}>\s*<QuietWay\s+label=\{`Set aside · \$\{countLabel\(n\)\}`\}/);
    expect(shelf).toMatch(/spoken=\{`Set aside, \$\{n\} \$\{n === 1 \? "photograph" : "photographs"\}`\}/);
    expect(shelf).toMatch(/onPress=\{\(\) => router\.push\(\{ pathname: "\/darkroom", params: \{ mode: "set-aside" \} \}\)\}/);
    expect(tab).toMatch(/import \{ countLabel \} from "@\/darkroom\/labels"/);
  });

  it("never cuts SET ASIDE short", () => {
    const word = tab.match(/<Text style=\{\[styles\.wayWord, busy && styles\.hidden\]\}[^>]*>\s*\{label\}\s*<\/Text>/)?.[0] ?? "";
    expect(word).not.toBe("");
    expect(word).not.toMatch(/numberOfLines/);
    // The tracked-capitals margin that made its box narrower than its letters ("SET ASID…").
    expect(style(tab, "wayWord")).not.toBe("");
    expect(style(tab, "wayWord")).not.toMatch(/marginRight/);
  });

  it("lets VoiceOver count the shelf, and hear each quiet way by its name", () => {
    expect(tab).toMatch(/accessibilityLabel=\{spoken \?\? label\}/);
  });
});

describe("On this day on the Post tab", () => {
  it("reads the member's own posts from the cache the profile shares, once the tab is in front", () => {
    expect(tab).toMatch(/queryKey: \["user-posts", userId\]/);
    expect(tab).toMatch(/queryFn: \(\) => fetchUserPosts\(userId\)/);
    expect(tab).toMatch(/enabled: Boolean\(userId\) && focused/);
    expect(tab).toMatch(/todaysPrint\(posts\.data/);
  });

  it("draws one print at most, and only one the member posted", () => {
    expect(tab.match(/<Image\b/g)).toHaveLength(1);
    expect(tab).toMatch(/<Image\s+source=\{print\.source\}/);
    expect(tab).not.toMatch(/ph:\/\/|assetId|\.uri\b/);
  });

  it("still opens On this day, which also holds the Eras, from one quiet line", () => {
    expect(tab).toMatch(/onPress=\{\(\) => router\.push\("\/memories"\)\}/);
    expect(tab).toMatch(/<Text style=\{styles\.dayTitle\}[^>]*>\s*On this day →\s*<\/Text>/);
    // The memory's sentence goes under it only on a day that has one.
    expect(tab).toMatch(/\{print \? \(\s*<Text style=\{styles\.dayLine\}[^>]*>\s*\{print\.headline\}/);
  });

  it("reads the day's memory to VoiceOver as what the line says, not as a hint", () => {
    expect(tab).toMatch(/accessibilityLabel=\{print \? `On this day\. \$\{print\.headline\}` : "On this day"\}/);
    expect(tab).toContain('accessibilityHint="Opens what you posted on this date in other years."');
    expect(tab).not.toMatch(/accessibilityHint=\{line\}/);
  });

  it("keeps the memory on today's date, which turns over with the clock", () => {
    expect(tab).toMatch(/const today = useToday\(\);/);
    expect(tab).toMatch(/<OnThisDay [^>]*day=\{today\}/);
    expect(tab).toMatch(/todaysPrint\(posts\.data, new Date\(day\)\), \[posts\.data, day\]/);
    // Only the hook reads the clock.
    const hook = tab.slice(tab.indexOf("function useToday"), tab.indexOf("function startOfDay"));
    expect(hook.match(/Date\.now\(\)/g)?.length).toBeGreaterThan(0);
    expect(tab.match(/Date\.now\(\)/g)?.length).toBe(hook.match(/Date\.now\(\)/g)?.length);
    // At midnight, and whenever the app comes back to the front; both let go with the tab.
    expect(hook).toMatch(/timer = setTimeout\(turn, tomorrow\(now\) - now\);/);
    expect(hook).toMatch(/AppState\.addEventListener\("change", \(state\) => \{\s*if \(state === "active"\) turn\(\);/);
    const cleanup = hook.slice(hook.indexOf("return () =>"));
    expect(cleanup).toMatch(/clearTimeout\(timer\);/);
    expect(cleanup).toMatch(/sub\.remove\(\);/);
  });
});

describe("the print beside On this day", () => {
  const today = new Date(2026, 9, 28, 15, 0);

  function post(over: Partial<PostRow>): PostRow {
    return {
      id: "p1",
      author_id: "u1",
      media_type: "photo",
      media_path: "u1/p1.jpg",
      thumb_path: "u1/p1.jpg",
      width: 1200,
      height: 1500,
      duration_seconds: null,
      filter_id: "seventy",
      filter_baked: true,
      show_date_stamp: false,
      caption: null,
      taken_at: new Date(2023, 9, 28, 9, 30).toISOString(),
      location: "Lisbon",
      lat: null,
      lng: null,
      place_id: null,
      like_count: 0,
      comment_count: 0,
      created_at: new Date(2026, 0, 2).toISOString(),
      removed_at: null,
      removed_by: null,
      ...over,
    } as PostRow;
  }

  it("is nothing at all on a day with no memory", async () => {
    const { todaysPrint } = await import("@/components/onThisDayPrint");
    expect(todaysPrint(undefined, today)).toBeNull();
    expect(todaysPrint([], today)).toBeNull();
    // Today, or posted on this date with no capture date: not a memory.
    expect(todaysPrint([post({ taken_at: new Date(2026, 9, 28, 8).toISOString() })], today)).toBeNull();
    expect(todaysPrint([post({ taken_at: null, created_at: new Date(2023, 9, 28).toISOString() })], today)).toBeNull();
    expect(todaysPrint([post({ taken_at: new Date(2023, 9, 27).toISOString() })], today)).toBeNull();
  });

  it("carries the memory's own sentence, and its thumbnail", async () => {
    const { todaysPrint } = await import("@/components/onThisDayPrint");
    expect(todaysPrint([post({})], today)).toEqual({
      id: "p1",
      headline: "3 years ago today, you were in Lisbon.",
      source: "https://cdn.test/thumbnails/u1/p1.jpg",
      filter: null,
    });
    expect(todaysPrint([post({ location: null })], today)?.headline).toBe("3 years ago today.");
  });

  it("is the newest year's, as On this day lists them", async () => {
    const { todaysPrint } = await import("@/components/onThisDayPrint");
    const older = post({ id: "old", taken_at: new Date(2019, 9, 28).toISOString(), location: "Porto" });
    const newer = post({ id: "new", taken_at: new Date(2025, 9, 28).toISOString(), location: null });
    const print = todaysPrint([older, newer], today);
    expect(print?.id).toBe("new");
    expect(print?.headline).toBe("1 year ago today.");
  });

  it("shows a film by its poster, never the movie", async () => {
    const { todaysPrint } = await import("@/components/onThisDayPrint");
    const clip = post({ media_type: "video", media_path: "u1/p1.mp4", thumb_path: "u1/p1.jpg" });
    expect(todaysPrint([clip], today)?.source).toBe("https://cdn.test/thumbnails/u1/p1.jpg");
    // No poster: the sentence goes alone rather than an image of a movie.
    const bare = post({ media_type: "video", media_path: "u1/p1.mp4", thumb_path: null });
    expect(todaysPrint([bare], today)).toMatchObject({ source: null, filter: null, headline: "3 years ago today, you were in Lisbon." });
  });

  it("prefers a year it can draw, so the line and the print are the same photograph", async () => {
    const { todaysPrint } = await import("@/components/onThisDayPrint");
    const bare = post({ id: "bare", media_type: "video", media_path: "u1/a.mp4", thumb_path: null, taken_at: new Date(2025, 9, 28).toISOString() });
    const drawn = post({ id: "drawn", taken_at: new Date(2020, 9, 28).toISOString(), location: "Kyoto" });
    expect(todaysPrint([bare, drawn], today)).toMatchObject({ id: "drawn", headline: "6 years ago today, you were in Kyoto." });
  });

  it("falls back to the photograph itself when it has no thumbnail", async () => {
    const { printSource } = await import("@/components/onThisDayPrint");
    expect(printSource({ media_type: "photo", media_path: "u1/p1.jpg", thumb_path: null })).toBe("https://cdn.test/media/u1/p1.jpg");
    expect(printSource({ media_type: "video", media_path: "u1/p1.mp4", thumb_path: null })).toBeNull();
  });

  it("wears its film only where the picture was not baked with it, as the grid's squares do", async () => {
    const { todaysPrint } = await import("@/components/onThisDayPrint");
    expect(todaysPrint([post({ filter_baked: true })], today)?.filter).toBeNull();
    const unbaked = todaysPrint([post({ filter_baked: false, filter_id: "archive-bw" })], today);
    expect(unbaked?.filter).toMatch(/grayscale\(1\)/);
    const clip = todaysPrint([post({ media_type: "video", media_path: "u1/p1.mp4", filter_baked: false })], today);
    expect(clip?.filter).toEqual(expect.any(String));
  });
});
