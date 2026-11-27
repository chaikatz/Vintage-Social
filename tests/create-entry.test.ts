import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Post tab, where a post begins, as the owner's mock draws it: read
 * from the source, the few lines that decide where each tap goes and that
 * a tap can only open one thing, the two pages and the header over them,
 * the words the page says, and how it is set.
 *
 * The tab's privacy contract (what it reads of the library, and when it
 * may ask) is held in darkroom-surfaces.test.ts; its numbers in
 * post-roll.test.ts; the slide and the room's door in post-slide.test.ts;
 * the stamp in post-stamp.test.ts; its panels in post-access.test.ts.
 */

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
const parts = Object.fromEntries(POST_PARTS.map((f) => [path.basename(f).replace(/\.tsx$/, ""), code(f)]));
const panels = code("src/post/panels.ts");
const openPrintSrc = code("src/post/openPrint.ts");
/** Everything the page draws: the tab and its parts. */
const page = [tab, ...Object.values(parts)].join("\n");
const open = tab.slice(tab.indexOf("const openWith"), tab.indexOf("// The two pages, and the room pushed once"));

describe("the page's parts", () => {
  it("are the header, the two pagers, the door's page, the frame, its panels, the line and the roll, and nothing else", () => {
    expect(Object.keys(parts).sort()).toEqual(
      ["DoorPage", "MountPanel", "PostHeader", "PostPager", "PostPager.web", "RollCell", "RollHero", "WaysRow"].sort(),
    );
    // The doors band, its shelf line and the roll's foot are gone.
    for (const gone of ["PostDoors", "RollFooter", "OnThisDayDoor", "useDayDoor", "dayDoor", "todaysPrint", "LimitedLine", "footShown"]) {
      expect(page, gone).not.toContain(gone);
    }
  });
});

describe("the ways in", () => {
  it("go through the ordinary picker, the camera and the clip picker, then the editor", () => {
    expect(tab).toMatch(/import \{ pickFromLibrary, takeForCompose, type PickedParams \} from "@\/utils\/pickForCompose"/);
    expect(tab).toMatch(/openWith\("photo", \(\) => pickFromLibrary\("photo"\)\)/);
    expect(tab).toMatch(/openWith\("video", \(\) => pickFromLibrary\("video"\)\)/);
    expect(tab).toMatch(/const params = await get\(stop\?\.signal\);/);
    expect(open).toMatch(/if \(params\) router\.push\(\{ pathname: "\/compose", params: way === "print" \? stampedParams\(params\) : params \}\);/);
    expect(tab.match(/pathname: "\/compose"/g)).toHaveLength(1);
    // Nothing else on the page pushes the editor.
    for (const [name, src] of Object.entries(parts)) expect(src, name).not.toMatch(/\/compose/);
  });

  it("keep the picker's clip path as it was: VIDEO is the trimmer's picker, LIBRARY the photo picker", () => {
    const picker = code("src/utils/pickForCompose.ts");
    expect(picker).toMatch(/mediaTypes: isVideo \? \["videos"\] : \["images"\],/);
    expect(picker).toMatch(/allowsEditing: isVideo && Platform\.OS === "ios",/);
    expect(picker).toMatch(/videoMaxDuration: MAX_VIDEO_SECONDS,/);
    expect(picker).toMatch(/if \(isVideo && clipTooLong\(asset\.duration\)\)/);
    expect(parts.WaysRow).toMatch(/testID="post-way-library"[\s\S]*?onPress=\{onLibrary\}/);
    expect(parts.WaysRow).toMatch(/testID="post-way-video"\s+word="Video"\s+label="Short video"/);
  });

  it("keep the camera to the phone: the roll's first tile on the iPhone, a word on the line where there is no roll", () => {
    expect(tab).toMatch(/const native = Platform\.OS !== "web";/);
    expect(tab.match(/openWith\("camera", takeForCompose\)/g)).toHaveLength(1);
    expect(tab).toMatch(/native \? \(\) => openWith\("camera", takeForCompose\) : undefined/);
    expect(tab).toMatch(/const ios = Platform\.OS === "ios";/);
    expect(tab).toMatch(/rollRows\(roll\.prints, \{ camera: ios, more \}\)/);
    expect(tab).toMatch(/wellRows\(\{ camera: ios \}\)/);
    const alone = tab.slice(tab.indexOf("if (!room) {"), tab.indexOf("const dim"));
    expect(alone).toMatch(/camera=\{native\}/);
    const available = tab.slice(tab.indexOf("const dim"));
    expect(available).toMatch(/<WaysRow[\s\S]*?camera=\{false\}/);
  });

  it("open a photograph of the roll through the same one way, and only that one can be stopped", () => {
    expect(tab).toMatch(/void openWith\("print", \(signal\) => openPrint\(print, signal\), print\.id\);/);
    expect(tab).toMatch(/import \{ discardPrintCopy, openPrint, postHaptic \} from "@\/post\/openPrint"/);
    expect(open).toMatch(/const stop = way === "print" \? new AbortController\(\) : null;/);
    expect(tab.match(/new AbortController\(\)/g)).toHaveLength(1);
    // A copy that arrives after the tab was left, or the open was stopped, is thrown away, and nothing is pushed.
    expect(open).toMatch(/if \(params && \(stop\?\.signal\.aborted \|\| !front\.current\)\) \{\s*discardPrintCopy\(params\.uri\);\s*return;\s*\}/);
    // Leaving the tab, or the app going to the background, stops it.
    expect(tab).toMatch(/return \(\) => \{\s*front\.current = false;\s*printStop\.current\?\.abort\(\);/);
    expect(tab).toMatch(/if \(state === "background"\) printStop\.current\?\.abort\(\);/);
  });

  it("post with one firm tap: POST, the photograph in the frame, or the selected cell tapped again a moment later", () => {
    const post = tab.slice(tab.indexOf("const post = useCallback"), tab.indexOf("const listRef"));
    expect(post).toMatch(/if \(opening\.current\) return;\s*postHaptic\(\);/);
    const cell = tab.slice(tab.indexOf("const onCell = useCallback"), tab.indexOf("const onCellPost"));
    expect(cell).toMatch(/if \(Date\.now\(\) - sel\.at >= SECOND_TAP_MS\) post\(print\);/);
    expect(cell).toMatch(/select\(print\.id\);/);
    // With any of the photograph scrolled out of view, a photograph tapped is brought up to the frame.
    expect(cell).toMatch(/if \(offset\.current > heroTop\.current \+ photoRect\(print, \{ width: frameW, height: frameH \}\)\.top\) toTop\(\);/);
    expect(tab).toMatch(/scrollToOffset\(\{ offset: 0, animated: !reduceMotionRef\.current \}\)/);
    expect(parts.WaysRow).toMatch(/testID="post-post"\s+onPress=\{onPost\}/);
    expect(parts.RollHero).toMatch(/testID="post-hero-photo"\s+onPress=\{onPost\}/);
    expect(tab.match(/onPost=\{\(\) => roll\.selected && post\(roll\.selected\)\}/g)).toHaveLength(2);
    // POST stands only while there is a photograph to post; its place is kept.
    expect(tab).toMatch(/canPost=\{shown != null\}/);
    expect(parts.WaysRow).toMatch(/disabled=\{held \|\| !canPost\}/);
    expect(parts.WaysRow).toMatch(/!canPost && styles\.gone/);
    // No haptic on selecting: the house is quiet.
    expect(cell).not.toMatch(/Haptic/);
    expect(openPrintSrc).toMatch(/Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Rigid\)/);
  });

  it("say only after the fact that something could not be opened", () => {
    const caught = open.slice(open.indexOf("} catch {"), open.indexOf("} finally {"));
    expect(caught).toMatch(/showAlert\("Couldn’t open that", "It couldn’t be read here\. Try again in a moment, or choose another\."\);\s*$/);
    expect(tab.match(/showAlert\(/g)).toHaveLength(1);
    for (const [name, src] of Object.entries(parts)) expect(src, name).not.toMatch(/showAlert\(/);
    expect(page).not.toMatch(/ActionSheet|Modal\b|Alert\.alert/);
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

  it("draws the roll a screenful at a time, and lets the rest go", () => {
    expect(tab.match(/<FlatList\s/g)).toHaveLength(1);
    expect(page).not.toMatch(/ScrollView/);
    const list = tab.slice(tab.indexOf("<FlatList"), tab.indexOf("/>", tab.indexOf("showsVerticalScrollIndicator")));
    expect(list).toMatch(/initialNumToRender=\{4\}/);
    expect(list).toMatch(/maxToRenderPerBatch=\{4\}/);
    expect(list).toMatch(/windowSize=\{3\}/);
    expect(list).toMatch(/removeClippedSubviews=\{false\}/);
    expect(list).toMatch(/onEndReached=\{roll\.loadMore\}/);
    expect(list).toMatch(/onEndReachedThreshold=\{1\.5\}/);
    expect(list).toMatch(/scrollEventThrottle=\{16\}/);
    expect(list).toMatch(/extraData=/);
    expect(list).not.toMatch(/ListFooterComponent/);
    expect(parts.RollCell).toMatch(/export const RollRow = React\.memo\(/);
    expect(parts.RollCell).toMatch(/export const RollCell = React\.memo\(/);
    expect(parts.RollHero).toMatch(/export const RollHero = React\.memo\(/);
    expect(tab).toMatch(/selectedId=\{selectedId && item\.items\.some\(\(i\) => i\.key === selectedId\) \? selectedId : null\}/);
    // The frame's box is made once per window, so the frame and the cells are not drawn again for nothing.
    expect(tab).toMatch(/const frame = useMemo\(\(\) => previewFrame\(W, recentHeight\(windowH, insets\.top, insets\.bottom\)\), \[W, windowH, insets\.top, insets\.bottom\]\);/);
  });

  it("says the clip's limit under the line only where no trimmer holds a clip to it", () => {
    expect(tab).toMatch(/import \{ MAX_VIDEO_SECONDS \} from "@\/utils\/validation"/);
    expect(tab).toMatch(/Platform\.OS !== "ios" \? \(\s*<View style=\{\[styles\.note, \{ marginLeft: frame\.left, width: frame\.width \}\]\} pointerEvents="none">\s*<Text testID="post-clip-note"[^>]*>\s*Clips up to \{MAX_VIDEO_SECONDS\} seconds\.\s*<\/Text>/);
    expect(parts.WaysRow).toMatch(/hint=\{`Up to \$\{MAX_VIDEO_SECONDS\} seconds, same feed, same grid`\}/);
  });

  it("is told by the tab bar when Post is tapped again: Recent, the top, the newest", () => {
    const create = layout.slice(layout.indexOf('name="create"'), layout.indexOf('name="activity"'));
    expect(create).toMatch(/listeners=\{\(\{ navigation \}\) => \(\{\s*tabPress: \(\) => \{\s*if \(navigation\.isFocused\(\)\) emitPostAgain\(\);\s*\},\s*\}\)\}/);
    expect(layout).toMatch(/import \{ emitPostAgain \} from "@\/post\/again"/);
    expect(tab).toMatch(/onPostAgain\(\(\) => \{\s*if \(door\.phase\(\) === "closed"\) toRecent\(\);\s*toTop\(\);\s*selectNewest\(\);\s*refresh\(\);\s*\}\)/);
  });
});

describe("the two pages", () => {
  it("are one pager of two: Recent, with the roll, and the Memory Room's door", () => {
    expect(tab.match(/<PostPager\b/g)).toHaveLength(1);
    expect(tab).toMatch(/<PostPager ref=\{pager\} scrollEnabled=\{!held\} onPageSelected=\{onPageSelected\} onScrollState=\{onScrollState\}>/);
    const pager = tab.slice(tab.indexOf("<PostPager"), tab.indexOf("</PostPager>"));
    expect(pager.indexOf('key="recent"')).toBeLessThan(pager.indexOf('key="door"'));
    expect(pager).toMatch(/<View key="recent" style=\{styles\.page\} collapsable=\{false\}>\s*<FlatList/);
    expect(pager).toMatch(/<View key="door" style=\{styles\.page\} collapsable=\{false\}>\s*<DoorPage \/>/);
    // The header's band reaches into the page by this much, over both pages.
    expect(tab).toMatch(/<View style=\{styles\.below\} \/>\s*<PostPager/);
    expect(tab).toMatch(/below: \{ height: HEADER_BELOW \}/);
  });

  it("have no pager where there is no room: the picker's panel, under the plain title", () => {
    const alone = tab.slice(tab.indexOf("if (!room) {"), tab.indexOf("const dim"));
    expect(alone).not.toMatch(/PostPager|DoorPage/);
    expect(alone).toMatch(/<Screen padded=\{false\} scroll>/);
    expect(layout).toMatch(/const pages = tab === "create" && darkroomAvailable\(\);/);
  });

  it("are named in the header the tabs share, in the title's place, the title kept unseen so the header keeps its height", () => {
    expect(layout).toMatch(/import \{ PostHeader \} from "@\/components\/post\/PostHeader";/);
    expect(layout).toMatch(/style=\{\[styles\.headerTitle, pages && styles\.unseen\]\}/);
    expect(layout).toMatch(/accessibilityElementsHidden=\{pages\}/);
    expect(layout).toMatch(/\{pages \? <PostHeader \/> : null\}/);
    expect(layout).toMatch(/unseen: \{ opacity: 0 \}/);
    // Drawn over the tabs, since its band reaches below the header.
    expect(layout).toMatch(/header: \{[^}]*zIndex: 1,/);
    const head = parts.PostHeader;
    expect(head).toMatch(/bottom: -HEADER_BELOW,\s*height: HEADER_BAND,/);
    expect(head).toMatch(/fontFamily: type\.serif, fontSize: HEAD_WORDS\.size/);
    expect(head).toMatch(/columnGap: HEAD_WORDS\.gap/);
  });

  it("cross their two inks with the pager, natively on the iPhone", () => {
    const head = parts.PostHeader;
    expect(head).toMatch(/const recentInk = pageProgress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[1, 0\], extrapolate: "clamp" \}\);/);
    expect(head).toMatch(/const roomInk = pageProgress\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[0, 1\], extrapolate: "clamp" \}\);/);
    expect(head).toMatch(/<Animated\.Text style=\{\[styles\.word, styles\.ink, \{ opacity: ink \}\]\}/);
    expect(parts.PostPager).toMatch(/Animated\.event\(\[\{ nativeEvent: \{ position: pagePosition, offset: pageOffset \} \}\], \{ useNativeDriver: true \}\)/);
  });

  it("are a pair of tabs to VoiceOver: Recent, selected; Memory Room, a button that opens the room", () => {
    const head = parts.PostHeader;
    expect(head).toMatch(/testID="post-head-recent"\s+word="Recent"[\s\S]*?selected=\{page === 0\}\s+role=\{undefined\}\s+hint=\{undefined\}/);
    expect(head).toMatch(/testID="post-head-room"\s+word="Memory Room"[\s\S]*?selected=\{page === 1\}\s+role="button"\s+hint="Opens the Memory Room\."/);
    expect(head).toMatch(/accessibilityLabel=\{word\}/);
    expect(head).toMatch(/accessibilityState=\{\{ selected \}\}/);
    expect(head).toMatch(/onPress=\{\(\) => askPage\(1\)\}/);
  });

  it("let the browser's mouse slide them: no picture dragged, no words selected, no click after a slide", () => {
    const web = parts["PostPager.web"];
    expect(web).toMatch(/-webkit-user-drag: none/);
    expect(web).toMatch(/user-select: none/);
    expect(web.match(/swallowClick\(\);/g)).toHaveLength(2);
    expect(web).toMatch(/window\.addEventListener\("click", take, true\);/);
  });

  it("draw the door's page in the room's own paper, with nothing of the library on it", () => {
    const door = parts.DoorPage;
    expect(door).toMatch(/page: \{ flex: 1, backgroundColor: colors\.paper/);
    expect(door).not.toMatch(/<Image|printSource|@\/darkroom/);
    expect(door).toMatch(/accessibilityElementsHidden/);
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

  it("holds every control while one way in is opening, the pager too, and shows the spinner only on that one", () => {
    expect(tab).toMatch(/const held = busy !== null;/);
    for (const name of ["RollHero", "WaysRow", "RollCell", "MountPanel"]) {
      expect(parts[name], name).toMatch(/disabled=\{held/);
    }
    expect(tab).toMatch(/scrollEnabled=\{!held\}/);
    expect(tab).toMatch(/posting=\{busy\?\.way === "print"\}/);
    expect(tab).toMatch(/cameraBusy=\{busy\?\.way === "camera"\}/);
    expect(tab).toMatch(/const busyId = busy\?\.way === "print" \? \(busy\.id \?\? null\) : null;/);
    // POST's spinner stands in its own place; a cell opening wears the picker's scrim.
    expect(parts.WaysRow).toMatch(/\{posting \? <ActivityIndicator size="small" color=\{colors\.ink\} style=\{StyleSheet\.absoluteFill\} \/> : null\}/);
    expect(parts.RollCell).toMatch(/const SCRIM = "rgba\(28, 25, 21, 0\.45\)";/);
    // The frame's bar spins only for its own work: CONTINUE waiting on iOS. Only where there is no
    // library is the panel's bar the picker's own.
    const alone = tab.slice(tab.indexOf("if (!room) {"), tab.indexOf("const dim"));
    const available = tab.slice(tab.indexOf("const dim"));
    expect(alone).toMatch(/kind="unavailable"[\s\S]*?busy=\{ways === "photo"\}/);
    expect(available).toMatch(/kind=\{panel \?\? "loading"\}[\s\S]*?busy=\{roll\.asking\}/);
    expect(available).not.toMatch(/ways === "photo"/);
  });

  it("counts time in the background as time away for the selection, and moves on from a photograph posted", () => {
    const roll = code("src/post/useRoll.ts");
    expect(roll).toMatch(/if \(state === "background"\) \{\s*if \(focusedRef\.current && leftAt\.current == null\) leftAt\.current = Date\.now\(\);/);
    expect(roll).toMatch(/state === "active" && focusedRef\.current\) \{\s*setRelease\("none"\);\s*if \(leftAt\.current != null\) \{\s*settle\(leftAt\.current\);\s*leftAt\.current = null;/);
    expect(roll).toMatch(/setHeroReleased\(false\);\s*settle\(leftAt\.current\);\s*leftAt\.current = null;/);
    expect(roll).toMatch(/moved = afterPosting\(sel, shown\.current, developedAt\);/);
    expect(roll).toMatch(/if \(fromTop && newerArrived\(before, visible\[0\]\)\) \{\s*choose\(visible\[0\]\.id\);/);
    expect(roll.match(/apply\([^;]*, true\);/g)).toHaveLength(3);
    expect(roll.match(/apply\([^;]*, false\);/g)).toHaveLength(1);
    expect(roll).toMatch(/void front\(true, true\);/);
    expect(roll).toMatch(/if \(deep\) await readAll\(\);/);
  });

  it("keeps a way to share more under a limited selection: the tile after the camera, or the empty panel's bar", () => {
    expect(tab).toMatch(/const more = roll\.access === "limited" && roll\.prints\.length > 0;/);
    expect(tab).toMatch(/onShareMore=\{roll\.shareMore\}/);
    expect(parts.RollCell).toMatch(/item\.kind === "more" \? \(\s*<ShareMoreTile key=\{item\.key\} size=\{size\} held=\{held\} onPress=\{onShareMore\} \/>/);
    expect(panels).toMatch(/bar: \{ label: "Share more", hint: SHARE_MORE_HINT, act: "shareMore" \}/);
  });
});

describe("the page's words", () => {
  const all = page + "\n" + panels;

  it("say everything the mock and the spec give them, word for word, each in its part", () => {
    const words: [string, string][] = [
      [parts.PostHeader, 'word="Recent"'],
      [parts.PostHeader, 'word="Memory Room"'],
      [parts.PostHeader, 'hint="Opens the Memory Room."'],
      [parts.DoorPage, "The Memory Room"],
      [parts.DoorPage, "One photograph at a time."],
      [parts.RollHero, '"In iCloud"'],
      [parts.RollHero, 'accessibilityHint="Opens it in the editor."'],
      [parts.RollHero, "accessibilityLabel={`Selected: ${date}. ${age}.`}"],
      [parts.WaysRow, "Post"],
      [parts.WaysRow, 'accessibilityHint="Opens the selected photograph in the editor. Nothing is shared until you choose Share to VINTAGE."'],
      [parts.WaysRow, 'label="Library"'],
      [parts.WaysRow, 'word="Video"'],
      [parts.WaysRow, 'label="Short video"'],
      [parts.WaysRow, 'hint="Opens your photo library. Nothing is shared until you choose Share to VINTAGE."'],
      [parts.RollCell, 'accessibilityLabel="Camera"'],
      [parts.RollCell, 'accessibilityHint="Take one now"'],
      [parts.RollCell, "Share more"],
      [parts.RollCell, 'accessibilityHint="VINTAGE sees only the photographs you chose. Opens iOS’s list of them."'],
      [parts.RollCell, '"Opens it in the editor."'],
      [parts.RollCell, '"Selects it."'],
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

  it("leave out the words the page used to carry", () => {
    for (const gone of [
      "Rediscover something worth sharing.",
      "Every year, on this date.",
      "Set aside ·",
      "Further back",
      "In the Memory Room, one at a time.",
      "Enter the Memory Room",
      "Recent photographs",
      "VINTAGE sees only the photographs you chose.\n",
      "On this day",
      'label="Short video"\n        hint={`Up to ${MAX_VIDEO_SECONDS} seconds, same feed, same grid`}\n        icon',
    ]) {
      expect(page, gone).not.toContain(gone);
    }
    // No word on the camera's tile: its mark, as the mock draws it.
    expect(parts.RollCell).not.toMatch(/cameraWord/);
    // The page has no title of its own: the header's two words are its names.
    expect(tab).not.toMatch(/accessibilityRole="header"/);
  });

  it("never says Darkroom, never shouts, never leans, and sets its apostrophes as a typographer does", () => {
    expect(all).not.toMatch(/Darkroom/);
    expect(all).not.toMatch(/!["'`]/);
    expect(all).not.toMatch(/fontStyle: "italic"/);
    expect(all).not.toMatch(/"[^"\n]*\w'\w[^"\n]*"|>[^<{]*\w'\w[^<{]*</);
  });

  it("names a panel's headline as a header for VoiceOver", () => {
    expect(parts.MountPanel).toMatch(/<Text style=\{\[styles\.headline, narrow && styles\.headlineNarrow\]\} accessibilityRole="header"/);
  });

  it("caps the typewriter's capitals sooner than the serif, the header's words soonest, and holds nothing to one line", () => {
    for (const [name, src] of Object.entries(parts)) {
      expect(src, name).not.toMatch(/numberOfLines/);
      if (/<Text/.test(src) && name !== "PostHeader") expect(src, name).toMatch(/const BAR_TYPE_CAP = 1\.8;/);
    }
    expect(parts.PostHeader).toMatch(/const HEAD_TYPE_CAP = 1\.3;/);
    expect(tab).toMatch(/const TYPE_CAP = 2\.4;/);
    expect(parts.WaysRow).toMatch(/<Text style=\{styles\.postWord\} maxFontSizeMultiplier=\{BAR_TYPE_CAP\}>/);
    expect(parts.WaysRow).toMatch(/<Text style=\{\[styles\.wayWord, busy && styles\.hidden\]\} maxFontSizeMultiplier=\{BAR_TYPE_CAP\}>/);
    // At the larger sizes the line's left words wrap, and POST keeps its place at the right.
    expect(parts.WaysRow).toMatch(/ways: \{ flexShrink: 1, flexDirection: "row", flexWrap: "wrap"/);
    expect(parts.WaysRow).toMatch(/post: \{ minHeight: 44, justifyContent: "center", flexShrink: 0/);
  });

  it("sets the line in the mock's type: LIBRARY soft and spaced, POST bold and spaced, its arrow drawn", () => {
    const ways = parts.WaysRow;
    expect(ways).toMatch(/fontSize: LINE_TYPE\.library\.size,\s*letterSpacing: LINE_TYPE\.library\.tracking,\s*\.\.\.caps,\s*color: colors\.inkSoft,/);
    expect(ways).toMatch(/fontSize: LINE_TYPE\.post\.size,\s*fontWeight: "700",\s*letterSpacing: LINE_TYPE\.post\.tracking,\s*\.\.\.caps,\s*color: colors\.ink,/);
    expect(ways).toMatch(/function Arrow\(\)/);
    expect(ways).toMatch(/line: \{ minHeight: LINE_HEIGHT, flexDirection: "row", alignItems: "center", justifyContent: "space-between" \}/);
    expect(ways).toMatch(/style=\{\[styles\.line, \{ marginLeft: frame\.left, width: frame\.width \}\]\}/);
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

  it("wears the mock's rust border inside the cell when selected, so nothing shifts", () => {
    expect(parts.RollCell).toMatch(/\{selected \? <View testID="post-cell-box" style=\{styles\.box\} pointerEvents="none" \/> : null\}/);
    expect(parts.RollCell).toMatch(/box: \{ \.\.\.StyleSheet\.absoluteFillObject, borderWidth: SELECTED_BORDER, borderColor: colors\.accent \}/);
  });

  it("draws the camera's tile in the paper, ruled in the strong line, with its small mark", () => {
    const tile = parts.RollCell;
    expect(tile).toMatch(/tile: \{\s*backgroundColor: colors\.paper,\s*borderWidth: CAMERA_LINE,\s*borderColor: colors\.borderStrong,/);
    expect(tile).toMatch(/<Feather name="camera" size=\{CAMERA_MARK\} color=\{colors\.ink\} \/>/);
  });

  it("keeps one full-size image in the frame, so a new selection stops the last one's request", () => {
    const hero = parts.RollHero;
    expect(hero).toMatch(/<Proof key=\{print\.id\} print=\{print\} width=\{rect\.width\} released=\{released\} \/>/);
    const full = hero.slice(hero.indexOf("<Proof key="), hero.indexOf("</Pressable>", hero.indexOf("<Proof key=")));
    expect(full).toMatch(/\{released \|\| heroReleased \? null : \(\s*<Image\s+source=\{printSource\(print\.uri\)\}/);
    expect(full).toMatch(/recyclingKey=\{print\.id\}/);
    expect(full).not.toMatch(/<Image[^]*?key=/);
    const proof = hero.slice(hero.indexOf("function Proof("));
    expect(proof.match(/<Image/g)).toHaveLength(1);
    expect(proof).toMatch(/transition=\{0\}/);
  });

  it("hears the photograph in the frame as the selected one, by its date and how long ago, and opens it", () => {
    const photo = parts.RollHero.slice(parts.RollHero.indexOf('testID="post-hero-photo"'), parts.RollHero.indexOf("<Proof"));
    expect(photo).toMatch(/accessibilityRole="imagebutton"/);
    expect(photo).toMatch(/accessibilityLabel=\{`Selected: \$\{date\}\. \$\{age\}\.`\}/);
    expect(photo).toMatch(/accessibilityHint="Opens it in the editor\."/);
  });
});
