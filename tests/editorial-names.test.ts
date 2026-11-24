import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * Editorial (Preview): members' usernames in Cormorant Garamond.
 *
 * While the feed is Editorial every username the app draws, on every page,
 * is set in Cormorant Garamond Medium Italic, in the place's own colour, at
 * the size that matches the words it sits beside or stands in for: their
 * size times 16 / 12.5, to the half point (the editorial card's 16 pt names
 * over its 12.5 pt words). A state that marked a name heavier (an unread
 * thread's) takes the face's SemiBold Italic. A bar titled with a username
 * is in the face at the size that matches the bar's 17 pt title. Under
 * Original nothing changes at all.
 *
 * First the module that says so, then the bars, then, read from the source,
 * every place that draws a username, each at its size, so that none is
 * dropped and none is added without it, then every state, the sentences a
 * username is written into, and last which files read the module, so the
 * trial still comes out cleanly.
 */

vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (choices: { ios?: unknown; default?: unknown }) => choices.ios ?? choices.default },
  DynamicColorIOS: (pair: { light: string; dark: string }) => pair.light,
  // Enough to call EmptyState as a function, below: its sheet is itself, its parts are named.
  StyleSheet: { create: <T,>(sheet: T) => sheet },
  Text: "Text",
  View: "View",
}));
// The preference is kept on the phone; here it is kept in memory.
vi.mock("@/utils/diskCache", () => ({ readDiskCache: () => null, writeDiskCache: () => {} }));
// Outside a component a hook has nothing to subscribe it: read the store as a first draw does.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));

const nameFaceModule = await import("@/utils/nameFace");
const { NAME_SCALE, nameFace, nameSize, nameStyle, nameTitleStyle, useNameFace, useNameTitleStyle } = nameFaceModule;
const { setFeedLayout, __resetFeedLayoutForTest } = await import("@/utils/feedLayout");
const { colors, type } = await import("@/theme");
const { EmptyState } = await import("@/components/EmptyState");
const { NamedWords } = await import("@/components/MemberText");
const { erasEmpty } = await import("@/components/eraBook");
const { USERNAME_RE } = await import("@/utils/validation");

const MEDIUM = "CormorantGaramond-MediumItalic";
const SEMIBOLD = "CormorantGaramond-SemiBoldItalic";

const root = path.resolve(import.meta.dirname, "..");

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
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

/** Every file of the app's own, as a path from the repository's root. */
const sources = () =>
  [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))].map((file) =>
    path.relative(root, file).split(path.sep).join("/"),
  );

afterEach(() => __resetFeedLayoutForTest());

describe("the names' face", () => {
  it("is Cormorant Garamond Medium Italic under Editorial, at 16 / 12.5 of the size it is given, and nothing under Original", () => {
    expect(NAME_SCALE).toBe(16 / 12.5);
    expect(nameFace("editorial")(12.5)).toEqual({ fontFamily: MEDIUM, fontSize: 16, fontWeight: "500" });
    // Nothing, not an empty style: a style array is exactly what it was.
    for (const size of [11, 12.5, 14, 15, 17]) expect(nameFace("original")(size)).toBeUndefined();
    expect(nameFace("original")(15, "semibold")).toBeUndefined();
    // The same function each time, and the same object for the same size and cut, so nothing redraws for it alone.
    expect(nameFace("editorial")).toBe(nameFace("editorial"));
    expect(nameFace("original")).toBe(nameFace("original"));
    expect(nameFace("editorial")(14)).toBe(nameFace("editorial")(14));
    expect(nameFace("editorial")(14)).toBe(nameStyle(14));
  });

  it("is set at the size of the words beside it times 16 / 12.5, to the half point", () => {
    const sizes = Object.fromEntries([11, 12, 12.5, 13, 14, 15, 16, 17].map((size) => [size, nameSize(size)]));
    expect(sizes).toEqual({ 11: 14, 12: 15.5, 12.5: 16, 13: 16.5, 14: 18, 15: 19, 16: 20.5, 17: 22 });
    for (const size of [9, 10, 11, 12, 12.5, 13, 14, 15, 16, 17, 18, 22]) {
      expect(nameSize(size) * 2, String(size)).toBe(Math.round(nameSize(size) * 2));
      expect(Math.abs(nameSize(size) - size * NAME_SCALE), String(size)).toBeLessThanOrEqual(0.25);
    }
  });

  it("has a heavier cut for a name a state marks heavier: SemiBold Italic, at the same size", () => {
    expect(nameFace("editorial")(15, "semibold")).toEqual({ fontFamily: SEMIBOLD, fontSize: 19, fontWeight: "600" });
    expect(nameFace("editorial")(15, "medium")).toEqual(nameFace("editorial")(15));
  });

  it("is the family, the size and the weight that lands on the cut alone: a name keeps the place's own colour and spacing", () => {
    for (const cut of ["medium", "semibold"] as const) {
      expect(Object.keys(nameFace("editorial")(14, cut)!)).toEqual(["fontFamily", "fontSize", "fontWeight"]);
    }
    const source = code("src/utils/nameFace.ts");
    // No colour, tracking or style anywhere: each cut is italic in itself. A line height for a bar's title alone (below).
    expect(source).not.toMatch(/letterSpacing|fontStyle|color|colors\.|type\.mono|Courier/);
    expect(source.match(/lineHeight: [^,;} ]+/g)).toEqual(["lineHeight: TITLE_LINE"]);
    // The weight is the cut's own on the phone, which draws the family's cut nearest the weight asked for, and regular
    // on the web, where each cut is a family of its own registered at the regular weight (a heavier one would be faked).
    expect(source).toMatch(/medium: \{ family: "CormorantGaramond-MediumItalic", weight: "500" \},\s*semibold: \{ family: "CormorantGaramond-SemiBoldItalic", weight: "600" \},/);
    expect(source).toMatch(/return Platform\.OS === "web" \? "400" : CUTS\[cut\]\.weight;/);
  });

  it("follows the layout chosen in Settings, the moment it changes", () => {
    expect(useNameFace()(14)).toBeUndefined();
    setFeedLayout("editorial");
    expect(useNameFace()(14)).toEqual({ fontFamily: MEDIUM, fontSize: 18, fontWeight: "500" });
    setFeedLayout("original");
    expect(useNameFace()(14)).toBeUndefined();
  });

  it("is read from the one layout preference, and nowhere else; the theme only for the stack's serif", () => {
    const source = readFileSync(path.join(root, "src/utils/nameFace.ts"), "utf8");
    expect(source.match(/from "[^"]+"/g)).toEqual(['from "react-native"', 'from "@/theme"', 'from "@/utils/feedLayout"']);
    expect(source).toMatch(/^import \{ Platform \} from "react-native";$/m);
    expect(source).toMatch(/^import \{ type \} from "@\/theme";$/m);
    expect(code("src/utils/nameFace.ts")).toMatch(/return nameFace\(useFeedLayout\(\)\);/);
    expect(code("src/utils/nameFace.ts")).toMatch(/const layout = useFeedLayout\(\);\s*return nameTitleStyle\(isName \? layout : "original"\);/);
  });

  it("is all the module gives: the face, its size, a username's title style; no ink, nothing to cut a sentence with", () => {
    expect(Object.keys(nameFaceModule).sort()).toEqual(["NAME_SCALE", "nameFace", "nameSize", "nameStyle", "nameTitleStyle", "useNameFace", "useNameTitleStyle"]);
  });
});

/** The stack's own title style, as app/_layout.tsx sets it for every screen, as its values. */
function stackTitleStyle(): Record<string, unknown> {
  const body = code("app/_layout.tsx").match(/\n {12}headerTitleStyle: \{ ([^\n{}]*?) \},\n/)?.[1];
  if (body == null) throw new Error("app/_layout.tsx: no one-line headerTitleStyle");
  return Object.fromEntries(
    body.split(/,\s*/).map((pair) => {
      const [key, words] = pair.split(/:\s*/);
      return [key, valueOf(words)];
    }),
  );
}

/** The screens whose bar is titled with a username, and how each takes the title style. */
const TITLE_READERS: Record<string, RegExp> = {
  // An era's gallery is titled with the era, which keeps the stack's own.
  "app/gallery.tsx": /const titleStyle = useNameTitleStyle\(!shown\.era\);/,
  "app/messages/[id].tsx": /const titleStyle = useNameTitleStyle\(\);/,
  "app/user/[username].tsx": /const titleStyle = useNameTitleStyle\(\);/,
};

describe("a bar titled with a username", () => {
  it("is laid by the stack over its own title face, bold on the phone, whose weight the names' face replaces", () => {
    // The app's title style: a family and a size, no weight of its own.
    expect(stackTitleStyle()).toEqual({ fontFamily: type.serif, fontSize: 17 });
    expect(code("app/_layout.tsx")).toMatch(/headerTintColor: colors\.ink as unknown as string,/);
    expect(code("app/_layout.tsx")).not.toMatch(/nameFace|fontWeight/);
    // Laid over the system's bold on iOS (its medium elsewhere): a weight in the title style is the one drawn.
    const stack = readFileSync(path.join(root, "node_modules/@react-navigation/native-stack/src/views/useHeaderConfigProps.tsx"), "utf8");
    expect(stack).toMatch(/const headerTitleStyleFlattened =\s*StyleSheet\.flatten\(\[\s*Platform\.select\(\{ ios: fonts\.bold, default: fonts\.medium \}\),\s*headerTitleStyle,\s*\]\)/);
    const fonts = readFileSync(path.join(root, "node_modules/@react-navigation/native/src/theming/fonts.tsx"), "utf8");
    expect(fonts.slice(fonts.indexOf("  ios: {"))).toMatch(/^ {2}ios: \{[\s\S]*?\n {4}bold: \{\s*fontFamily: 'System',\s*fontWeight: '600',\s*\}/);
  });

  it("under Original is the stack's own title style, exactly", () => {
    expect(nameTitleStyle("original")).toEqual(stackTitleStyle());
    expect(Object.keys(nameTitleStyle("original"))).toEqual(Object.keys(stackTitleStyle()));
  });

  it("under Editorial is the names' face at the size that matches the bar's 17 pt title, its weight over the stack's bold", () => {
    expect(nameTitleStyle("editorial")).toEqual({ fontFamily: MEDIUM, fontSize: 22, fontWeight: "500", lineHeight: 28 });
    expect(nameTitleStyle("editorial")).toEqual({ ...nameStyle(stackTitleStyle().fontSize as number), lineHeight: 28 });
    // On a line a little taller than the face's own at 22 pt, so a descender is never cut where a title is held to one line.
    expect(28).toBeGreaterThan(1.211 * 22);
    expect(code("src/utils/nameFace.ts")).toMatch(/\nconst TITLE_LINE = 28;\n/);
    // The same object each time, so nothing redraws for it alone.
    expect(nameTitleStyle("editorial")).toBe(nameTitleStyle("editorial"));
    expect(nameTitleStyle("original")).toBe(nameTitleStyle("original"));
  });

  it("follows the layout, and keeps the stack's own where the title is not a name", () => {
    expect(useNameTitleStyle()).toEqual(stackTitleStyle());
    setFeedLayout("editorial");
    expect(useNameTitleStyle()).toEqual({ fontFamily: MEDIUM, fontSize: 22, fontWeight: "500", lineHeight: 28 });
    expect(useNameTitleStyle(false)).toEqual(stackTitleStyle());
    setFeedLayout("original");
    expect(useNameTitleStyle()).toEqual(stackTitleStyle());
  });

  it("is handed a style under either layout, never left out, since a screen's options are merged into the ones it set before", () => {
    // What a screen sets is laid over what it set last: a title left without a style would keep Editorial's after Settings turns it off.
    const cache = readFileSync(path.join(root, "node_modules/@react-navigation/core/src/useNavigationCache.tsx"), "utf8");
    expect(cache).toMatch(/\[route\.key\]: \{ \.\.\.o\[route\.key\], \.\.\.options \}/);
    for (const layout of ["original", "editorial"] as const) expect(nameTitleStyle(layout), layout).toBeDefined();
  });

  it("is given the title style wherever a bar is titled with a username, and nowhere else", () => {
    const titled: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      // One line, or (the thread, whose title is a link once the member is known) several.
      for (const [, options] of code(file).matchAll(/<Stack\.Screen\s+options=\{\{([\s\S]*?)\}\}\s*\/>/g)) {
        if (!/\btitle: [^,]*username/.test(options)) continue;
        titled.push(file);
        // The style itself, never undefined, at the end of the options.
        expect(options, file).toMatch(/,\s+headerTitleStyle: titleStyle,?\s*$/);
      }
    }
    // The scan finds what it is meant to: a member's profile (while it loads and once it has), their gallery, a message thread.
    expect(titled.sort()).toEqual(["app/gallery.tsx", "app/messages/[id].tsx", "app/user/[username].tsx", "app/user/[username].tsx"]);
    for (const [file, hook] of Object.entries(TITLE_READERS)) {
      expect(code(file).match(/const titleStyle = useNameTitleStyle\([^)]*\);/g), file).toHaveLength(1);
      expect(code(file), file).toMatch(hook);
      // The hook and the bar's style; the profile has two bars, and the thread's title link draws it too.
      expect(code(file).match(/\btitleStyle\b/g)?.length, file).toBe(file === "app/gallery.tsx" ? 2 : 3);
    }
    expect(code("app/messages/[id].tsx")).toMatch(/<HeaderTitle tintColor=\{tintColor\} style=\{\[titleStyle, \{ maxWidth: Math\.max\(120, width - 150\) \}\]\}>/);
    // No other screen sets a title style of its own.
    expect(sources().filter((f) => f !== "app/_layout.tsx" && /headerTitleStyle/.test(code(f))).sort()).toEqual(Object.keys(TITLE_READERS).sort());
  });

  it("on the Profile tab, which the app draws itself, is the same: the face under Editorial, the bar the height it was", () => {
    const tabs = code("app/(tabs)/_layout.tsx");
    // The member's username, once known; "Profile" before it is, and every other tab's title, keep the serif.
    expect(tabs).toMatch(/const title = tab === "profile" \? username \?\? "Profile" : TITLES\[tab\] \?\? null;/);
    expect(tabs).toMatch(/const titleStyle = useNameTitleStyle\(tab === "profile" && username != null\);/);
    expect(tabs).toMatch(/<Text style=\{\[styles\.headerTitle, titleStyle, nameTitle\]\}>\{title\}<\/Text>/);
    // Under Original the title style is the tab title's own family and size, so nothing changes.
    const own = rule("app/(tabs)/_layout.tsx", "headerTitle");
    expect(own).toEqual({ fontFamily: type.serif, fontSize: 17, color: colors.ink });
    expect({ ...own, ...nameTitleStyle("original") }).toEqual(own);
    // Under Editorial, the face; its line is taller than the serif's, so the difference is given back to the bar's
    // padding above and below, and the bar is as tall on the Profile tab as on the others, at the reader's text size.
    expect(tabs).toMatch(/const \{ fontScale \} = useWindowDimensions\(\);/);
    expect(tabs).toMatch(
      /const nameTitle = titleStyle\.fontSize !== styles\.headerTitle\.fontSize \? \{ marginVertical: styles\.nameTitle\.marginVertical \* fontScale \} : undefined;/,
    );
    expect(rule("app/(tabs)/_layout.tsx", "nameTitle")).toEqual({ marginVertical: -4.34 });
    expect(nameTitleStyle("original").fontSize).toBe(own.fontSize);
    expect(nameTitleStyle("editorial").fontSize).not.toBe(own.fontSize);
    // The face's title line, less the serif's (Georgia's 1.136 of 17 pt on the iPhone), halved: to the hundredth.
    const georgia = (2327 / 2048) * 17;
    const line = nameTitleStyle("editorial").lineHeight!;
    expect(Math.abs((line - georgia) / 2 - 4.34)).toBeLessThan(0.005);
    // The phone scales a set line height by the text size, as it scales the serif's own line (React Native's
    // RCTAttributedTextUtils), and fontScale is that same multiplier: so the bar's height is the others' at every
    // size of text, from the smallest to the largest of Larger Text, to a fiftieth of a point.
    const native = readFileSync(
      path.join(root, "node_modules/react-native/ReactCommon/react/renderer/textlayoutmanager/platform/ios/react/renderer/textlayoutmanager/RCTAttributedTextUtils.mm"),
      "utf8",
    );
    expect(native).toMatch(/CGFloat lineHeight = textAttributes\.lineHeight \* RCTEffectiveFontSizeMultiplierFromTextAttributes\(textAttributes\);/);
    const info = readFileSync(path.join(root, "node_modules/react-native/React/CoreModules/RCTDeviceInfo.mm"), "utf8");
    expect(info).toMatch(/CGFloat fontScale = accessibilityManager \? accessibilityManager\.multiplier : 1\.0;/);
    const give = rule("app/(tabs)/_layout.tsx", "nameTitle").marginVertical as number;
    for (const fontScale of [0.823, 1, 1.353, 1.786, 2.143, 2.643, 3.143, 3.571]) {
      const profile = line * fontScale + 2 * give * fontScale;
      expect(Math.abs(profile - georgia * fontScale), String(fontScale)).toBeLessThan(0.02);
    }
  });
});

/**
 * Every place a username is drawn under Editorial, and how it takes the face:
 * `face(size)`, the size being that of the words the name sits beside (or of
 * the words it stands in for), which is checked below. A name is drawn by a
 * Text, or by a link to the member's page (NameLink, in
 * src/components/MemberText.tsx), which draws the username it opens inside the
 * Text around it, in the style it is handed: there the face is in that style.
 */
const SITES: [file: string, what: string, pattern: RegExp][] = [
  ["app/(tabs)/activity.tsx", "who did it, a link to their page", /<NameLink username=\{item\.actor\.username\} onOpenProfile=\{openMember\} style=\{\[styles\.actor, face\(13\)\]\} \/>\{" "\}/],
  ["app/admin/applications.tsx", "the username asked for", /<Text style=\{\[styles\.username, face\(15\)\]\}>\{item\.desired_username\}<\/Text>/],
  ["app/admin/reports.tsx", "every name on a report, a link to their page", /username \? <NameLink username=\{username\} onOpenProfile=\{openName\} style=\{\[styles\.name, face\(12\)\]\} \/> : "unknown";/],
  ["app/blocked.tsx", "each member blocked", /<Text style=\{\[styles\.username, face\(15\)\]\}>\{item\.username\}<\/Text>/],
  [
    "app/comments.tsx",
    "the caption's author, a link to their page",
    /<NameLink username=\{post\.author\.username\} onOpenProfile=\{openAuthor\} style=\{\[styles\.author, face\(14\)\]\} \/>\{" "\}\s*<MentionText text=\{post\.caption\} onOpenProfile=\{openAuthor\} size=\{14\} \/>/,
  ],
  [
    "app/comments.tsx",
    "each comment's author, a link to their page",
    /<NameLink username=\{comment\.author\.username\} onOpenProfile=\{onOpenAuthor\} onLongPress=\{hold\} style=\{\[styles\.author, face\(14\)\]\} \/>\{" "\}\s*<MentionText text=\{comment\.body\} onOpenProfile=\{onOpenAuthor\} onLongPress=\{hold\} size=\{14\} \/>/,
  ],
  ["app/compose.tsx", "who was there", /<Text style=\{\[styles\.tagNames, face\(13\)\]\} numberOfLines=\{1\}>\s*\{tags\.map\(\(t\) => t\.username\)\.join\(", "\)\}/],
  [
    "app/messages/index.tsx",
    "who each thread is with, after an unread thread's style, which chooses the semibold cut",
    /<Text style=\{\[styles\.username, unread && styles\.unreadText, face\(15, unread \? "semibold" : "medium"\)\]\}>\s*\{conversation\.peer\.username\}/,
  ],
  [
    "app/messages/[id].tsx",
    "whose photograph was sent, a link to their page: the face on the name, your own bubble's ink from the line around it",
    /<Text style=\{\[styles\.sharedCaption, mine && styles\.textMine\]\} numberOfLines=\{1\}>\s*<NameLink username=\{shared\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{face\(11\)\} \/>\s*<\/Text>/,
  ],
  ["app/post/[id].tsx", "the author", /<Text style=\{\[styles\.username, face\(14\)\]\} numberOfLines=\{1\}>\s*\{post\.author\.username\}/],
  [
    "app/post/[id].tsx",
    "who was there, each a link to their page, after a pending tag's style",
    /style=\{\[styles\.withName, t\.status === "pending" && styles\.withPending, face\(12\)\]\}\s*onPress=\{\(\) => openMember\(t\.member\.username\)\}\s*accessibilityRole="link"\s*>\s*\{t\.member\.username\}\s*\{t\.status === "pending" \? " \(pending\)" : ""\}/,
  ],
  [
    "app/post/[id].tsx",
    "the caption's author, a link to their page, in the caption's serif",
    /<Text style=\{styles\.caption\}>\s*<NameLink username=\{post\.author\.username\} onOpenProfile=\{openMember\} style=\{\[styles\.captionAuthor, face\(15\)\]\} \/>\{" "\}\s*<MentionText text=\{post\.caption\} onOpenProfile=\{openMember\} size=\{15\} \/>\s*<\/Text>/,
  ],
  [
    "app/post/[id].tsx",
    "each comment's author, a link to their page",
    /<NameLink\s+username=\{c\.author\.username\}\s+onOpenProfile=\{openMember\}\s+onLongPress=\{\(\) => onCommentLongPress\(c\)\}\s+style=\{\[styles\.captionAuthor, face\(14\)\]\}\s*\/>\{" "\}\s*<MentionText text=\{c\.body\} onOpenProfile=\{openMember\} onLongPress=\{\(\) => onCommentLongPress\(c\)\} size=\{14\} \/>/,
  ],
  ["app/requests.tsx", "each member asking", /<Text style=\{\[styles\.username, face\(15\)\]\}>\{item\.username\}<\/Text>/],
  ["app/share.tsx", "the photograph's author", /<Text style=\{\[styles\.previewAuthor, face\(14\)\]\}>\{post\?\.author\?\.username \?\? ""\}<\/Text>/],
  ["app/share.tsx", "each member to send it to", /<Text style=\{\[styles\.username, face\(15\)\]\}>\{item\.username\}<\/Text>/],
  ["src/components/UserRow.tsx", "every list of members: Search, Recent, Followers, Likes and the admin's Members", /<Text style=\{\[styles\.username, face\(14\)\]\}>\{username\}<\/Text>/],
  ["src/components/MentionSuggestions.tsx", "each member an @name being written could be: Comments, New post and Edit caption", /<Text style=\{\[styles\.username, face\(14\)\]\} numberOfLines=\{1\}>\s*\{m\.username\}/],
  [
    "src/components/MemberText.tsx",
    "every @name in what a member wrote, a link to their page, in the accent, at the size of the words around it",
    /<NameLink\s+key=\{i\}\s+username=\{part\.username\}\s+onOpenProfile=\{onOpenProfile\}\s+onLongPress=\{onLongPress\}\s+style=\{\[styles\.mention, size == null \? undefined : face\(size\)\]\}\s*>\s*\{part\.text\}\s*<\/NameLink>/,
  ],
  [
    "src/components/MemberText.tsx",
    "a username the app writes words around (an empty page's sentence, a private or blocked profile's line, who sent an applicant or an invitation), at the words' size",
    /\{around\[0\]\}\s*<Text style=\{face\(size\)\}>\{name\}<\/Text>\s*\{around\[1\]\}/,
  ],
  ["src/components/PendingPostCard.tsx", "the author", /<Text style=\{\[styles\.username, face\(14\)\]\} numberOfLines=\{1\}>\s*\{draft\.author\.username\}/],
  [
    "src/components/PendingPostCard.tsx",
    "the caption's author, a link to their page",
    /<NameLink username=\{draft\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{\[styles\.captionAuthor, face\(14\)\]\} \/>\{" "\}\s*<MentionText text=\{draft\.caption\.trim\(\)\} onOpenProfile=\{onOpenProfile\} size=\{14\} \/>/,
  ],
  ["src/components/PendingPostCard.tsx", "the caption's author, where the card is given no profile to open", /<Text style=\{\[styles\.captionAuthor, face\(14\)\]\}>\{draft\.author\.username\}<\/Text> \{draft\.caption\.trim\(\)\}/],
  ["src/components/ProfileHeader.tsx", "the name, only where it falls back to the username", /<Text style=\{\[styles\.name, profile\.full_name == null \? face\(15\) : undefined\]\}>\{profile\.full_name \?\? profile\.username\}<\/Text>/],
  ["src/components/TagPicker.tsx", "each member chosen", /<Text style=\{\[styles\.chipText, face\(12\)\]\}>\{p\.username\}<\/Text>/],
  ["src/components/TagPicker.tsx", "each member to choose", /<Text style=\{\[styles\.username, face\(14\)\]\}>\{item\.username\}<\/Text>/],
];

/** The files that read the names' face: each reads its hook, once. */
const READERS = [
  "app/(tabs)/activity.tsx",
  "app/admin/applications.tsx",
  "app/admin/reports.tsx",
  "app/blocked.tsx",
  "app/comments.tsx",
  "app/compose.tsx",
  "app/messages/[id].tsx",
  "app/messages/index.tsx",
  "app/post/[id].tsx",
  "app/requests.tsx",
  "app/share.tsx",
  "src/components/MemberText.tsx",
  "src/components/MentionSuggestions.tsx",
  "src/components/PendingPostCard.tsx",
  "src/components/ProfileHeader.tsx",
  "src/components/TagPicker.tsx",
  "src/components/UserRow.tsx",
];

/** The editorial card, drawn only under Editorial: it sets its names with the face itself (nameStyle), in its sheet. */
const CARD = "src/components/feed/EditorialPostCard.tsx";

/** A rule of a file's sheet (`  name: { … },`, on one line or several), as written between its braces. */
function block(file: string, name: string): string {
  const source = code(file);
  const at = source.indexOf(`\n  ${name}: {`);
  if (at < 0) return "";
  let depth = 0;
  for (let i = source.indexOf("{", at); i < source.length; i++) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}" && --depth === 0) return source.slice(source.indexOf("{", at) + 1, i);
  }
  return "";
}

/** A number as a file writes it: a literal, or a constant it names (`const WORDS = 12.5;`). */
function numberIn(file: string, words: string): number {
  if (/^\d+(\.\d+)?$/.test(words)) return Number(words);
  const named = code(file).match(new RegExp(`\\nconst ${words} = (\\d+(?:\\.\\d+)?);`))?.[1];
  if (named == null) throw new Error(`${file}: no number ${words}`);
  return Number(named);
}

/** The size a rule of a file's sheet sets, its own or the theme's it spreads; undefined if it sets none. */
function sizeOf(file: string, name: string): number | undefined {
  const rules = block(file, name);
  const own = rules.match(/\bfontSize: ([\w.]+)/)?.[1];
  if (own != null) return numberIn(file, own);
  const spread = rules.match(/\.\.\.type\.(\w+)/)?.[1];
  return spread ? (type[spread as keyof typeof type] as { fontSize?: number }).fontSize : undefined;
}

/** The style of each Text a place in a source is drawn inside, outermost first: each opened before it and not yet closed. */
function around(source: string, at: number): string[] {
  const open: string[] = [];
  for (const [tag, props, closed] of source.slice(0, at).matchAll(/<Text\b((?:=>|[^>])*?)(\/?)>|<\/Text>/g)) {
    if (tag === "</Text>") open.pop();
    else if (closed !== "/") open.push(props.match(/\bstyle=\{(styles\.\w+|\[[^\]]*\])\}/)?.[1] ?? props.trim());
  }
  return open;
}

/** The parts of a style as written: each of an array's, split at its top-level commas, or the one style. */
function partsOf(style: string): string[] {
  const inner = style.replace(/^\[|\]$/g, "");
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === "(") depth += 1;
    else if (inner[i] === ")") depth -= 1;
    else if (inner[i] === "," && depth === 0) {
      parts.push(inner.slice(from, i).trim());
      from = i + 1;
    }
  }
  parts.push(inner.slice(from).trim());
  return parts;
}

/** The size of the words a name is drawn at, or beside: its own style's, or the innermost Text's around it. */
function wordsSize(file: string, own: string[], outer: string[]): number | undefined {
  for (const style of [own, ...[...outer].reverse().map(partsOf)]) {
    const sizes = style.map((part) => part.match(/^(?:.+ && )?styles\.(\w+)$/)?.[1]).filter((n): n is string => n != null).map((n) => sizeOf(file, n));
    const set = sizes.filter((s): s is number => s != null);
    if (set.length) return set[set.length - 1];
  }
  return undefined;
}

/** Every style that holds the face, in every file that reads it, where it is: an array, or a face alone. */
const faced = () =>
  READERS.flatMap((file) =>
    [...code(file).matchAll(/style=\{(\[[^\]]*\bface\([^\]]*\]|face\([^)]*\))\}/g)].map((m) => ({ file, style: m[1], at: m.index! })),
  );

describe("every username the app draws", () => {
  for (const [file, what, pattern] of SITES) {
    it(`${file}: ${what}`, () => {
      // Found, and found once: each place is named here once.
      expect(code(file)).toMatch(pattern);
      expect(code(file).match(new RegExp(pattern.source, "g")), file).toHaveLength(1);
    });
  }

  it("takes the face from the hook, read once at the top of what draws it, and then used", () => {
    for (const file of READERS) {
      const source = code(file);
      // MemberText draws names in two places of its own: an @name in what a member wrote, and a name the app writes words around.
      expect(source.match(/const face = useNameFace\(\);/g), file).toHaveLength(file === "src/components/MemberText.tsx" ? 2 : 1);
      // Read and then used: never read and left.
      expect(source.match(/\bface\(/g)?.length ?? 0, file).toBeGreaterThan(0);
    }
  });

  it("is set at the size of the words it sits beside or stands in for, wherever it is drawn", () => {
    const sized: string[] = [];
    for (const { file, style, at } of faced()) {
      const parts = partsOf(style);
      const call = parts.map((p) => p.match(/\bface\(([\w.]+)/)?.[1]).find((s) => s != null)!;
      // An @name's size is handed to MentionText by each place that draws one, and a sentence's to NamedWords (below).
      if (call === "size") continue;
      const own = parts.filter((p) => !/\bface\(/.test(p));
      // An admin's report writes its names, through nameOf, into lines of 12 pt each (checked below).
      const words = file === "app/admin/reports.tsx" ? 12 : wordsSize(file, own, around(code(file), at));
      sized.push(`${file}: ${call}`);
      expect(Number(call), `${file}: ${style}`).toBe(words);
    }
    // The scan finds what it is meant to: every place above but the @names and the sentences, whose sizes are checked next.
    expect(sized).toHaveLength(SITES.length - 2);
  });

  it("an @name, at the size of the words around it: each place that draws a member's words hands MentionText their size", () => {
    const handed: string[] = [];
    for (const file of [...READERS, CARD]) {
      const source = code(file);
      for (const m of source.matchAll(/<MentionText\b((?:=>|[^>])*?)\/>/g)) {
        const size = m[1].match(/\bsize=\{([\w.]+)\}/)?.[1];
        expect(size, `${file}: ${m[0]}`).toBeDefined();
        const outer = around(source, m.index);
        expect(numberIn(file, size!), `${file}: ${m[0]}`).toBe(wordsSize(file, [], outer));
        handed.push(`${file}: ${size}`);
        // Their words keep the line's own type: MentionText is handed a size, never a style or the face.
        expect(m[1], file).not.toMatch(/\bstyle=|\bface\b/);
      }
    }
    expect(handed.sort()).toEqual(
      [
        "app/comments.tsx: 14",
        "app/comments.tsx: 14",
        "app/post/[id].tsx: 14",
        "app/post/[id].tsx: 15",
        "src/components/PendingPostCard.tsx: 14",
        `${CARD}: WORDS`,
        `${CARD}: WORDS`,
      ].sort(),
    );
    // PostCard, drawn only under Original, hands none: its @names are as they always were.
    expect(code("src/components/PostCard.tsx")).not.toMatch(/<MentionText\b(?:=>|[^>])*\bsize=/);
    // MentionText reads the face itself, and sets each @name in it, in the accent, only when it is given a size.
    const text = code("src/components/MemberText.tsx");
    expect(text).toMatch(/const face = useNameFace\(\);\s*const parts = useMemo\(\(\) => parseMentions\(text\), \[text\]\);/);
    expect(text).toMatch(/\n {2}size\?: number;\n/);
    expect(rule("src/components/MemberText.tsx", "mention")).toEqual({ color: colors.accent, fontWeight: "600" });
  });

  it("on the editorial card is the face at 16 pt over its 12.5 pt words, set in its sheet, since it is drawn only under Editorial", () => {
    const card = code(CARD);
    const original = code("src/components/PostCard.tsx");
    // The owner's restyle (24 November, a size up the same day): Cormorant Garamond Medium Italic, 16 pt, in the name ink,
    // in the header and before the words alike; the words 12.5 pt.
    expect(card).toMatch(/\nconst WORDS = 12\.5;\nconst NAME = nameStyle\(WORDS\);\n/);
    expect(nameStyle(12.5)).toEqual({ fontFamily: MEDIUM, fontSize: 16, fontWeight: "500" });
    expect(card).toMatch(/\n {2}username: \{ flexShrink: 1, \.\.\.NAME, color: colors\.nameInk \},/);
    expect(card).toMatch(/\n {2}author: \{ \.\.\.NAME, color: colors\.nameInk \},/);
    expect(sizeOf(CARD, "caption")).toBe(12.5);
    expect(sizeOf(CARD, "comment")).toBe(12.5);
    // The 4 pt between a name and its words, as it was.
    expect(card).toMatch(/const NAME_GAP = "\\u2004";/);
    expect(card).toMatch(/\n {2}nameGap: \{ fontSize: 12 \},/);
    // The original card's own, untouched.
    expect(original).toMatch(/\n {2}username: \{ fontSize: 14, fontWeight: "600", color: colors\.ink \},/);
    expect(original).toMatch(/\n {2}captionAuthor: \{ fontWeight: "600" \},/);
    // Never the typewriter face or tracking on a name, nor a weight or style of the card's own over the face.
    for (const name of ["username", "author"]) {
      expect(card.match(new RegExp(`\\n {2}${name}: \\{ [^\\n]* \\},`))?.[0], name).not.toMatch(/letterSpacing|type\.mono|fontWeight|fontStyle/);
    }
    expect(card).not.toMatch(/useNameFace|useNameTitleStyle/);
    expect(card).toMatch(/<Text style=\{styles\.username\} numberOfLines=\{1\}>\s*\{post\.author\.username\}/);
    expect(card.match(/<NameLink\b(?:=>|[^>])*\/>/g)?.map((link) => link.match(/style=\{[^}]*\}/)?.[0])).toEqual(["style={styles.author}", "style={styles.author}"]);
  });

  it("is none of them left out: a Text or a link that draws a username has the face, or a reason not to", () => {
    // Where a username is drawn without the hook, and why: what draws it (a Text, or a NameLink, by the username it opens), and what.
    const without: Record<string, RegExp> = {
      // Always Editorial: its sheet sets the names in the face (above).
      [CARD]: /^(Text \{post\.author\.username\}|NameLink \{(post|c)\.author\.username\})$/,
      // Drawn only under Original: Home and the gallery draw the editorial card under Editorial.
      "src/components/PostCard.tsx": /^(Text \{post\.author\.username\}|NameLink \{(post|c)\.author\.username\})$/,
      // The initial that stands in for a picture, not the name.
      "src/components/Avatar.tsx": /^Text \{\(username\[0\] \?\? "\?"\)\.toUpperCase\(\)\}$/,
      // An admin's report: the line a comment's author is written into by nameOf, whose link has the face (above).
      "app/admin/reports.tsx": /^Text \{nameOf\(item\.comment\.author\?\.username\)\}$/,
      // The link itself, which draws a name in whatever style the place hands it: each place is read here.
      "src/components/MemberText.tsx": /^Text \{children \?\? username\}$/,
    };
    const drawn: string[] = [];
    let withFace = 0;
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      const source = code(file);
      // A Text whose words start with a username: its opening tag, then the expression.
      const texts = [...source.matchAll(/<Text\b((?:=>|[^>])*?)>\s*(\{[^{}]*\b(?:desired_)?username\b[^{}]*\})/g)].map(([, props, child]) => [props, `Text ${child}`]);
      // A link to a member's page, which draws the username it opens: its props, then that username.
      const links = [...source.matchAll(/<NameLink\b((?:=>|[^>])*?)\/?>/g)].map(([, props]) => [props, `NameLink {${props.match(/\busername=\{([^{}]*)\}/)?.[1]}}`]);
      for (const [props, what] of [...texts, ...links]) {
        const site = `${file}: ${what}`;
        drawn.push(site);
        if (/\bface\(/.test(props)) {
          withFace += 1;
          continue;
        }
        expect(without[file], site).toBeDefined();
        expect(what, site).toMatch(without[file]);
      }
    }
    // The scan finds what it is meant to: the places above with the face (but the name a sentence is written around,
    // which NamedWords draws by the name it is handed, checked below), and the nine without (the card's three and
    // PostCard's, the picture's initial, the report's line and the link itself).
    expect(withFace).toBe(SITES.length - 1);
    expect(drawn.length).toBe(SITES.length - 1 + 9);
    // An admin's report: its names through the one link; "unknown" for a member who has left.
    const reports = code("app/admin/reports.tsx");
    expect(reports.match(/\{nameOf\([^{}]*\)\}/g)).toEqual(["{nameOf(item.reporter?.username)}", "{nameOf(item.comment.author?.username)}", "{nameOf(item.member.username)}"]);
  });

  it("is only ever a username: display names, captions, comments and messages keep their own type", () => {
    let found = 0;
    for (const file of READERS) {
      const source = code(file);
      for (const m of source.matchAll(/<Text\b((?:=>|[^>])*?)>/g)) {
        const [tag, props] = m;
        if (!/\bface\(/.test(props)) continue;
        found += 1;
        // What the Text holds, up to its closing tag.
        const words = source.slice(m.index + tag.length).split("</Text>")[0].trim();
        const site = `${file}: ${words}`;
        if (file === "src/components/ProfileHeader.tsx") {
          // A display name, given the face only when it falls back to the username.
          expect(words, site).toBe("{profile.full_name ?? profile.username}");
          expect(props, site).toMatch(/profile\.full_name == null \? face\(15\) : undefined/);
        } else if (file === "src/components/MemberText.tsx") {
          // The name a sentence is written around: the username it is handed (below).
          expect(words, site).toBe("{name}");
        } else if (file === "app/post/[id].tsx" && /withName/.test(props)) {
          // A member tagged: their username, then "(pending)" while they have not accepted, then the comma before the next.
          expect(words.split(/\s*\n\s*/), site).toEqual([
            "{t.member.username}",
            '{t.status === "pending" ? " (pending)" : ""}',
            '{i < shownTags.length - 1 ? ", " : ""}',
          ]);
        } else {
          // A username alone.
          expect(words, site).toMatch(/^\{[^{}]*\b(?:desired_)?username\b[^{}]*\}$/);
          expect(words, site).not.toMatch(/full_name|caption|\.body|bio|preview/);
        }
      }
      // A link with the face: it draws the username it opens (an @name, as it was typed), and the face is in its style alone.
      for (const m of source.matchAll(/<NameLink\b((?:=>|[^>])*?)(\/?)>/g)) {
        const [tag, props, closed] = m;
        if (!/\bface\(/.test(props)) continue;
        found += 1;
        const site = `${file}: ${tag}`;
        expect(props.match(/\busername=\{([^{}]*)\}/)?.[1], site).toMatch(/^(?:[\w$]+\.)*username$/);
        expect(props.replace(/\bstyle=\{(?:\[[^\]]*\]|face\([^)]*\))\}/, ""), site).not.toMatch(/\bface\b/);
        if (file === "src/components/MemberText.tsx") expect(source.slice(m.index + tag.length).split("</NameLink>")[0].trim(), site).toBe("{part.text}");
        else expect(closed, site).toBe("/");
      }
    }
    expect(found).toBe(SITES.length);
    // The link draws in the style it is handed, and never reads the face itself; the @names are MentionText's.
    const links = code("src/components/MemberText.tsx");
    expect(links).toMatch(/<Text\s+style=\{style\}(?:=>|[^>])*>\s*\{children \?\? username\}\s*<\/Text>/);
    expect(links.slice(links.indexOf("export function NameLink"), links.indexOf("export const MentionText"))).not.toMatch(/\bface\b|useNameFace/);
  });

  it("inside a line of words, takes the line's size and keeps its ink: the lines each name is drawn in", () => {
    const inside: string[] = [];
    for (const { file, at } of faced()) {
      const outer = around(code(file), at);
      // The innermost line it is in, if any.
      if (outer.length) inside.push(`${file}: ${outer[outer.length - 1]}`);
    }
    expect(inside.sort()).toEqual(
      [
        "app/(tabs)/activity.tsx: styles.line",
        "app/comments.tsx: styles.text",
        "app/comments.tsx: styles.text",
        "app/messages/[id].tsx: [styles.sharedCaption, mine && styles.textMine]",
        "app/post/[id].tsx: styles.withText",
        "app/post/[id].tsx: styles.caption",
        "app/post/[id].tsx: styles.comment",
        "src/components/PendingPostCard.tsx: styles.caption",
        "src/components/PendingPostCard.tsx: styles.caption",
      ].sort(),
    );
    // A post's caption is set in the serif: the name before it is set at the serif's size, in the face, as every name is.
    expect(block("app/post/[id].tsx", "caption")).toMatch(/fontFamily: type\.serif/);
    expect(sizeOf("app/post/[id].tsx", "caption")).toBe(15);
    // An admin's report writes its names, through nameOf, into lines of 12 pt each: the face's size there.
    const reports = code("app/admin/reports.tsx");
    for (const line of ["headline", "resolutionText"]) expect(sizeOf("app/admin/reports.tsx", line), line).toBe(12);
    expect(reports).toMatch(/<Text style=\{styles\.headline\}>\s*\{item\.target_type\} · reported by \{nameOf\(item\.reporter\?\.username\)\}/);
    expect(reports).toMatch(/<Text style=\{styles\.resolutionText\}>\s*\{nameOf\(item\.comment\.author\?\.username\)\}/);
    expect(reports).toMatch(/<Text style=\{styles\.resolutionText\}>Member: \{nameOf\(item\.member\.username\)\}<\/Text>/);
  });
});

/** A word of a one-line rule, as the value it stands for here (each colour as the light paper's). */
function valueOf(words: string): unknown {
  if (/^colors\.\w+$/.test(words)) return colors[words.slice("colors.".length) as keyof typeof colors];
  if (/^type\.\w+$/.test(words)) return type[words.slice("type.".length) as keyof typeof type];
  if (/^"[^"]*"$/.test(words)) return words.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(words)) return Number(words);
  throw new Error(`Not a value: ${words}`);
}

/** A one-line rule of a file's sheet (`  name: { … },`), as its values. */
function rule(file: string, name: string): Record<string, unknown> {
  const body = code(file).match(new RegExp(`\\n  ${name}: \\{ ([^\\n{}]*?) \\},`))?.[1];
  if (body == null) throw new Error(`${file}: no one-line rule styles.${name}`);
  return Object.fromEntries(
    body.split(/,\s*/).map((pair) => {
      const [key, words] = pair.split(/:\s*/);
      return [key, valueOf(words)];
    }),
  );
}

/**
 * A name's style as written at a site (an array, or the face alone), drawn
 * under a layout with its state on or off, flattened as React Native
 * flattens it: each style over the ones before it, and a state's style only
 * while the state holds. "before" is the style as claude/product-polish
 * writes it: without the face. An @name's state is being given a size (14).
 */
function drawn(file: string, style: string, layout: "original" | "editorial" | "before", state: boolean): Record<string, unknown> {
  const face = layout === "before" ? () => undefined : nameFace(layout);
  return Object.assign(
    {},
    ...partsOf(style).map((part) => {
      const call = part.match(/^face\(([\d.]+)(?:, (.+))?\)$/);
      if (call) {
        const cut = call[2]?.match(/^.+ \? "(\w+)" : "(\w+)"$/);
        return face(Number(call[1]), (cut ? (state ? cut[1] : cut[2]) : "medium") as "medium" | "semibold");
      }
      const either = part.match(/^.+ \? face\(([\d.]+)\) : undefined$/);
      if (either) return state ? face(Number(either[1])) : undefined;
      if (part === "size == null ? undefined : face(size)") return state ? face(14) : undefined;
      // A name a sentence is written around: drawn only when the face is given.
      if (part === "face(size)") return face(14);
      const plain = part.match(/^styles\.(\w+)$/);
      if (plain) return rule(file, plain[1]);
      const when = part.match(/^.+ && styles\.(\w+)$/);
      if (when) return state ? rule(file, when[1]) : undefined;
      throw new Error(`${file}: not a style: ${part}`);
    }),
  );
}

describe("a name under each layout", () => {
  it("is found in every style that holds the face, one for each place above", () => {
    expect(faced()).toHaveLength(SITES.length);
  });

  it("under Original is exactly as it was before the trial, state or not", () => {
    for (const { file, style } of faced()) {
      for (const state of [false, true]) {
        expect(drawn(file, style, "original", state), `${file}: ${style} (${state})`).toEqual(drawn(file, style, "before", state));
      }
    }
  });

  it("under Editorial is as under Original but for the face: Cormorant, at its size, at the weight of its cut", () => {
    let changed = 0;
    for (const { file, style } of faced()) {
      for (const state of [false, true]) {
        const site = `${file}: ${style} (${state})`;
        const before = drawn(file, style, "original", state);
        const after = drawn(file, style, "editorial", state);
        // Where the face is not given (a display name, an @name given no size), nothing changes.
        if (after.fontFamily == null) {
          expect(after, site).toEqual(before);
          continue;
        }
        changed += 1;
        const { fontFamily, fontSize, fontWeight, ...rest } = after;
        const { fontFamily: _family, fontSize: _size, fontWeight: _weight, ...was } = before;
        // The colour, the spacing and the rest: as they were.
        expect(rest, site).toEqual(was);
        expect([MEDIUM, SEMIBOLD], site).toContain(fontFamily);
        expect(fontWeight, site).toBe(fontFamily === MEDIUM ? "500" : "600");
        expect(fontSize, site).toBe(nameSize(Number(partsOf(style).map((p) => p.match(/\bface\(([\d.]+)/)?.[1]).find(Boolean) ?? 14)));
        // Never the typewriter face, nor tracking, nor a style over the italic.
        expect(after, site).not.toHaveProperty("fontStyle");
        expect(after.letterSpacing ?? 0, site).toBe(0);
      }
    }
    expect(changed).toBeGreaterThanOrEqual(SITES.length * 2 - 4);
  });

  it("comes last, after the place's own style and any state's, so nothing after it chooses another cut or a weight", () => {
    for (const { file, style } of faced()) {
      const parts = partsOf(style);
      expect(parts.findIndex((p) => /\bface\(/.test(p)), `${file}: ${style}`).toBe(parts.length - 1);
    }
    // Two a state marks in the name's own style, each before the face.
    expect(faced().filter(({ style }) => /&& styles\./.test(style)).map(({ file, style }) => `${file}: ${style}`)).toEqual([
      'app/messages/index.tsx: [styles.username, unread && styles.unreadText, face(15, unread ? "semibold" : "medium")]',
      'app/post/[id].tsx: [styles.withName, t.status === "pending" && styles.withPending, face(12)]',
    ]);
    // The third, your own bubble, marks the line a photograph's author is drawn in: the name's own style is the face alone, and
    // the bubble's ink reaches the name through the line (below). So is a name a sentence is written around.
    expect(faced().filter(({ style }) => /^face\(/.test(style)).map(({ file, style }) => `${file}: ${style}`)).toEqual([
      "app/messages/[id].tsx: face(11)",
      "src/components/MemberText.tsx: face(size)",
    ]);
  });
});

describe("a state a place marks a name for", () => {
  it("an unread thread: its name in the face's semibold cut under Editorial, a step above a read one's medium, as under Original", () => {
    const file = "app/messages/index.tsx";
    const style = code(file).match(/<Text style=\{(\[[^\]]*\])\}>\s*\{conversation\.peer\.username\}/)![1];
    expect(rule(file, "unreadText")).toEqual({ color: colors.ink, fontWeight: "600" });
    // The preview under it is marked by the same style, and its dot.
    expect(code(file)).toMatch(/<Text style=\{\[styles\.preview, unread && styles\.unreadText\]\} numberOfLines=\{1\}>\s*\{preview\}/);
    expect(code(file)).toMatch(/\{unread \? <View style=\{styles\.dot\} \/> : null\}/);
    expect(drawn(file, style, "editorial", true)).toEqual({ fontFamily: SEMIBOLD, fontSize: 19, color: colors.ink, fontWeight: "600" });
    expect(drawn(file, style, "editorial", false)).toEqual({ fontFamily: MEDIUM, fontSize: 19, color: colors.ink, fontWeight: "500" });
    // Under Original exactly as before the trial.
    expect(drawn(file, style, "original", true)).toEqual({ fontSize: 15, color: colors.ink, fontWeight: "600" });
    expect(drawn(file, style, "original", false)).toEqual({ fontSize: 15, color: colors.ink });
  });

  it("a photograph sent in your own bubble: its author's name in the bubble's light ink on its dark paper", () => {
    const file = "app/messages/[id].tsx";
    // The line under the photograph, and the name in it, a link: the name takes the line's ink, and lays its own style over it.
    const [, line, own] = code(file).match(
      /<Text style=\{(\[[^\]]*\])\} numberOfLines=\{1\}>\s*<NameLink username=\{shared\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{([^{}]*)\} \/>\s*<\/Text>/,
    )!;
    // The name's own style is the face, and nothing else: the line, your own bubble's ink with it, is as it was under either layout.
    expect(own).toBe("face(11)");
    expect(line).not.toMatch(/\bface\b/);
    const name = (layout: "original" | "editorial" | "before", mine: boolean) => ({ ...drawn(file, line, layout, mine), ...drawn(file, own, layout, mine) });
    expect(rule(file, "bubbleMine")).toEqual({ backgroundColor: colors.shutter, borderColor: colors.shutter });
    // The bubble's ink sets no weight or face, so the name is the face's still.
    expect(rule(file, "textMine")).toEqual({ color: colors.onShutter });
    expect(name("editorial", true)).toEqual({ fontFamily: MEDIUM, fontSize: 14, color: colors.onShutter, marginTop: 4, fontWeight: "500" });
    // In their bubble, on the raised paper, its own faint ink.
    expect(name("editorial", false)).toEqual({ fontFamily: MEDIUM, fontSize: 14, color: colors.inkFaint, marginTop: 4, fontWeight: "500" });
    // Under Original exactly as before the trial.
    expect(name("original", true)).toEqual({ fontSize: 11, marginTop: 4, color: colors.onShutter });
    expect(name("original", false)).toEqual({ fontSize: 11, marginTop: 4, color: colors.inkFaint });
    for (const mine of [false, true]) expect(name("original", mine)).toEqual(name("before", mine));
  });

  it("a member tagged who has not yet accepted: faint, as the state sets it, in the face, with \"(pending)\" after", () => {
    const file = "app/post/[id].tsx";
    const style = code(file).match(/style=\{(\[styles\.withName, [^\]]*\])\}/)![1];
    const pending = rule(file, "withPending");
    expect(pending).toEqual({ fontWeight: "400", color: colors.inkFaint });
    // Under Editorial: a pending name faint, an accepted one in its own dark ink, both the face's medium cut.
    expect(drawn(file, style, "editorial", true)).toEqual({ fontFamily: MEDIUM, fontSize: 15.5, fontWeight: "500", color: colors.inkFaint });
    expect(drawn(file, style, "editorial", false)).toEqual({ fontFamily: MEDIUM, fontSize: 15.5, fontWeight: "500", color: colors.ink });
    // Under Original exactly as before the trial: an accepted name dark and bold, a pending one faint and regular.
    expect(drawn(file, style, "original", false)).toEqual({ fontWeight: "600", color: colors.ink });
    expect(drawn(file, style, "original", true)).toEqual(pending);
  });

  it("an @name: in the accent, as a link is, in the face at the size of the words around it", () => {
    const file = "src/components/MemberText.tsx";
    const style = faced().find((f) => f.file === file)!.style;
    expect(drawn(file, style, "editorial", true)).toEqual({ fontFamily: MEDIUM, fontSize: 18, fontWeight: "500", color: colors.accent });
    expect(drawn(file, style, "original", true)).toEqual({ color: colors.accent, fontWeight: "600" });
    // Given no size (PostCard, drawn only under Original), as it always was.
    expect(drawn(file, style, "editorial", false)).toEqual({ color: colors.accent, fontWeight: "600" });
  });
});

/** What an element holds. */
const childrenOf = (element: ReactElement) => (element.props as { children: unknown }).children;

describe("a username written into a sentence", () => {
  /** The words NamedWords draws, handed what writes them around a name. */
  const named = (write: (name: string) => string, name: string, size = 13) => childrenOf(NamedWords({ words: write, name, size }) as ReactElement);

  it("is drawn in the face by NamedWords, the words around it as they were; under Original the words are the one string they were", () => {
    // Under Original, the one string the words always were.
    expect(named((name) => `${name} hasn’t posted a photograph yet.`, "tomas.lindqvist")).toBe("tomas.lindqvist hasn’t posted a photograph yet.");
    setFeedLayout("editorial");
    // Under Editorial, the words around the name as they were, and the name in the face at the words' size.
    const [before, name, after] = named((name) => `Nobody follows ${name} yet.`, "june.nakamura") as [string, ReactElement, string];
    expect([before, after]).toEqual(["Nobody follows ", " yet."]);
    expect(name.props).toEqual({ style: nameStyle(13), children: "june.nakamura" });
    const blocked = named((name) => `You blocked ${name}`, "otis.whitfield", 16) as [string, ReactElement, string];
    expect(blocked).toHaveLength(3);
    expect([blocked[0], blocked[2]]).toEqual(["You blocked ", ""]);
    expect(blocked[1].props).toEqual({ style: nameStyle(16), children: "otis.whitfield" });
    // Words that do not write the name, or write it more than once, are left as the one string.
    expect(named(() => "Eras gather the photographs you post.", "you.post")).toBe("Eras gather the photographs you post.");
    expect(named((name) => `${name}, ${name}`, "june.nakamura")).toBe("june.nakamura, june.nakamura");
    const source = code("src/components/MemberText.tsx");
    expect(source).toMatch(/const around = face\(size\) && USERNAME_RE\.test\(name\) \? words\(SLOT\)\.split\(SLOT\) : \[\];\s*if \(around\.length !== 2\) return <>\{words\(name\)\}<\/>;/);
    // Found by writing the words with a character no sentence or username holds in the name's place, never by searching.
    expect(source).toMatch(/\nconst SLOT = "\\u0000";\n/);
    expect(source).not.toMatch(/indexOf\(name/);
  });

  it("is the name where the sentence writes it, even where a member's username spells one of the sentence's own words", () => {
    setFeedLayout("editorial");
    // A member's empty Eras page, as EraList writes it: erasEmpty's own sentence, written around the name.
    const summary = (undated: number, apart: number) => ({ eras: [], undated, apart }) as unknown as Parameters<typeof erasEmpty>[0];
    const eras = (undated: number, apart: number) => (name: string) => erasEmpty(summary(undated, apart), name)!.body;
    const cases: [write: (name: string) => string, username: string][] = [
      [(name) => `You blocked ${name}`, "blocked"],
      [(name) => `Ask to follow ${name} to see their photographs.`, "follow"],
      [(name) => `${name} has your request. You'll see their photographs once they accept.`, "their"],
      [(name) => `Nobody follows ${name} yet.`, "follows"],
      [(name) => `${name} isn't following anyone yet.`, "following"],
      [eras(0, 0), "posted"],
      [eras(1, 0), "taken"],
      [eras(1, 0), "photograph"],
      [eras(1, 1), "place"],
      [(name) => `invited by ${name}`, "invited"],
      [(name) => `${name} invited you to VINTAGE. Fill this in and you are a member — no queue, no review.`, "member"],
    ];
    for (const [write, username] of cases) {
      const [before, name, after] = named(write, username) as [string, ReactElement, string];
      const slot = write("\u0000");
      // The words before and after the name are the sentence's own, to the letter, and the name in the face is its slot.
      expect([before, after], write(username)).toEqual(slot.split("\u0000"));
      expect(name.props, write(username)).toEqual({ style: nameStyle(13), children: username });
      // Each of these usernames is also one of the sentence's own words: written twice, once as a word, once as the name.
      expect(write(username).split(/[^\p{L}\p{N}._]+/u).filter((word) => word === username), write(username)).toHaveLength(2);
    }
  });

  it("is in the face only where the name reads as a username: a full name, or a name as an applicant wrote it, keeps the words' type", () => {
    setFeedLayout("editorial");
    const invited = (name: string) => `${name} invited you to VINTAGE. Fill this in and you are a member — no queue, no review.`;
    // The invitation's page names the member by their full name, or by their username where they gave none.
    expect(named(invited, "Elena Marchetti", 15)).toBe(invited("Elena Marchetti"));
    const [, name] = named(invited, "elena.marchetti", 15) as [string, ReactElement, string];
    expect(name.props).toEqual({ style: nameStyle(15), children: "elena.marchetti" });
    // An applicant writes who sent them as they like.
    expect(named((name) => `invited by ${name}`, "my friend Sam", 12)).toBe("invited by my friend Sam");
    expect((named((name) => `invited by ${name}`, "elena.marchetti", 12) as [string, ReactElement, string])[1].props).toEqual({
      style: nameStyle(12),
      children: "elena.marchetti",
    });
    // Every member's username reads as one: the database holds them to it, as the app does.
    expect(USERNAME_RE.source).toBe("^[a-z0-9_.]{3,24}$");
    expect(readFileSync(path.join(root, "supabase/migrations/0001_schema.sql"), "utf8")).toContain("check (username ~ '^[a-z0-9_.]{3,24}$')");
    // The invitation's owner, as the database names them: the full name, or the username where there is none.
    expect(readFileSync(path.join(root, "supabase/migrations/0012_invite_links.sql"), "utf8")).toContain("select coalesce(nullif(p.full_name, ''), p.username), p.invite_quota");
  });

  it("is handed to NamedWords with the size of the line it is in, wherever the app writes one into words", () => {
    const handed: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      const source = code(file);
      for (const m of source.matchAll(/<NamedWords\b((?:=>|[^>])*?)\/>/g)) {
        const size = m[1].match(/\bsize=\{([\d.]+)\}/)?.[1];
        expect(Number(size), `${file}: ${m[0]}`).toBe(wordsSize(file, [], around(source, m.index)));
        // Handed what writes the words, never words already written.
        expect(m[1], `${file}: ${m[0]}`).toMatch(/^\s*words=\{\s*(?:\(name\) => |body\}|closed\s*\? \(name\) => |status === "pending"\s*\? \(name\) => )/);
        handed.push(`${file}: ${size}`);
      }
    }
    expect(handed.sort()).toEqual([
      "app/(gate)/invite.tsx: 15",
      "app/admin/applications.tsx: 12",
      "app/user/[username].tsx: 13",
      "app/user/[username].tsx: 16",
      "src/components/EmptyState.tsx: 13",
    ]);
    // EmptyState hands it a body written around a name, once the name is known; a body of words, as it was.
    const state = (body: string | ((name: string) => string) | undefined, name?: string) => EmptyState({ title: "No eras yet", body, name }) as ReactElement;
    const bodyOf = (element: ReactElement) => (childrenOf(element) as (ReactElement | null)[])[1];
    const write = (name: string) => `Nobody follows ${name} yet.`;
    const words = childrenOf(bodyOf(state(write, "june.nakamura"))!) as ReactElement;
    expect(words.type).toBe(NamedWords);
    expect(words.props).toEqual({ words: write, name: "june.nakamura", size: 13 });
    expect(bodyOf(state(write))).toBeNull();
    expect(childrenOf(bodyOf(state("No eras yet."))!)).toBe("No eras yet.");
    expect(bodyOf(state(undefined))).toBeNull();
    // A blocked or private profile's lines: the words they always were, written around the username.
    const profile = code("app/user/[username].tsx");
    expect(profile).toMatch(/<Text style=\{styles\.lockedTitle\}>\s*<NamedWords words=\{\(name\) => `You blocked \$\{name\}`\} name=\{profile\.username\} size=\{16\} \/>\s*<\/Text>/);
    expect(profile).toMatch(
      /<Text style=\{styles\.lockedBody\}>\s*<NamedWords\s+words=\{\s*status === "pending"\s*\? \(name\) => `\$\{name\} has your request\. You'll see their photographs once they accept\.`\s*: \(name\) => `Ask to follow \$\{name\} to see their photographs\.`\s*\}\s*name=\{profile\.username\}\s*size=\{13\}\s*\/>\s*<\/Text>/,
    );
    // Who sent an applicant, as they wrote it, in an admin's queue.
    expect(code("app/admin/applications.tsx")).toMatch(
      /\{item\.inviter \? \(\s*<Text style=\{styles\.meta\}>\s*<NamedWords words=\{\(name\) => `invited by \$\{name\}`\} name=\{item\.inviter\} size=\{12\} \/>\s*<\/Text>\s*\) : null\}/,
    );
    // Who sent an invitation, on its page.
    expect(code("app/(gate)/invite.tsx")).toMatch(
      /<Text style=\{styles\.blurb\}>\s*\{inviter \? \(\s*<NamedWords\s+words=\{\s*closed\s*\? \(name\) => `\$\{name\} invited you, but every invitation they were given has since been taken up\.`\s*: \(name\) => `\$\{name\} invited you to VINTAGE\. Fill this in and you are a member — no queue, no review\.`\s*\}\s*name=\{inviter\}\s*size=\{15\}\s*\/>\s*\) : unknown \? \(/,
    );
  });

  it("is in the face in every sentence the app draws, or a sentence the system draws, or VoiceOver speaks", () => {
    // A template that writes a username into words, and where it goes.
    const written: Record<string, RegExp[]> = {
      // Dialogs, prompts and action sheets: the system draws them, in its own face.
      "app/admin/members.tsx": [
        /^`Invitations for \$\{member\.username\}`$/,
        /^`Warn \$\{member\.username\}`$/,
        /^`Suspend \$\{member\.username\}\?`$/,
        /^`Reinstate \$\{member\.username\}\?`$/,
      ],
      "app/messages/[id].tsx": [/^`Block \$\{peer\.username\}\?`$/],
      "app/user/[username].tsx": [/^`Block \$\{profile\.username\}\?`$/],
      // Spoken by VoiceOver, never drawn.
      "app/(tabs)/search.tsx": [/^`Forget \$\{item\.username\}`$/],
      "app/blocked.tsx": [/^`Unblock \$\{item\.username\}`$/],
      "app/requests.tsx": [/^`Accept \$\{item\.username\}`$/, /^`Decline \$\{item\.username\}`$/],
      // A member's picture, a button VoiceOver reads by whose page it opens: spoken, never drawn.
      "app/(tabs)/activity.tsx": [/^`\$\{item\.actor\.username\}’s profile`$/],
      "app/comments.tsx": [/^`\$\{post\.author\.username\}’s profile`$/, /^`\$\{comment\.author\.username\}’s profile`$/],
      "app/messages/index.tsx": [/^`\$\{conversation\.peer\.username\}’s profile`$/],
      "app/post/[id].tsx": [/^`\$\{post\.author\.username\}’s profile`$/],
      "src/components/PostCard.tsx": [/^`\$\{post\.author\.username\}’s profile`$/],
      // A row's names as its actions, which VoiceOver speaks and hands back by these words: never drawn.
      "src/utils/nameActions.ts": [/^`View \$\{username\}’s profile`$/],
      // The public web page, written on the server: the preference is kept on the phone.
      "src/share/publicPage.ts": [/^`A photograph from \$\{p\.username\}’s archive · VINTAGE`$/],
      // A member's empty Eras page: written by erasEmpty, which EraList hands EmptyState as what writes it around the
      // name, and EmptyState hands NamedWords: the name in the face (below).
      "src/components/eraBook.ts": [
        /^`\$\{member\} hasn’t posted a photograph yet\.`$/,
        /, and none of \$\{member\}’s carries that date\.`$/,
        /^`\$\{ERA_RULE\} None of \$\{member\}’s photographs make one yet\.`$/,
      ],
    };
    const found: string[] = [];
    for (const file of sources()) {
      for (const [template] of code(file).matchAll(/`[^`]*`/g)) {
        if (!/\$\{\s*(?:(?:[\w$]+(?:\?\.|\.))*(?:desired_)?username|member)\s*\}/.test(template)) continue;
        // A route to a profile: never drawn.
        if (template.startsWith("`/user/")) continue;
        const site = `${file}: ${template}`;
        found.push(site);
        expect(written[file]?.some((allowed) => allowed.test(template)), site).toBe(true);
      }
    }
    // The scan finds what it is meant to: each sentence allowed above, once, and no other.
    expect(found).toHaveLength(Object.values(written).flat().length);
    // Those spoken are what VoiceOver reads for a button, written where the button is.
    for (const file of ["app/(tabs)/search.tsx", "app/blocked.tsx", "app/requests.tsx", "app/(tabs)/activity.tsx", "app/comments.tsx", "app/messages/index.tsx", "app/post/[id].tsx", "src/components/PostCard.tsx"]) {
      for (const site of found.filter((s) => s.startsWith(`${file}: `))) {
        expect(code(file), site).toContain(`accessibilityLabel={${site.slice(file.length + 2)}}`);
      }
    }
    expect(code("src/utils/nameActions.ts")).toMatch(/const said = `View \$\{username\}’s profile`;\s*out\.push\(\{ name: said, label: said \}\);/);
    // The sentences the app draws around a username, each handed to NamedWords (directly, or through EmptyState) as
    // what writes it, a function of the name: every such writer, in every file, and no other.
    const writers: Record<string, string[]> = {};
    for (const file of sources()) {
      const source = code(file);
      for (const [, writes] of source.matchAll(/\(name\) => (`[^`]*`|[\w$.()!, ]+?(?=\}|\s:\s|\n))/g)) (writers[file] ??= []).push(writes);
      // Every arrow of a name but one that reads the name itself (a filter's `(name) => name.length > 0`).
      expect(writers[file]?.length ?? 0, file).toBe(source.match(/\(name\) => (?!name\.)/g)?.length ?? 0);
    }
    expect(writers).toEqual({
      "app/(gate)/invite.tsx": [
        "`${name} invited you, but every invitation they were given has since been taken up.`",
        "`${name} invited you to VINTAGE. Fill this in and you are a member — no queue, no review.`",
      ],
      "app/admin/applications.tsx": ["`invited by ${name}`"],
      "app/follows.tsx": ["`Nobody follows ${name} yet.`", "`${name} isn't following anyone yet.`"],
      "app/user/[username].tsx": [
        "`You blocked ${name}`",
        "`${name} has your request. You'll see their photographs once they accept.`",
        "`Ask to follow ${name} to see their photographs.`",
      ],
      // erasEmpty's own sentences (above), written around the name.
      "src/components/EraList.tsx": ["erasEmpty(summary, name)!.body"],
    });
    // An empty Followers or Following list's sentence, and a member's empty Eras page: handed to EmptyState with the name,
    // drawn once the name is known.
    const follows = code("app/follows.tsx");
    expect(follows).toMatch(/body=\{followers \? \(name\) => `Nobody follows \$\{name\} yet\.` : \(name\) => `\$\{name\} isn't following anyone yet\.`\}\s*name=\{username\}\s*\/>/);
    expect(follows.match(/<EmptyState\b/g)).toHaveLength(1);
    const eras = code("src/components/EraList.tsx");
    expect(eras).toMatch(/const empty = erasEmpty\(summary, member\);/);
    expect(eras).toMatch(/<EmptyState title=\{empty\.title\} body=\{member \? \(name\) => erasEmpty\(summary, name\)!\.body : empty\.body\} name=\{member\} \/>/);
    expect(eras.match(/<EmptyState\b/g)).toHaveLength(1);
  });
});

/** Every file that reads the module: a name's face, a username's title, or both; and the card's nameStyle. */
const ALL_READERS = [...new Set([...READERS, ...Object.keys(TITLE_READERS), "app/(tabs)/_layout.tsx", CARD])];

describe("the trial still comes out cleanly", () => {
  it("is read by exactly these files, each reading what it uses and nothing else", () => {
    const readers = sources().filter((rel) => /from "@\/utils\/nameFace"/.test(code(rel)));
    expect(readers.sort()).toEqual([...ALL_READERS].sort());
    for (const file of ALL_READERS) {
      const hooks =
        file === CARD
          ? "nameStyle"
          : [READERS.includes(file) && "useNameFace", (file in TITLE_READERS || file === "app/(tabs)/_layout.tsx") && "useNameTitleStyle"].filter(Boolean).join(", ");
      expect(code(file).match(/import \{ ([^}]*) \} from "@\/utils\/nameFace";/)?.[1], file).toBe(hooks);
    }
  });

  it("leaves PostCard, drawn only under Original, and the sentences' own words as they were", () => {
    for (const file of ["src/components/PostCard.tsx", "src/components/eraBook.ts", "src/components/Avatar.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).not.toMatch(/Editorial|nameFace|useNameTitleStyle/);
      expect(code(file), file).not.toMatch(/\bface\(/);
    }
    // Followers and Eras hand EmptyState their sentence as what writes it, and EmptyState, like the invitation's page,
    // hands it to NamedWords: none reads the module.
    for (const file of ["app/follows.tsx", "src/components/EraList.tsx", "src/components/EmptyState.tsx", "app/(gate)/invite.tsx"]) {
      expect(code(file), file).not.toMatch(/nameFace|useNameFace|\bface\(/);
    }
    expect(code("src/components/EmptyState.tsx")).toMatch(/^import \{ NamedWords \} from "\.\/MemberText";$/m);
    for (const file of ["app/(gate)/invite.tsx", "app/admin/applications.tsx"]) {
      expect(code(file), file).toMatch(/^import \{ NamedWords \} from "@\/components\/MemberText";$/m);
    }
  });

  it("is listed, with every file it touches, where the page says how to take the trial out", () => {
    const page = readFileSync(path.join(root, "EDITORIAL_FEED_PREVIEW.md"), "utf8");
    for (const file of [
      "src/utils/nameFace.ts",
      "tests/editorial-names.test.ts",
      ...ALL_READERS,
      "app/follows.tsx",
      "src/components/EraList.tsx",
      "src/components/EmptyState.tsx",
      "app/(gate)/invite.tsx",
    ]) {
      expect(page, file).toContain(file);
    }
    const out = page.slice(page.indexOf("## Taking it out of a branch that has it"));
    expect(out).toMatch(/git rm [^\n]*src\/utils\/nameFace\.ts/);
    expect(out).toMatch(/git rm [^\n]*tests\/editorial-names\.test\.ts/);
    expect(out).toMatch(/git rm [^\n]*src\/components\/feed\/EditorialPostCard\.tsx/);
    // The names' face goes with it: both cuts, their licence and their guards.
    expect(out).toMatch(/git rm [^\n]*assets\/fonts\/CormorantGaramond-MediumItalic\.ttf/);
    expect(out).toMatch(/git rm [^\n]*assets\/fonts\/CormorantGaramond-SemiBoldItalic\.ttf/);
    expect(out).toMatch(/git rm [^\n]*assets\/fonts\/CormorantGaramond-OFL\.txt/);
    expect(out).toMatch(/git rm [^\n]*tests\/editorial-name-font\.test\.ts/);
    // Exactly the files it touches go back to claude/product-polish's own: no more, no fewer.
    const checkout = out.match(/git checkout claude\/product-polish -- ([^\n]*)/)?.[1] ?? "";
    const named = checkout.split(/\s+/).map((f) => f.replace(/^"|"$/g, ""));
    expect(named.sort()).toEqual(
      [
        ...ALL_READERS.filter((file) => file !== CARD),
        "app/(tabs)/index.tsx",
        "app/settings.tsx",
        // The sentences handed to EmptyState as what writes them around a name, and EmptyState, which hands them to
        // NamedWords, as the invitation's page does.
        "app/follows.tsx",
        "src/components/EraList.tsx",
        "src/components/EmptyState.tsx",
        "app/(gate)/invite.tsx",
        "tests/video-playback.test.ts",
        "tests/galleryLanding.test.ts",
        "tests/stableCards.test.ts",
        "tests/comment-menu.test.ts",
        "tests/thread-menu.test.ts",
        "tests/member-names.test.ts",
        "tests/admin-queue-pages.test.ts",
        // The editorial card's name ink (the owner's restyle, 24 November).
        "src/theme/index.ts",
        "tests/theme.test.ts",
        // expo-font's plugin builds the names' face into the iPhone app.
        "app.json",
        "e2e/launch-test.mjs",
      ].sort(),
    );
    // A path with brackets or parentheses is quoted, so the shell takes it as it is.
    for (const file of named) if (/[([]/.test(file)) expect(checkout, file).toContain(`"${file}"`);
    expect(out).toContain("-e nameFace");
  });
});
