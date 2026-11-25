import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { PostRow } from "@/types/db";

/**
 * The Post tab, where a post begins: read from the source, the few lines
 * that decide where each tap goes and that a tap can only open one thing,
 * the words the page says, and how it is set; and, without a phone, the
 * one print its On this day door may carry from the member's own posts.
 *
 * The tab's privacy contract (what it reads of the library, and when it
 * may ask) is held in darkroom-surfaces.test.ts; its rules and numbers in
 * post-roll.test.ts, post-day-door.test.ts and post-access.test.ts.
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
const layout = code("app/(tabs)/_layout.tsx");
const POST_PARTS = readdirSync(path.join(root, "src/components/post")).map((f) => `src/components/post/${f}`);
const parts = Object.fromEntries(POST_PARTS.map((f) => [path.basename(f, ".tsx"), code(f)]));
const panels = code("src/post/panels.ts");
const openPrintSrc = code("src/post/openPrint.ts");
/** Everything the page draws: the tab and its parts. */
const page = [tab, ...Object.values(parts)].join("\n");
const open = tab.slice(tab.indexOf("const openWith"), tab.indexOf("// Leaving the tab"));

describe("the ways in", () => {
  it("go through the ordinary picker, the camera and the clip picker, then the editor", () => {
    expect(tab).toMatch(/import \{ pickFromLibrary, takeForCompose, type PickedParams \} from "@\/utils\/pickForCompose"/);
    expect(tab).toMatch(/openWith\("photo", \(\) => pickFromLibrary\("photo"\)\)/);
    expect(tab).toMatch(/openWith\("video", \(\) => pickFromLibrary\("video"\)\)/);
    expect(tab).toMatch(/const params = await get\(stop\?\.signal\);/);
    expect(open).toMatch(/if \(params\) router\.push\(\{ pathname: "\/compose", params \}\);/);
    expect(tab.match(/pathname: "\/compose"/g)).toHaveLength(1);
    // Nothing else on the page pushes the editor.
    for (const [name, src] of Object.entries(parts)) expect(src, name).not.toMatch(/\/compose/);
  });

  it("keep the camera to the phone", () => {
    expect(tab).toMatch(/const native = Platform\.OS !== "web";/);
    expect(tab.match(/openWith\("camera", takeForCompose\)/g)).toHaveLength(1);
    expect(tab).toMatch(/native \? \(\) => openWith\("camera", takeForCompose\) : undefined/);
    // The tile is the iPhone's: the roll's rows ask for it only there.
    expect(tab).toMatch(/const ios = Platform\.OS === "ios";/);
    expect(tab).toMatch(/rollRows\(roll\.prints, \{ camera: ios \}\)/);
    expect(tab).toMatch(/wellRows\(\{ camera: ios \}\)/);
  });

  it("open a photograph of the roll through the same one way, and only that one can be stopped", () => {
    expect(tab).toMatch(/void openWith\("print", \(signal\) => openPrint\(print, signal\), print\.id\);/);
    expect(tab).toMatch(/import \{ discardPrintCopy, openPrint, postHaptic \} from "@\/post\/openPrint"/);
    expect(open).toMatch(/const stop = way === "print" \? new AbortController\(\) : null;/);
    expect(tab.match(/new AbortController\(\)/g)).toHaveLength(1);
    // A copy that arrives after the tab was left, or the open was stopped, is thrown away, and nothing is pushed.
    expect(open).toMatch(/if \(params && \(stop\?\.signal\.aborted \|\| !front\.current\)\) \{\s*discardPrintCopy\(params\.uri\);\s*return;\s*\}/);
    // Leaving the tab, or the app going to the background, stops it.
    expect(tab).toMatch(/return \(\) => \{\s*front\.current = false;\s*printStop\.current\?\.abort\(\);\s*\};/);
    expect(tab).toMatch(/if \(state === "background"\) printStop\.current\?\.abort\(\);/);
  });

  it("post with one firm tap: POST, the photograph on the mount, or the selected cell tapped again a moment later", () => {
    const post = tab.slice(tab.indexOf("const post = useCallback"), tab.indexOf("const listRef"));
    expect(post).toMatch(/if \(opening\.current\) return;\s*postHaptic\(\);/);
    const cell = tab.slice(tab.indexOf("const onCell = useCallback"), tab.indexOf("const onCellPost"));
    expect(cell).toMatch(/if \(Date\.now\(\) - sel\.at >= SECOND_TAP_MS\) post\(print\);/);
    expect(cell).toMatch(/select\(print\.id\);/);
    // With any of the photograph's frame scrolled out of view, a photograph tapped is brought up to the mount.
    expect(cell).toMatch(/if \(offset\.current > heroTop\.current \+ heroFrame\(print, W, H\)\.top\) toTop\(\);/);
    expect(tab).toMatch(/scrollToOffset\(\{ offset: 0, animated: !reduceMotionRef\.current \}\)/);
    expect(parts.RollHero).toMatch(/testID="post-post"\s+onPress=\{onPost\}/);
    expect(parts.RollHero).toMatch(/testID="post-hero-photo"\s+onPress=\{onPost\}/);
    // No haptic on selecting: the house is quiet.
    expect(cell).not.toMatch(/Haptic/);
    expect(openPrintSrc).toMatch(/Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Rigid\)/);
  });

  it("open the room and On this day each in one tap, with nothing to confirm on the way", () => {
    expect(tab).toMatch(/const openRoom = useCallback\(\(\) => router\.push\("\/darkroom"\), \[router\]\);/);
    expect(tab).toMatch(/const openDay = useCallback\(\(\) => router\.push\("\/memories"\), \[router\]\);/);
    expect(tab).toMatch(/router\.push\(\{ pathname: "\/darkroom", params: \{ mode: "set-aside" \} \}\)/);
    // The room's door and the roll's foot both go to the room.
    expect(tab).toMatch(/onRoom=\{openRoom\}/);
    expect(tab).toMatch(/<RollFooter held=\{held\} onEnter=\{openRoom\} \/>/);
    expect(page).not.toMatch(/ActionSheet|Modal\b|Alert\.alert/);
  });

  it("say only after the fact that something could not be opened", () => {
    const caught = open.slice(open.indexOf("} catch {"), open.indexOf("} finally {"));
    expect(caught).toMatch(/showAlert\("Couldn’t open that", "It couldn’t be read here\. Try again in a moment, or choose another\."\);\s*$/);
    expect(tab.match(/showAlert\(/g)).toHaveLength(1);
    for (const [name, src] of Object.entries(parts)) expect(src, name).not.toMatch(/showAlert\(/);
    // A photograph that would not come from iCloud says so, offline or not.
    expect(openPrintSrc).toContain('"Couldn’t open that one"');
    expect(openPrintSrc).toContain('"It may be in iCloud, and this iPhone is offline."');
    expect(openPrintSrc).toContain('"It may still be in iCloud. Try again in a moment."');
  });

  it("never prepares a photograph itself, or opens a picker or the library of its own", () => {
    expect(tab).not.toMatch(/@\/media\/nativeMedia|expo-image-manipulator|expo-image-picker|expo-media-library|vintage-library/);
    expect(tab).not.toMatch(/prepareImage|launchImageLibraryAsync|launchCameraAsync|manipulateAsync/);
  });

  it("mounts no renderer: the filters are the editor's", () => {
    for (const src of [tab, ...Object.values(parts)]) expect(src).not.toMatch(/FilteredImage|GLView|expo-gl|@\/filters/);
  });

  it("never scrolls sideways inside the pager: one list, top to bottom", () => {
    expect(page).not.toMatch(/\bhorizontal\b/);
    expect(tab.match(/<FlatList\s/g)).toHaveLength(1);
    expect(page).not.toMatch(/ScrollView/);
    expect(tab).toMatch(/<Screen padded=\{false\}>\s*<FlatList/);
    // Where there is no roll the page is short, and scrolls only when its words outgrow it.
    expect(tab).toMatch(/<Screen padded=\{false\} scroll>/);
  });

  it("draws the roll a screenful at a time, and lets the rest go", () => {
    const list = tab.slice(tab.indexOf("<FlatList"), tab.indexOf("/>", tab.indexOf("showsVerticalScrollIndicator")));
    expect(list).toMatch(/initialNumToRender=\{4\}/);
    expect(list).toMatch(/maxToRenderPerBatch=\{4\}/);
    expect(list).toMatch(/windowSize=\{3\}/);
    expect(list).toMatch(/removeClippedSubviews=\{false\}/);
    expect(list).toMatch(/onEndReached=\{roll\.loadMore\}/);
    expect(list).toMatch(/onEndReachedThreshold=\{1\.5\}/);
    expect(list).toMatch(/scrollEventThrottle=\{16\}/);
    expect(list).toMatch(/extraData=/);
    // A row is drawn again only when something in it changes.
    expect(parts.RollCell).toMatch(/export const RollRow = React\.memo\(/);
    expect(parts.RollCell).toMatch(/export const RollCell = React\.memo\(/);
    expect(tab).toMatch(/selectedId=\{selectedId && item\.items\.some\(\(i\) => i\.key === selectedId\) \? selectedId : null\}/);
  });

  it("says the clip's limit under the ways only where no trimmer holds a clip to it", () => {
    expect(tab).toMatch(/import \{ MAX_VIDEO_SECONDS \} from "@\/utils\/validation"/);
    expect(tab).toMatch(/Platform\.OS !== "ios" \? \(\s*<View style=\{styles\.note\} pointerEvents="none">\s*<Text style=\{styles\.noteText\}[^>]*>\s*Clips up to \{MAX_VIDEO_SECONDS\} seconds\.\s*<\/Text>/);
    expect(parts.WaysRow).toMatch(/hint=\{`Up to \$\{MAX_VIDEO_SECONDS\} seconds, same feed, same grid`\}/);
  });

  it("is told by the tab bar when Post is tapped again, and goes back to the top with the newest", () => {
    const create = layout.slice(layout.indexOf('name="create"'), layout.indexOf('name="activity"'));
    expect(create).toMatch(/listeners=\{\(\{ navigation \}\) => \(\{\s*tabPress: \(\) => \{\s*if \(navigation\.isFocused\(\)\) emitPostAgain\(\);\s*\},\s*\}\)\}/);
    expect(layout).toMatch(/import \{ emitPostAgain \} from "@\/post\/again"/);
    expect(tab).toMatch(/onPostAgain\(\(\) => \{\s*toTop\(\);\s*selectNewest\(\);\s*refresh\(\);\s*\}\)/);
    // Nothing else in the header changed: no NEXT.
    expect(layout).not.toMatch(/NEXT|Next/);
  });
});

describe("one tap, one editor", () => {
  it("is guarded by a ref, checked and set in the tap before anything awaits", () => {
    expect(tab).toMatch(/const opening = useRef\(false\);/);
    const firstAwait = open.indexOf("await");
    const check = open.indexOf("if (opening.current) return;");
    const set = open.indexOf("opening.current = true;");
    expect(firstAwait).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(check);
    expect(set).toBeLessThan(firstAwait);
    expect(open).not.toMatch(/if \(busy|if \(opening\) return/);
  });

  it("lets go however the way in ends: a choice, a cancel or a failure", () => {
    const after = open.slice(open.indexOf("finally"));
    expect(after).toMatch(/opening\.current = false;/);
    expect(after).toMatch(/setBusy\(null\);/);
  });

  it("holds every control while one way in is opening, and shows the spinner only on that one", () => {
    expect(tab).toMatch(/const held = busy !== null;/);
    for (const name of ["PostDoors", "RollHero", "WaysRow", "RollCell", "MountPanel", "RollFooter"]) {
      expect(parts[name], name).toMatch(/disabled=\{held/);
    }
    expect(tab).toMatch(/busy=\{busy\?\.way === "print"\}/);
    expect(tab).toMatch(/cameraBusy=\{busy\?\.way === "camera"\}/);
    expect(tab).toMatch(/const busyId = busy\?\.way === "print" \? \(busy\.id \?\? null\) : null;/);
    // POST's spinner stands in its own box; a cell opening wears the picker's scrim.
    expect(parts.RollHero).toMatch(/\{busy \? \(\s*<ActivityIndicator size="small" color=\{colors\.camera\} \/>/);
    expect(parts.RollCell).toMatch(/const SCRIM = "rgba\(28, 25, 21, 0\.45\)";/);
    // The mount's bar spins only for its own work: CONTINUE waiting on iOS. LIBRARY, in the
    // ways row, spins there alone; only where there is no library is the panel's bar the picker's own.
    const alone = tab.slice(tab.indexOf("if (!door) {"), tab.indexOf("const dim"));
    const available = tab.slice(tab.indexOf("const dim"));
    expect(alone).toMatch(/kind="unavailable"[\s\S]*?busy=\{ways === "photo"\}/);
    expect(available).toMatch(/kind=\{panel \?\? "loading"\}[\s\S]*?busy=\{roll\.asking\}/);
    expect(available).not.toMatch(/ways === "photo"/);
  });

  it("keeps the doors one shape whatever they carry, and whether or not the tab is resting", () => {
    // The fan goes with its count; its prints stand even before their photographs are drawn.
    expect(parts.PostDoors).toMatch(/if \(face\.kind === "fan"\) \{/);
    expect(parts.PostDoors).toMatch(/\{print && pictures \? <Cover print=\{print\} reduceMotion=\{reduceMotion\} \/> : null\}/);
    // The room's stack stands from the first frame, while access is still being read, as frames.
    expect(tab).toMatch(/roomDoorFace\(place\.line, place\.cover, shelf\[0\] \?\? null, allowed \|\| roll\.access === null\)/);
    expect(parts.PostDoors).toMatch(/\{drawn \? <Cover print=\{front\} reduceMotion=\{reduceMotion\} \/> : null\}/);
    // Where the member left off is read from the first frame, not only once the tab is in front.
    expect(tab).toMatch(/const \[place, setPlace\] = useState<Place>\(readPlaceFile\);/);
    // The post's thumbnail fades in only where motion is wanted.
    expect(parts.PostDoors).toMatch(/const \[transition\] = useState\(\(\) => \(reduceMotion \? 0 : POST_FADE_MS\)\);/);
    expect(parts.PostDoors).not.toMatch(/transition=\{200\}/);
  });

  it("counts time in the background as time away for the selection, and moves on from a photograph posted", () => {
    const roll = code("src/post/useRoll.ts");
    expect(roll).toMatch(/if \(state === "background"\) \{\s*if \(focusedRef\.current && leftAt\.current == null\) leftAt\.current = Date\.now\(\);/);
    expect(roll).toMatch(/state === "active" && focusedRef\.current\) \{\s*setRelease\("none"\);\s*if \(leftAt\.current != null\) \{\s*settle\(leftAt\.current\);\s*leftAt\.current = null;/);
    // In front again after a blur, the same rule.
    expect(roll).toMatch(/setHeroReleased\(false\);\s*settle\(leftAt\.current\);\s*leftAt\.current = null;/);
    expect(roll).toMatch(/moved = afterPosting\(sel, shown\.current, developedAt\);/);
    // A photograph newer than the newest shown is selected as a read from the top brings it.
    expect(roll).toMatch(/if \(fromTop && newerArrived\(before, visible\[0\]\)\) \{\s*choose\(visible\[0\]\.id\);/);
    expect(roll.match(/apply\([^;]*, true\);/g)).toHaveLength(3);
    expect(roll.match(/apply\([^;]*, false\);/g)).toHaveLength(1);
    // After SHARE MORE, the whole roll is read again from the top, as far as it was read.
    expect(roll).toMatch(/void front\(true, true\);/);
    expect(roll).toMatch(/if \(deep\) await readAll\(\);/);
  });

  it("keeps the memory on today's date, which turns over with the clock", () => {
    expect(tab).toMatch(/const today = useToday\(\);/);
    expect(tab).toMatch(/todaysPrint\(posts\.data, new Date\(today\)\), \[posts\.data, today\]/);
    const hook = tab.slice(tab.indexOf("function useToday"), tab.indexOf("function startOfDay"));
    expect(hook).toMatch(/timer = setTimeout\(turn, tomorrow\(now\) - now\);/);
    expect(hook).toMatch(/AppState\.addEventListener\("change", \(state\) => \{\s*if \(state === "active"\) turn\(\);/);
    const cleanup = hook.slice(hook.indexOf("return () =>"));
    expect(cleanup).toMatch(/clearTimeout\(timer\);/);
    expect(cleanup).toMatch(/sub\.remove\(\);/);
  });

  it("reads the member's own posts once the tab is in front, from the cache the profile shares", () => {
    expect(tab).toMatch(/queryKey: \["user-posts", userId\]/);
    expect(tab).toMatch(/enabled: Boolean\(userId\) && focused,/);
    expect(tab).toMatch(/staleTime: 10 \* 60_000,/);
  });
});

describe("the page's words", () => {
  const all = page + "\n" + panels;

  it("say everything the spec gives them, word for word, each in its part", () => {
    const words: [string, string][] = [
      [parts.PostDoors, "The Memory Room"],
      [code("src/post/roll.ts"), '"Rediscover something worth sharing."'],
      [parts.PostDoors, "On this day"],
      [code("src/post/dayDoor.ts"), '"Every year, on this date."'],
      [parts.PostDoors, "Set aside · {countLabel(n)}"],
      [parts.PostDoors, 'accessibilityHint="Opens your photographs, one at a time, from further back."'],
      [parts.PostDoors, 'accessibilityHint="Opens what you posted and photographed on this date in other years."'],
      [parts.PostDoors, 'accessibilityHint="Opens the photographs you set aside."'],
      [parts.RollHero, '"In iCloud"'],
      [parts.RollHero, "Post"],
      [parts.RollHero, 'accessibilityHint="Opens the selected photograph in the editor. Nothing is shared until you choose Share to VINTAGE."'],
      [parts.WaysRow, "Recent"],
      [parts.WaysRow, 'label="Short video"'],
      [parts.WaysRow, 'label="Library"'],
      [parts.WaysRow, 'hint="Opens your photo library. Nothing is shared until you choose Share to VINTAGE."'],
      [parts.WaysRow, "VINTAGE sees only the photographs you chose."],
      [parts.WaysRow, "Share more"],
      [parts.WaysRow, 'accessibilityHint="Opens iOS’s list of the photographs VINTAGE may see."'],
      [parts.RollCell, "Camera"],
      [parts.RollCell, 'accessibilityHint="Take one now"'],
      [parts.RollCell, '"Opens it in the editor."'],
      [parts.RollCell, '"Selects it."'],
      [parts.RollFooter, "Further back"],
      [parts.RollFooter, "In the Memory Room, one at a time."],
      [parts.RollFooter, 'title="Enter the Memory Room"'],
      [panels, '"Your camera roll"'],
      [panels, '"Your photographs, right here."'],
      [panels, '"VINTAGE shows them on this iPhone only. Nothing leaves it until you post one."'],
      [panels, '"Continue"'],
      [panels, '"Asks to see your photo library."'],
      [panels, '"VINTAGE can’t see your photographs."'],
      [panels, '"Choose one at a time from Library, or let VINTAGE in from Settings. It only ever reads on this iPhone."'],
      [panels, '"Open Settings"'],
      [panels, '"Opens VINTAGE’s page in Settings."'],
      [panels, '"Nothing here yet."'],
      [panels, '"Take one, and it will be the first."'],
      [panels, '"Nothing shared with VINTAGE yet."'],
      [panels, '"Choose the photographs it may see. Nothing leaves this iPhone until you post one."'],
      [panels, '"Your photographs didn’t load."'],
      [panels, '"Try again in a moment."'],
      [panels, '"Try again"'],
      [panels, '"Reads your photographs again."'],
      [panels, '"From your library"'],
      [panels, '"Share a photograph."'],
      [panels, '"The one you have in mind."'],
      [panels, '"Choose a photograph"'],
    ];
    for (const [src, w] of words) expect(src, w).toContain(w);
  });

  it("leave out the words they used to carry", () => {
    for (const gone of [
      "New post",
      "Your best photos",
      "Today in other years",
      "On this day →",
      "From further back than you’d think to look.",
      "Or the one you came with.",
      "One picture at a time.",
      "Nothing here is ranked.",
      "MemoryRoomDoor held",
      "QuietWay",
      "BoxedWay",
    ]) {
      expect(page, gone).not.toContain(gone);
    }
    // The old headline and the picker's bar are the page without a library's alone.
    expect(page).not.toContain("Share a photograph.");
    expect(page).not.toContain("Choose a photograph");
  });

  it("never says Darkroom, never shouts, never leans, and sets its apostrophes as a typographer does", () => {
    expect(all).not.toMatch(/Darkroom/);
    expect(all).not.toMatch(/!["'`]/);
    expect(all).not.toMatch(/fontStyle: "italic"/);
    expect(all).not.toMatch(/"[^"\n]*\w'\w[^"\n]*"|>[^<{]*\w'\w[^<{]*</);
  });

  it("names its headers for VoiceOver: RECENT, a panel's headline, the roll's foot", () => {
    expect(parts.WaysRow).toMatch(/accessibilityRole="header"[^>]*>\s*Recent\s*</);
    // The roll lists photographs only, and VoiceOver hears so.
    expect(parts.WaysRow).toMatch(/accessibilityRole="header"\s+accessibilityLabel="Recent photographs"/);
    expect(parts.MountPanel).toMatch(/<Text style=\{\[styles\.headline, narrow && styles\.headlineNarrow\]\} accessibilityRole="header"/);
    expect(parts.RollFooter).toMatch(/accessibilityRole="header"[^>]*>\s*Further back\s*</);
  });

  it("gives the page one bar in the invitation card's stock, at the roll's foot", () => {
    expect(page.match(/variant="card"/g)).toHaveLength(1);
    const bar = parts.RollFooter.match(/<GateButton\b[\s\S]*?\/>/)?.[0] ?? "";
    expect(bar).toMatch(/variant="card"/);
    expect(bar).toMatch(/style=\{styles\.bar\}/);
    expect(bar).toMatch(/maxFontSizeMultiplier=\{BAR_TYPE_CAP\}/);
    expect(bar).toMatch(/disabled=\{held\}/);
    expect(page.match(/<GateButton\b/g)).toHaveLength(1);
  });

  it("caps the typewriter's capitals sooner than the serif and the system lines, and holds nothing to one line", () => {
    for (const [name, src] of Object.entries(parts)) {
      expect(src, name).not.toMatch(/numberOfLines/);
      if (/<Text/.test(src)) expect(src, name).toMatch(/const BAR_TYPE_CAP = 1\.8;/);
    }
    expect(tab).toMatch(/const TYPE_CAP = 2\.4;/);
    expect(parts.RollHero).toMatch(/<Text style=\{styles\.postWord\} maxFontSizeMultiplier=\{BAR_TYPE_CAP\}>/);
    expect(parts.WaysRow).toMatch(/<Text style=\{styles\.wayWord\} maxFontSizeMultiplier=\{BAR_TYPE_CAP\}>/);
  });
});

describe("what a cell is to VoiceOver", () => {
  it("is a photograph by its date and time, selected or not, with POST as an action of its own", () => {
    const cell = parts.RollCell.slice(parts.RollCell.indexOf("export const RollCell"), parts.RollCell.indexOf("export function CameraTile"));
    expect(cell).toMatch(/accessibilityLabel=\{cellLabel\(print\)\}/);
    expect(cell).toMatch(/accessibilityState=\{\{ selected, busy, disabled: held \}\}/);
    expect(cell).toMatch(/accessibilityActions=\{\[\{ name: "activate" \}, \{ name: "post", label: "Post" \}\]\}/);
    expect(cell).toMatch(/if \(e\.nativeEvent\.actionName === "post"\) onOpen\(print\);/);
    expect(cell).toMatch(/accessibilityIgnoresInvertColors/);
  });

  it("keeps one full-size image on the mount, so a new selection stops the last one's request", () => {
    // A view taken off the screen lets its Photos request run on until it is answered (expo-image's
    // ImageView is held by its own load until then); a view given a new source cancels the last.
    // So only the proof is made afresh for each photograph; the full image is one view, its
    // recycling key clearing the last picture the moment the selection moves.
    const hero = parts.RollHero;
    expect(hero).toMatch(/<Proof key=\{print\.id\} print=\{print\} width=\{frame\.width\} released=\{released\} \/>/);
    const full = hero.slice(hero.indexOf("<Proof key="), hero.indexOf("</Pressable>", hero.indexOf("<Proof key=")));
    expect(full).toMatch(/\{released \|\| heroReleased \? null : \(\s*<Image\s+source=\{printSource\(print\.uri\)\}/);
    expect(full).toMatch(/recyclingKey=\{print\.id\}/);
    expect(full).not.toMatch(/<Image[^]*?key=/);
    // Nothing keyed by the photograph holds the full image.
    const proof = hero.slice(hero.indexOf("function Proof("));
    expect(proof.match(/<Image/g)).toHaveLength(1);
    expect(proof).toMatch(/transition=\{0\}/);
    expect(hero).not.toMatch(/function Picture\(/);
  });

  it("hears the mount's words as one line and POST on its own, and not the photograph", () => {
    expect(parts.RollHero).toMatch(/accessible accessibilityLabel=\{`Selected: \$\{date\}\. \$\{age\}\.`\}/);
    const photo = parts.RollHero.slice(parts.RollHero.indexOf('testID="post-hero-photo"'), parts.RollHero.indexOf("<Proof"));
    expect(photo.length).toBeGreaterThan(0);
    expect(photo).toMatch(/accessibilityElementsHidden/);
    expect(photo).toMatch(/importantForAccessibility="no-hide-descendants"/);
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
