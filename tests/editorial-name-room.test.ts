import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * Editorial (Preview): room for what the names' italic reaches into.
 *
 * Cormorant Garamond Bold Italic leans out of its letters' widths: the f's
 * and the j's tails reach in under the letter before, the f's hook out over
 * the one after. On the iPhone (React Native 0.81, the new architecture) a
 * Text draws nothing outside its own box, its box is as wide as its
 * letters' widths, and its first letter starts at its very edge, so what
 * reaches past a name's first or last letter is cut off there:
 * - RCTParagraphComponentView lays its text view over its own bounds and
 *   draws the words from its content frame, the bounds less its padding;
 * - RCTTextLayoutManager sets each line with no margin of its own
 *   (lineFragmentPadding 0) and measures a Text by its letters' widths.
 * A browser does not cut a span's ink to its box, so a web walk cannot show
 * this; it is held here, from the font file and the source.
 *
 * Where a name is all its Text holds (a row's, a chip's, a header's, a
 * bar's title), the Text's box grows by the room on each side, as padding,
 * and gives it back as a negative margin: the letters stay exactly where
 * they were. Where a name begins a line of words, the line cannot be padded
 * (tests/name-link-hit-area.test.ts), so a narrow space as wide as the first
 * letter reaches is laid before it, beside its link. Under Original none of
 * this is drawn.
 */

vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (choices: { ios?: unknown; default?: unknown }) => choices.ios ?? choices.default },
  DynamicColorIOS: (pair: { light: string; dark: string }) => pair.light,
  StyleSheet: { create: <T,>(sheet: T) => sheet },
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1, scale: 3 }),
}));
vi.mock("@react-navigation/elements", () => ({ HeaderTitle: "HeaderTitle" }));
vi.mock("@/utils/diskCache", () => ({ readDiskCache: () => null, writeDiskCache: () => {} }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));

const { NAME_EDGE, nameEdge, nameFace, nameRoom, nameSize, nameStyle, nameTitleStyle } = await import("@/utils/nameFace");
const { setFeedLayout, __resetFeedLayoutForTest } = await import("@/utils/feedLayout");
const { NameEdge, NamedWords } = await import("@/components/MemberText");
const { NameTitle, nameHeaderTitle } = await import("@/components/NameTitle");
const { USERNAME_RE } = await import("@/utils/validation");

afterEach(() => __resetFeedLayoutForTest());

const root = path.resolve(import.meta.dirname, "..");
const font = readFileSync(path.join(root, "assets/fonts/CormorantGaramond-BoldItalic.ttf"));

/** Where a table starts in the font file, by its tag. */
function table(tag: string): number {
  for (let i = 0; i < font.readUInt16BE(4); i++) {
    const record = 12 + 16 * i;
    if (font.toString("latin1", record, record + 4) === tag) return font.readUInt32BE(record + 8);
  }
  throw new Error(`no ${tag} table`);
}

const UNITS = font.readUInt16BE(table("head") + 18);
const LONG_OFFSETS = font.readInt16BE(table("head") + 50) === 1;
const METRICS = font.readUInt16BE(table("hhea") + 34);

/** The glyph a character is drawn with: the Windows Unicode cmap, format 4. */
function glyphOf(char: string): number {
  const cmap = table("cmap");
  let at = -1;
  for (let i = 0; i < font.readUInt16BE(cmap + 2); i++) {
    const record = cmap + 4 + 8 * i;
    if (font.readUInt16BE(record) === 3 && font.readUInt16BE(record + 2) === 1) at = cmap + font.readUInt32BE(record + 4);
  }
  expect(font.readUInt16BE(at)).toBe(4);
  const code = char.codePointAt(0)!;
  const segments = font.readUInt16BE(at + 6) / 2;
  const ends = at + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const ranges = deltas + 2 * segments;
  for (let i = 0; i < segments; i++) {
    if (code > font.readUInt16BE(ends + 2 * i)) continue;
    const start = font.readUInt16BE(starts + 2 * i);
    if (code < start) return 0;
    const delta = font.readInt16BE(deltas + 2 * i);
    const range = font.readUInt16BE(ranges + 2 * i);
    if (range === 0) return (code + delta) & 0xffff;
    const glyph = font.readUInt16BE(ranges + 2 * i + range + 2 * (code - start));
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  return 0;
}

/** A character's width (its advance) and its ink's left and right ends, in the font's units. */
function measure(char: string): { width: number; left: number; right: number } {
  const glyph = glyphOf(char);
  expect(glyph, char).toBeGreaterThan(0);
  const width = font.readUInt16BE(table("hmtx") + 4 * Math.min(glyph, METRICS - 1));
  const loca = table("loca");
  const offset = (g: number) => (LONG_OFFSETS ? font.readUInt32BE(loca + 4 * g) : font.readUInt16BE(loca + 2 * g) * 2);
  if (offset(glyph) === offset(glyph + 1)) return { width, left: 0, right: 0 };
  const at = table("glyf") + offset(glyph);
  return { width, left: font.readInt16BE(at + 2), right: font.readInt16BE(at + 6) };
}

/** Every character a username can hold. */
const CHARS = [..."abcdefghijklmnopqrstuvwxyz0123456789._"];

/** How far each character's ink reaches past its width, to the left and to the right, in thousandths of the size. */
const REACH = Object.fromEntries(
  CHARS.map((char) => {
    const { width, left, right } = measure(char);
    return [char, { left: (Math.max(0, -left) * 1000) / UNITS, right: (Math.max(0, right - width) * 1000) / UNITS }];
  }),
) as Record<string, { left: number; right: number }>;

/** Every size a name is set at: beside words of each size the app gives the face (checked in tests/editorial-names.test.ts). */
const WORD_SIZES = [11, 12, 12.5, 13, 14, 15, 16, 17];

describe("what the names' italic reaches into", () => {
  it("is measured over every character a username can hold", () => {
    expect(USERNAME_RE.source).toBe("^[a-z0-9_.]{3,24}$");
    expect(UNITS).toBe(1000);
    // The tails and the hook, as the build 56 review read them from the medium cut, a little longer in the bold.
    expect(REACH.f).toEqual({ left: 128, right: 149 });
    expect(REACH.j.left).toBe(114);
  });

  it("is made room for before a name, for exactly what its first letter reaches, and nothing where it reaches less than a hundredth", () => {
    const edge = measure(NAME_EDGE);
    // A no-break narrow space: never parted from the name it stands before.
    expect(NAME_EDGE).toBe(" ");
    let reaching = 0;
    for (const size of WORD_SIZES) {
      for (const char of CHARS) {
        for (const side of ["left", "right"] as const) {
          const style = nameEdge(size, side === "left" ? `${char}xyz` : `xyz${char}`, side);
          const reach = REACH[char][side];
          if (reach < 10) {
            expect(style, `${side} ${char}`).toBeUndefined();
            // What is left uncut: under an eighth of a point at the largest name, the bar's 22 pt title.
            expect((reach * nameSize(17)) / 1000, `${side} ${char}`).toBeLessThan(0.125);
            continue;
          }
          if (size === 12.5) reaching += 1;
          // In the face itself, at the size that makes the narrow space as wide as the letter reaches at the name's size.
          expect(style, `${side} ${char}`).toMatchObject({ fontFamily: "CormorantGaramond-BoldItalic", fontWeight: "700" });
          const drawn = (style!.fontSize * edge.width) / UNITS;
          expect(Math.abs(drawn - (nameSize(size) * reach) / 1000), `${side} ${char} ${size}`).toBeLessThan(1e-9);
          // Never bigger than the name beside it, so the line is no taller for it: the phone sets a line by its largest
          // face (below). On the web alone it takes no line height of its own, where a smaller span would sit lower.
          expect(style!.fontSize, `${side} ${char}`).toBeLessThan(nameSize(size));
          expect(style, `${side} ${char}`).not.toHaveProperty("lineHeight");
        }
      }
    }
    // The f, j, y, p, g, 3, 5, 9, 7, x, z, 4 and _ to the left; the f, 6, d, z, k, r, g and t to the right.
    expect(reaching).toBe(21);
    // The same object for the same letter and size, so nothing redraws for it alone.
    expect(nameEdge(14, "june.nakamura", "left")).toBe(nameEdge(14, "jade", "left"));
  });

  it("needs nothing before an @name, which starts inside its own width", () => {
    expect(measure("@").left).toBeGreaterThanOrEqual(0);
  });

  it("is made room for around a name that stands alone: the farthest any letter reaches, to the whole point, on each side", () => {
    const farthest = Math.max(...CHARS.flatMap((char) => [REACH[char].left, REACH[char].right]));
    expect(farthest).toBe(149);
    for (const size of WORD_SIZES) {
      const room = nameRoom(size);
      expect(Number.isInteger(room), String(size)).toBe(true);
      expect(room, String(size)).toBeGreaterThanOrEqual((nameSize(size) * farthest) / 1000);
      expect(room - (nameSize(size) * farthest) / 1000, String(size)).toBeLessThan(1);
      // Padding inside, the same given back outside: the letters, and all around the Text, stay where they were.
      expect(nameStyle(size, "alone")).toEqual({ ...nameStyle(size), paddingHorizontal: room, marginHorizontal: -room });
      expect(nameFace("editorial")(size, "alone")).toBe(nameStyle(size, "alone"));
      expect(nameFace("original")(size, "alone")).toBeUndefined();
    }
    expect([14, 15.5, 16, 18, 19, 22].map((name) => Math.ceil((name * farthest) / 1000))).toEqual([3, 3, 3, 3, 3, 4]);
  });

  it("is room the iPhone draws in: a Text's padding is inside what it draws, and nothing outside its box is drawn", () => {
    const paragraph = readFileSync(path.join(root, "node_modules/react-native/React/Fabric/Mounting/ComponentViews/Text/RCTParagraphComponentView.mm"), "utf8");
    expect(paragraph).toMatch(/- \(void\)layoutSubviews\s*\{\s*\[super layoutSubviews\];\s*_textView\.frame = self\.bounds;\s*\}/);
    expect(paragraph).toMatch(/CGRect frame = RCTCGRectFromRect\(_layoutMetrics\.getContentFrame\(\)\);\s*\[nativeTextLayoutManager drawAttributedString:stateData\.attributedString/);
    const layout = readFileSync(
      path.join(root, "node_modules/react-native/ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTTextLayoutManager.mm"),
      "utf8",
    );
    expect(layout).toMatch(/textContainer\.lineFragmentPadding = 0\.0;/);
    expect(layout).toMatch(/\[layoutManager drawGlyphsForGlyphRange:glyphRange atPoint:frame\.origin\];/);
    expect(layout).toMatch(/CGSize size = \[layoutManager usedRectForTextContainer:textContainer\]\.size;/);
    // A line given a height of its own is set by the largest face in it, so a smaller one beside a name changes nothing.
    const utils = readFileSync(
      path.join(root, "node_modules/react-native/ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm"),
      "utf8",
    );
    expect(utils).toMatch(/maximumFontLineHeight = MAX\(font\.lineHeight, maximumFontLineHeight\);/);
    expect(code("src/utils/nameFace.ts")).toMatch(/\nconst EDGE_LINE = Platform\.OS === "web" \? \{ lineHeight: 0 \} : undefined;\n/);
  });
});

describe("a name inside a line of words", () => {
  it("is led by NameEdge, under Editorial alone, where its first letter reaches out", () => {
    const edge = (name: string) => NameEdge({ name, size: 14 }) as ReactElement | null;
    expect(edge("june.nakamura")).toBeNull();
    setFeedLayout("editorial");
    const lead = edge("june.nakamura")!;
    expect(lead.type).toBe("Text");
    expect(lead.props).toEqual({ style: nameEdge(14, "june.nakamura", "left"), children: NAME_EDGE });
    // Most letters do not reach out: nothing.
    expect(edge("elena.marchetti")).toBeNull();
    expect(edge("")).toBeNull();
    expect(NameEdge({ name: null, size: 14 })).toBeNull();
    // After a name, for its last letter.
    expect((NameEdge({ name: "otis.whitfield", size: 11, side: "right" }) as ReactElement<{ style: unknown }>).props.style).toBe(nameEdge(11, "otis.whitfield", "right"));
  });

  it("is led wherever it begins a line, beside its link and never in it, at the size it is set at", () => {
    const found: string[] = [];
    for (const file of sources()) {
      if (file === "src/components/PostCard.tsx") continue; // Drawn only under Original.
      const source = code(file);
      const card = file === "src/components/feed/EditorialPostCard.tsx";
      // A name drawn inside a Text: a link to its member, a report's name, or the face laid on a nested Text.
      for (const m of source.matchAll(/<NameLink\b((?:=>|[^>])*?)\/>|\{nameOf\(([^)]*)\)\}|<Text style=\{\[[^\]]*\bface\((\d+)\)\]\}>\{([^{}]*)\}/g)) {
        const outer = openText(source, m.index);
        if (outer == null) continue;
        const before = source
          .slice(outer, m.index)
          .replace(/<NameEdge\b(?:=>|[^>])*\/>/g, "")
          .replace(/^[\s\S]*\)\s*:\s*\(/, "")
          .replace(/\{[^{}]*\?\s*\(|<>/g, "");
        if (before.trim() !== "") continue;
        const name = m[1]?.match(/\busername=\{([^{}]*)\}/)?.[1] ?? m[2] ?? m[4];
        const size = card ? "WORDS" : (m[1]?.match(/\bface\(([\d.]+)\)/)?.[1] ?? m[3] ?? "12");
        const where = `${file}: ${name}`;
        found.push(`${where} ${size}`);
        const lead = source.slice(outer, m.index).match(/<NameEdge\b((?:=>|[^>])*)\/>\s*$/)?.[1];
        expect(lead, where).toBeDefined();
        expect(lead!.trim(), where).toBe(`name={${name}} size={${size}}`);
      }
    }
    expect(found.sort()).toEqual(
      [
        "app/(tabs)/activity.tsx: item.actor.username 13",
        "app/admin/reports.tsx: item.comment.author?.username 12",
        "app/comments.tsx: comment.author.username 14",
        "app/comments.tsx: post.author.username 14",
        "app/messages/[id].tsx: shared.author.username 11",
        "app/post/[id].tsx: c.author.username 14",
        "app/post/[id].tsx: post.author.username 15",
        "src/components/PendingPostCard.tsx: draft.author.username 14",
        "src/components/PendingPostCard.tsx: draft.author.username 14",
        "src/components/feed/EditorialPostCard.tsx: c.author.username WORDS",
        "src/components/feed/EditorialPostCard.tsx: post.author.username WORDS",
      ].sort(),
    );
    // NameEdge is drawn nowhere else, but after the photograph's author in a message, whose line may be sized to the name.
    const edges = sources().flatMap((file) => [...code(file).matchAll(/<NameEdge\b/g)].map(() => file));
    expect(edges.length).toBe(found.length + 1);
    expect(code("app/messages/[id].tsx")).toMatch(
      /<NameEdge name=\{shared\.author\.username\} size=\{11\} \/>\s*<NameLink username=\{shared\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{face\(11\)\} \/>\s*<NameEdge name=\{shared\.author\.username\} size=\{11\} side="right" \/>/,
    );
  });

  it("never in a Text of its own: one that holds a name alone has the room around it instead", () => {
    const alone: string[] = [];
    for (const file of sources()) {
      const source = code(file);
      for (const m of source.matchAll(/<Text\b((?:=>|[^>])*?)>/g)) {
        const face = m[1].match(/\bface\(([\w.]+)/);
        if (face == null) continue;
        const isAlone = /\bface\([\w.]+, "alone"\)/.test(m[1]);
        const where = `${file}: ${m[1].trim()}`;
        // The name a sentence is written around is drawn inside the sentence's Text (NamedWords), never on its own.
        if (file === "src/components/MemberText.tsx") {
          expect(m[1].trim(), where).toBe("style={face(size)}");
          continue;
        }
        // Inside a line: the line's own room (above). On its own: the room around it.
        expect(isAlone, where).toBe(openText(source, m.index) == null);
        if (isAlone) alone.push(`${file}: ${face[1]}`);
      }
      // A link is always inside a line, and never given the room of a name alone.
      for (const m of source.matchAll(/<NameLink\b((?:=>|[^>])*?)\/?>/g)) expect(m[1], file).not.toMatch(/"alone"/);
    }
    expect(alone.sort()).toEqual(
      [
        "app/admin/applications.tsx: 15",
        "app/blocked.tsx: 15",
        "app/compose.tsx: 13",
        "app/messages/index.tsx: 15",
        "app/post/[id].tsx: 14",
        "app/requests.tsx: 15",
        "app/share.tsx: 14",
        "app/share.tsx: 15",
        "src/components/MentionSuggestions.tsx: 14",
        "src/components/PendingPostCard.tsx: 14",
        "src/components/ProfileHeader.tsx: 15",
        "src/components/TagPicker.tsx: 12",
        "src/components/TagPicker.tsx: 14",
        "src/components/UserRow.tsx: 14",
      ].sort(),
    );
    // The editorial card's name over the print, set in its sheet, and the bars' titles (below).
    expect(code("src/components/feed/EditorialPostCard.tsx")).toMatch(/\n {2}username: \{ flexShrink: 1, \.\.\.nameStyle\(WORDS, "alone"\), color: colors\.nameInk \},/);
  });

  it("alone, keeps a margin or a widest width of its place's own, less or more the room, so it stays where and as wide as it was", () => {
    // The tagged members' line in New post: 4 pt from the faces before it, a margin of its own on that side, which outranks
    // the room's margin on both sides; so it is set less the room, and the names start 4 pt from the faces still.
    const compose = code("app/compose.tsx");
    expect(compose).toMatch(/<Text style=\{\[styles\.tagNames, face\(13\) && styles\.tagNamesAlone, face\(13, "alone"\)\]\} numberOfLines=\{1\}>/);
    expect(compose).toMatch(/\n {2}tagNames: \{ flex: 1, fontSize: 13, color: colors\.ink, marginLeft: 4 \},\s*tagNamesAlone: \{ marginLeft: 4 - nameRoom\(13\) \},/);
    // A member offered for an @name: at most 160 pt wide, now that wide inside the room.
    const offered = code("src/components/MentionSuggestions.tsx");
    expect(offered).toMatch(/<Text style=\{\[styles\.username, face\(14\) && styles\.usernameAlone, face\(14, "alone"\)\]\} numberOfLines=\{1\}>/);
    expect(offered).toMatch(/\n {2}username: \{ fontSize: 14, fontWeight: "600", color: colors\.ink, maxWidth: 160 \},\s*usernameAlone: \{ maxWidth: 160 \+ 2 \* nameRoom\(14\) \},/);
    // Yoga, as the iPhone lays a view out, takes a side's own margin over a margin set for both sides; so does the web.
    const yoga = readFileSync(path.join(root, "node_modules/react-native/ReactCommon/yoga/yoga/style/Style.h"), "utf8");
    expect(yoga).toMatch(
      /\} else if \(edges\[yoga::to_underlying\(Edge::Left\)\]\.isDefined\(\)\) \{\s*return pool_\.getLength\(edges\[yoga::to_underlying\(Edge::Left\)\]\);\s*\} else if \(edges\[yoga::to_underlying\(Edge::Horizontal\)\]\.isDefined\(\)\) \{/,
    );
    const web = readFileSync(path.join(root, "node_modules/react-native-web/dist/exports/StyleSheet/compiler/createReactDOMStyle.js"), "utf8");
    expect(web).toMatch(/longFormProperties\.forEach\(\(longForm, i\) => \{[\s\S]{0,200}?if \(style\[longForm\] == null\) \{\s*resolvedStyle\[longForm\] = _value;/);
  });

  it("in words the app writes around it, is given room at the start or the end of the words, and nowhere in between", () => {
    setFeedLayout("editorial");
    const parts = (write: (name: string) => string, name: string) =>
      (NamedWords({ words: write, name, size: 13 }) as ReactElement<{ children: unknown[] }>).props.children;
    const [lead, , end] = parts((name) => `${name} has your request.`, "june.nakamura") as [ReactElement, ReactElement, string];
    expect(lead.props).toEqual({ style: nameEdge(13, "june.nakamura", "left"), children: NAME_EDGE });
    expect(end).toBe(" has your request.");
    const [start, , trail] = parts((name) => `You blocked ${name}`, "otis.whitfield") as [string, ReactElement, ReactElement];
    expect(start).toBe("You blocked ");
    expect(trail.props).toEqual({ style: nameEdge(13, "otis.whitfield", "right"), children: NAME_EDGE });
    // A first or last letter that does not reach out: nothing beside it.
    expect(parts((name) => `${name} has your request.`, "tomas.lindqvist")[0]).toBeNull();
    expect(parts((name) => `Nobody follows ${name} yet.`, "june.nakamura").slice(0, 1)).toEqual(["Nobody follows "]);
  });
});

describe("a bar titled with a username", () => {
  it("under Editorial stands alone in the title's room, drawn by the app, at the width the title always had", () => {
    const title = nameTitleStyle("editorial");
    expect(title).toMatchObject({ paddingHorizontal: nameRoom(17), marginHorizontal: -nameRoom(17) });
    expect(nameRoom(17)).toBe(4);
    const Title = nameHeaderTitle(title)!;
    expect(Title).toBeTypeOf("function");
    const drawn = Title({ children: "june.nakamura", tintColor: "#000" }) as ReactElement<{ style: unknown; children: string }>;
    expect(drawn.type).toBe(NameTitle);
    expect(drawn.props).toMatchObject({ style: title, children: "june.nakamura", tintColor: "#000" });
    // The thread's title was at most the screen less 150 pt, and never under 120: the name is, the room beyond it.
    // On the iPhone the room stays inside what the bar holds, the negative margin left off: the bar's header subview
    // is as wide as the title's margins make it (react-native-screens lays its subviews in a row, each its content's
    // width), and the picture it fades when the screen is popped shows only what lies inside that.
    const text = NameTitle({ children: "june.nakamura", style: title }) as ReactElement<{ style: unknown[] }>;
    expect(text.type).toBe("HeaderTitle");
    expect(text.props.style).toEqual([title, { maxWidth: 240 + 8, marginHorizontal: 0 }]);
    const screens = (file: string) => readFileSync(path.join(root, "node_modules/react-native-screens", file), "utf8");
    expect(screens("src/components/ScreenStackHeaderConfig.tsx")).toMatch(
      /headerSubviewCenter: \{\s*flexDirection: 'row',\s*alignItems: 'center',\s*justifyContent: 'center',\s*flexShrink: 1,\s*\},\s*headerConfig: \{\s*position: 'absolute',\s*width: '100%',\s*flexDirection: 'row',/,
    );
    expect(screens("ios/RNSScreenStackHeaderSubview.mm")).toMatch(/self\.bounds = CGRect\{CGPointZero, frame\.size\};/);
    expect(screens("ios/RNSScreenStackHeaderConfig.mm")).toMatch(
      /UIView \*snapshot = \[childComponentView snapshotViewAfterScreenUpdates:NO\];[\s\S]{0,400}?case RNSScreenStackHeaderSubviewTypeCenter:[\s\S]{0,80}?navitem\.titleView = snapshot;/,
    );
    // The bar centres that view on the iPhone, so the letters stay where they were. Elsewhere (the web, where the bar
    // sets its title at its start) the negative margin stays and keeps them there.
    expect(code("src/components/NameTitle.tsx")).toMatch(/room > 0 && Platform\.OS === "ios" \? \{ \.\.\.box, marginHorizontal: 0 \} : box/);
    // Under Original, and over an era's gallery: the bar's own title, exactly as it was.
    expect(nameHeaderTitle(nameTitleStyle("original"))).toBeUndefined();
    expect((NameTitle({ children: "june.nakamura", style: nameTitleStyle("original") }) as ReactElement<{ style: unknown[] }>).props.style).toEqual([
      nameTitleStyle("original"),
      { maxWidth: 240 },
    ]);
  });

  it("is handed to the bar by each screen titled with one, under either layout", () => {
    expect(code("app/gallery.tsx")).toMatch(/headerTitle: nameHeaderTitle\(titleStyle\), headerTitleStyle: titleStyle \}\} \/>/);
    expect(code("app/user/[username].tsx").match(/headerTitle: nameHeaderTitle\(titleStyle\), headerTitleStyle: titleStyle \}\} \/>/g)).toHaveLength(2);
    // The thread's title is a link, drawn by NameTitle under both layouts.
    expect(code("app/messages/[id].tsx")).toMatch(/<NameTitle tintColor=\{tintColor\} style=\{titleStyle\}>\s*\{children\}\s*<\/NameTitle>/);
    // The Profile tab's title, which the app draws itself, takes the room with the title style.
    // (The Post tab's title is kept there unseen, under its two words: `pages && styles.unseen`, product-polish's.)
    expect(code("app/(tabs)/_layout.tsx")).toMatch(/<Text\s+style=\{\[styles\.headerTitle, titleStyle, nameTitle, pages && styles\.unseen\]\}[^>]*>\s*\{title\}\s*<\/Text>/);
  });
});

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return name.endsWith(".tsx") ? [full] : [];
  });
}

/** Every component file of the app's own, as a path from the repository's root. */
function sources(): string[] {
  return [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))].map((file) => path.relative(root, file).split(path.sep).join("/"));
}

/** Where the words of the innermost Text open before a place in a source start, or null outside any. */
function openText(source: string, at: number): number | null {
  const open: number[] = [];
  for (const m of source.slice(0, at).matchAll(/<Text\b((?:=>|[^>])*?)(\/?)>|<\/Text>/g)) {
    if (m[0] === "</Text>") open.pop();
    else if (m[2] !== "/") open.push(m.index + m[0].length);
  }
  return open.length ? open[open.length - 1] : null;
}
