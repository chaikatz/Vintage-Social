import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Editorial (Preview): members' usernames set as the print sets its credit.
 *
 * While the feed is Editorial every username the app draws as a name is set
 * in the print credit's face and tracking (type.mono, 0.08 em), and, as the
 * member chose, bold and in the words' own ink; each at its own size; where
 * a place marks a name for a state of its own, the state still wins, but
 * for an unread thread, which its dot and preview mark instead. Under Original nothing changes at all.
 * First the module that says so, then, read from the source, every place
 * that draws a username, so that none is dropped and none is added without
 * it, and every state that still wins over it. Last, which files may read
 * the module, so the trial still comes out cleanly.
 */

vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (choices: { ios?: unknown; default?: unknown }) => choices.ios ?? choices.default },
  DynamicColorIOS: (pair: { light: string; dark: string }) => pair.light,
}));
// The preference is kept on the phone; here it is kept in memory.
vi.mock("@/utils/diskCache", () => ({ readDiskCache: () => null, writeDiskCache: () => {} }));
// Outside a component a hook has nothing to subscribe it: read the store as a first draw does.
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useSyncExternalStore: (_subscribe: unknown, get: () => unknown) => get(),
}));

const { NAME_INK, aroundName, nameFace, nameTitleStyle, useNameFace, useNameTitleStyle } = await import("@/utils/nameFace");
const { setFeedLayout, __resetFeedLayoutForTest } = await import("@/utils/feedLayout");
const { colors, dark, type } = await import("@/theme");
/** A name under Editorial: the print's face and tracking, bold, in the words' ink. */
const EDITORIAL = { fontFamily: type.mono, fontWeight: "700", letterSpacing: 1.1, color: NAME_INK };
const { PRINT_WIDTH, exportLayout } = await import("@/utils/exportLayout");
const { erasEmpty } = await import("@/components/eraBook");
const { eraSummary } = await import("@/utils/memories");

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

/** The print's credit line as ExportCard sets it: its style, from its box to the end of the array. */
const credit = () => code("src/components/ExportCard.tsx").match(/rect\(L\.credit\),[\s\S]*?\]/)?.[0] ?? "";

describe("the names' face", () => {
  it("is the print's credit under Editorial, and nothing at all under Original", () => {
    expect(nameFace("editorial")).toEqual(EDITORIAL);
    // On the phone: Courier New Bold, 1.1 pt apart, in the words' near-black ink (their cream in the dark appearance).
    expect(nameFace("editorial")).toEqual({ fontFamily: "Courier New", fontWeight: "700", letterSpacing: 1.1, color: "#2B2620" });
    // Nothing, not an empty style: a style array is exactly what it was.
    expect(nameFace("original")).toBeUndefined();
    // The same object each time, so nothing redraws for it alone.
    expect(nameFace("editorial")).toBe(nameFace("editorial"));
  });

  it("is the print's face, bold and in the words' own ink, as the member chose over the credit's faint and regular", () => {
    expect(credit()).toMatch(/fontFamily: type\.mono,/);
    // The print's credit is faint and regular; a name in the app is the words' ink, and bold.
    expect(credit()).toMatch(/color: c\.inkFaint,/);
    expect(credit()).not.toMatch(/fontWeight/);
    expect(NAME_INK).toBe(colors.ink);
    expect(nameFace("editorial")!.color).toBe(colors.ink);
    // The theme's own dynamic ink, not its light value alone: cream on the dark print's brown, never near-black on it.
    expect(code("src/utils/nameFace.ts")).toMatch(/export const NAME_INK: ColorValue = colors\.ink;/);
    expect(code("src/theme/index.ts")).toMatch(/\bink: dyn\(light\.ink, dark\.ink\)/);
    expect(dark.ink).toBe("#F6ECDF");
    expect(nameFace("editorial")!.color).not.toBe(colors.inkFaint);
    expect(nameFace("editorial")!.fontWeight).toBe("700");
  });

  it("is tracked as the print tracks its credit, 0.08 em, at a name's usual size", () => {
    expect(credit()).toMatch(/letterSpacing: L\.credit\.spacing,/);
    expect(code("src/utils/exportLayout.ts")).toMatch(/spacing: r2\(creditSize \* 0\.08\),/);
    const L = exportLayout(1, "print", PRINT_WIDTH);
    expect(L.credit.spacing / L.credit.size).toBeCloseTo(0.08, 2);
    // In points: the credit's 0.08 em at 14 pt, and within a tenth of a point of it at the 13 and 15 pt most names are set at.
    const { letterSpacing } = nameFace("editorial")!;
    expect(letterSpacing).toBeCloseTo(0.08 * 14, 1);
    for (const size of [13, 14, 15]) expect(Math.abs(letterSpacing - 0.08 * size), `${size} pt`).toBeLessThanOrEqual(0.1);
    // And within a quarter of a point at the few set smaller or larger (a sent photograph's 11 pt, a chip's 12, a sentence's 16).
    for (const size of [11, 12, 16]) expect(Math.abs(letterSpacing - 0.08 * size), `${size} pt`).toBeLessThanOrEqual(0.25);
  });

  it("sets the face, weight, tracking and ink, and never a size: each name keeps its own", () => {
    expect(Object.keys(nameFace("editorial")!)).toEqual(["fontFamily", "fontWeight", "letterSpacing", "color"]);
    expect(nameFace("editorial")!.fontWeight).toBe("700");
    expect(nameFace("editorial")).not.toHaveProperty("fontSize");
    expect(nameFace("editorial")).not.toHaveProperty("lineHeight");
  });

  it("follows the layout chosen in Settings, the moment it changes", () => {
    expect(useNameFace()).toBeUndefined();
    setFeedLayout("editorial");
    expect(useNameFace()).toEqual(EDITORIAL);
    setFeedLayout("original");
    expect(useNameFace()).toBeUndefined();
  });

  it("is read from the one layout preference, and nowhere else", () => {
    const source = readFileSync(path.join(root, "src/utils/nameFace.ts"), "utf8");
    // react-native only for the ink's type; the ink itself is the theme's.
    expect(source.match(/from "[^"]+"/g)).toEqual(['from "react-native"', 'from "@/theme"', 'from "@/utils/feedLayout"']);
    expect(code("src/utils/nameFace.ts")).toMatch(/return nameFace\(useFeedLayout\(\)\);/);
  });
});

/** A photograph of a member's own, as the Eras view reads one. */
const print = (id: string, taken: string | null, location: string | null = null) => ({
  id,
  taken_at: taken,
  created_at: "2026-09-01T12:00:00",
  location,
  media_type: "photo",
  caption: "",
});

/** A member's page with no eras, for each reason it can have none: no photographs, none dated, none sharing an era. */
const NO_ERAS = {
  none: eraSummary([]),
  undated: eraSummary([print("a", null)]),
  scattered: eraSummary([print("a", "2021-07-10T12:00:00", "Bar Pitti")]),
};

describe("a sentence the app writes with a username in it", () => {
  it("is cut where its writer puts the name, so the name alone takes the face", () => {
    for (const [kind, summary] of Object.entries(NO_ERAS)) {
      const words = aroundName((name) => erasEmpty(summary, name)?.body ?? "");
      // The name once, between the words before it and the words after it.
      expect(words, kind).toHaveLength(2);
      // Drawn back together, the sentence is word for word the one written for the member.
      expect(words.join("tomas.lindqvist"), kind).toBe(erasEmpty(summary, "tomas.lindqvist")?.body);
      expect(erasEmpty(summary, "tomas.lindqvist")?.kind, kind).toBe(kind);
    }
  });

  it("is never cut where the same letters fall in the words around the name", () => {
    // A member called "yet": the sentence ends in "yet." too, and that one is not the name.
    const words = aroundName((name) => erasEmpty(NO_ERAS.none, name)?.body ?? "");
    expect(words).toEqual(["", " hasn’t posted a photograph yet."]);
    expect(words.join("yet")).toBe(erasEmpty(NO_ERAS.none, "yet")?.body);
  });

  it("is the sentence itself where it has no name in it", () => {
    expect(aroundName(() => "Eras gather the photographs you post.")).toEqual(["Eras gather the photographs you post."]);
  });
});

describe("a bar titled with a username", () => {
  it("keeps the stack's own title size, and sets the name as the print's credit: face, weight, tracking and ink", () => {
    // The stack's title, as app/_layout.tsx sets it for every screen; its colour is the bar's tint.
    expect(code("app/_layout.tsx")).toMatch(/headerTitleStyle: \{ fontFamily: type\.serif, fontSize: 17 \},/);
    expect(code("app/_layout.tsx")).toMatch(/headerTintColor: colors\.ink as unknown as string,/);
    expect(nameTitleStyle("original")).toEqual({ fontFamily: type.serif, fontSize: 17 });
    expect(nameTitleStyle("editorial")).toEqual({
      fontFamily: type.mono,
      fontSize: 17,
      fontWeight: "700",
      letterSpacing: 1.36,
      color: NAME_INK,
    });
    // The credit's 0.08 em at the title's 17 pt, and the names' own ink.
    expect(nameTitleStyle("editorial").letterSpacing).toBeCloseTo(0.08 * 17, 5);
    expect(nameTitleStyle("editorial").color).toBe(nameFace("editorial")!.color);
    // The stack's size kept; the face, its weight, its tracking and its ink added.
    expect(Object.keys(nameTitleStyle("editorial"))).toEqual([...Object.keys(nameTitleStyle("original")), "fontWeight", "letterSpacing", "color"]);
  });

  it("is given its ink as the title's own colour, which the stack takes over the bar's tint", () => {
    // Under Original the title has no colour of its own and is the bar's tint, as before.
    expect(nameTitleStyle("original")).not.toHaveProperty("color");
    // The stack draws a title in its style's colour when it has one, else in the tint: on iOS as the native title's colour.
    const stack = readFileSync(path.join(root, "node_modules/@react-navigation/native-stack/src/views/useHeaderConfigProps.tsx"), "utf8");
    expect(stack).toMatch(/const titleColor =\s*'color' in headerTitleStyleFlattened\s*\? headerTitleStyleFlattened\.color/);
    expect(stack).toMatch(/\n {4}titleColor,\n/);
  });

  it("follows the layout, and keeps the serif where the title is not a name", () => {
    expect(useNameTitleStyle()).toEqual({ fontFamily: type.serif, fontSize: 17 });
    setFeedLayout("editorial");
    expect(useNameTitleStyle()).toEqual({ fontFamily: type.mono, fontSize: 17, fontWeight: "700", letterSpacing: 1.36, color: NAME_INK });
    expect(useNameTitleStyle(false)).toEqual({ fontFamily: type.serif, fontSize: 17 });
    setFeedLayout("original");
    expect(useNameTitleStyle()).toEqual({ fontFamily: type.serif, fontSize: 17 });
  });

  it("leaves the stack's own title style as it was", () => {
    expect(code("app/_layout.tsx")).not.toMatch(/nameFace|type\.mono/);
  });
});

/** Every place a username is drawn under Editorial, and how it takes the face. */
const SITES: [file: string, what: string, pattern: RegExp][] = [
  ["app/(tabs)/_layout.tsx", "the profile tab's title, the member's username", /<Text style=\{\[styles\.headerTitle, tab === "profile" && username \? face : undefined\]\}>\{title\}<\/Text>/],
  ["app/(tabs)/activity.tsx", "who did it, without the space after it", /<Text style=\{styles\.actor\}>\s*<Text style=\{face\}>\{item\.actor\.username\}<\/Text>\{" "\}\s*<\/Text>/],
  ["app/admin/applications.tsx", "the username asked for", /<Text style=\{\[styles\.username, face\]\}>\{item\.desired_username\}<\/Text>/],
  ["app/admin/reports.tsx", "who reported it", /reported by\{" "\}\s*\{item\.reporter \? <Text style=\{face\}>\{item\.reporter\.username\}<\/Text> : "unknown"\} ·\{" "\}/],
  ["app/blocked.tsx", "each member blocked", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
  ["app/comments.tsx", "the caption's author", /<Text style=\{\[styles\.author, face\]\}>\{post\.author\.username\}<\/Text> \{post\.caption\}/],
  ["app/comments.tsx", "each comment's author", /<Text style=\{\[styles\.author, face\]\}>\{item\.author\.username\}<\/Text> \{item\.body\}/],
  ["app/follows.tsx", "Nobody follows … yet.", /Nobody follows <Text style=\{face\}>\{username\}<\/Text> yet\./],
  ["app/follows.tsx", "… isn't following anyone yet.", /<Text style=\{face\}>\{username\}<\/Text>\s*\{" isn't following anyone yet\."\}/],
  ["app/compose.tsx", "who was there",/<Text style=\{\[styles\.tagNames, face\]\} numberOfLines=\{1\}>\s*\{tags\.map\(\(t\) => t\.username\)\.join\(", "\)\}/],
  ["app/gallery.tsx", "its title, when it is the author's username", /const titleStyle = useNameTitleStyle\(!shown\.era\);[\s\S]*?<Stack\.Screen options=\{\{ title: shown\.era \?\? authorQ\.data\?\.username \?\? "", headerStyle: paper as \{ backgroundColor: string \}, headerTitleStyle: titleStyle \}\} \/>/],
  ["app/messages/index.tsx", "who each thread is with, its unread emphasis before the face (Original keeps it)", /<Text style=\{\[styles\.username, unread && styles\.unreadText, face\]\}>\s*\{conversation\.peer\.username\}/],
  ["app/messages/[id].tsx", "the thread's title", /<Stack\.Screen options=\{\{ title: peerQ\.data\?\.username \?\? "", headerTitleStyle: titleStyle \}\} \/>/],
  ["app/messages/[id].tsx", "whose photograph was sent, your own bubble's ink after it", /<Text style=\{\[styles\.sharedCaption, face, mine && styles\.textMine\]\} numberOfLines=\{1\}>\s*\{shared\.author\.username\}/],
  ["app/post/[id].tsx", "the author", /<Text style=\{\[styles\.username, face\]\} numberOfLines=\{1\}>\s*\{post\.author\.username\}/],
  ["app/post/[id].tsx", "who was there, without \" (pending)\" or the commas", /<Text style=\{\[face, t\.status === "pending" && styles\.withPending\]\}>\{t\.member\.username\}<\/Text>\s*\{t\.status === "pending" \? " \(pending\)" : ""\}/],
  ["app/post/[id].tsx", "the caption's author", /<Text style=\{\[styles\.captionAuthor, face\]\}>\{post\.author\.username\}<\/Text> \{post\.caption\}/],
  ["app/post/[id].tsx", "each comment's author", /<Text style=\{\[styles\.captionAuthor, face\]\}>\{c\.author\.username\}<\/Text> \{c\.body\}/],
  ["app/requests.tsx", "each member asking", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
  ["app/share.tsx", "the photograph's author", /<Text style=\{\[styles\.previewAuthor, face\]\}>\{post\?\.author\.username \?\? ""\}<\/Text>/],
  ["app/share.tsx", "each member to send it to", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
  ["app/user/[username].tsx", "the title while the profile loads", /<Stack\.Screen options=\{\{ title: username \?\? "", headerTitleStyle: titleStyle \}\} \/>/],
  ["app/user/[username].tsx", "the title", /<Stack\.Screen options=\{\{ title: profile\.username, gestureEnabled: swipeFree, headerTitleStyle: titleStyle \}\} \/>/],
  ["app/user/[username].tsx", "You blocked …", /<Text style=\{styles\.lockedTitle\}>\s*You blocked <Text style=\{face\}>\{profile\.username\}<\/Text>\s*<\/Text>/],
  ["app/user/[username].tsx", "… has your request", /<Text style=\{face\}>\{profile\.username\}<\/Text>\s*\{" has your request\. You'll see their photographs once they accept\."\}/],
  ["app/user/[username].tsx", "Ask to follow …", /\{"Ask to follow "\}\s*<Text style=\{face\}>\{profile\.username\}<\/Text>\s*\{" to see their photographs\."\}/],
  ["src/components/EraList.tsx", "a member's empty Eras view, the name in its sentence", /const emptyBody =\s*empty && member\s*\? aroundName\(\(name\) => erasEmpty\(summary, name\)\?\.body \?\? ""\)\.map\(\(words, i\) => \(\s*<React\.Fragment key=\{i\}>\s*\{i > 0 \? <Text style=\{face\}>\{member\}<\/Text> : null\}\s*\{words\}\s*<\/React\.Fragment>\s*\)\)\s*: empty\?\.body;[\s\S]*?<EmptyState title=\{empty\.title\} body=\{emptyBody\} \/>/],
  ["src/components/UserRow.tsx", "every list of members: Search, Recent, Followers, Likes and the admin's Members", /<Text style=\{\[styles\.username, face\]\}>\{username\}<\/Text>/],
  ["src/components/PendingPostCard.tsx", "the author", /<Text style=\{\[styles\.username, face\]\} numberOfLines=\{1\}>\s*\{draft\.author\.username\}/],
  ["src/components/PendingPostCard.tsx", "the caption's author", /<Text style=\{\[styles\.captionAuthor, face\]\}>\{draft\.author\.username\}<\/Text> \{draft\.caption\.trim\(\)\}/],
  ["src/components/ProfileHeader.tsx", "the name, only where it falls back to the username", /<Text style=\{\[styles\.name, profile\.full_name == null \? face : undefined\]\}>\{profile\.full_name \?\? profile\.username\}<\/Text>/],
  ["src/components/TagPicker.tsx", "each member chosen", /<Text style=\{\[styles\.chipText, face\]\}>\{p\.username\}<\/Text>/],
  ["src/components/TagPicker.tsx", "each member to choose", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
];

/** The files that read the module, and what each reads from it. */
const READERS: Record<string, string> = {
  "app/(tabs)/_layout.tsx": "useNameFace",
  "app/(tabs)/activity.tsx": "useNameFace",
  "app/admin/applications.tsx": "useNameFace",
  "app/admin/reports.tsx": "useNameFace",
  "app/blocked.tsx": "useNameFace",
  "app/comments.tsx": "useNameFace",
  "app/compose.tsx": "useNameFace",
  "app/follows.tsx": "useNameFace",
  "app/gallery.tsx": "useNameTitleStyle",
  "app/messages/[id].tsx": "useNameFace, useNameTitleStyle",
  "app/messages/index.tsx": "useNameFace",
  "app/post/[id].tsx": "useNameFace",
  "app/requests.tsx": "useNameFace",
  "app/share.tsx": "useNameFace",
  "app/user/[username].tsx": "useNameFace, useNameTitleStyle",
  "src/components/EraList.tsx": "aroundName, useNameFace",
  "src/components/PendingPostCard.tsx": "useNameFace",
  "src/components/ProfileHeader.tsx": "useNameFace",
  "src/components/TagPicker.tsx": "useNameFace",
  "src/components/UserRow.tsx": "useNameFace",
  // The print card sets its names in its own sheet, in the names' ink.
  "src/components/feed/EditorialPostCard.tsx": "NAME_INK",
};

describe("every username the app draws", () => {
  for (const [file, what, pattern] of SITES) {
    it(`${file}: ${what}`, () => {
      expect(code(file)).toMatch(pattern);
    });
  }

  it("takes the face from the hook, read once at the top of what draws it", () => {
    // The print card alone sets its names in its own sheet, and reads only their ink.
    for (const file of Object.keys(READERS).filter((f) => f !== "src/components/feed/EditorialPostCard.tsx")) {
      const source = code(file);
      const faces = source.match(/\bface\b/g)?.length ?? 0;
      const titles = source.match(/\btitleStyle\b/g)?.length ?? 0;
      if (faces > 0) expect(source, file).toMatch(/const face = useNameFace\(\);/);
      if (titles > 0) expect(source, file).toMatch(/const titleStyle = useNameTitleStyle\((!shown\.era)?\);/);
      // Read and then used: never read and left.
      expect(faces + titles, file).toBeGreaterThan(1);
    }
  });

  it("on the editorial card is always in the face, set in its sheet, since it is drawn only under Editorial", () => {
    const card = code("src/components/feed/EditorialPostCard.tsx");
    // The print's credit, as the names' face sets it (its values, here as written; tests/editorial-feed.test.ts compares the sheet itself).
    expect(card).toMatch(/\n {2}username: \{ flexShrink: 1, fontFamily: type\.mono, fontSize: 14, fontWeight: "700", letterSpacing: 1\.1, color: NAME_INK \},/);
    expect(card).toMatch(/\n {2}author: \{ fontFamily: type\.mono, fontWeight: "700", letterSpacing: 1\.1, color: NAME_INK \},/);
    expect(nameFace("editorial")).toEqual(EDITORIAL);
    expect(card).toMatch(/<Text style=\{styles\.username\} numberOfLines=\{1\}>\s*\{post\.author\.username\}/);
    expect(card).toMatch(/<Text style=\{styles\.author\}>\{post\.author\.username\}<\/Text> \{post\.caption\}/);
    expect(card).toMatch(/<Text style=\{styles\.author\}>\{c\.author\.username\}<\/Text> \{c\.body\}/);
    // The caption and the comments themselves keep the comments' own type.
    expect(card).toMatch(/\n {2}comment: \{\s*\.\.\.type\.body,\s*fontSize: 14,/);
  });

  it("is none of them left out: a Text that draws a username has the face, or a reason not to", () => {
    // Where a username is drawn without the hook, and why.
    const without: Record<string, RegExp> = {
      // Always Editorial: its sheet sets the face (above).
      "src/components/feed/EditorialPostCard.tsx": /^\{(post|c)\.author\.username\}$/,
      // Drawn only under Original: Home and the gallery draw the editorial card under Editorial.
      "src/components/PostCard.tsx": /^\{(post|c)\.author\.username\}$/,
      // The initial that stands in for a picture, not the name.
      "src/components/Avatar.tsx": /^\{\(username\[0\] \?\? "\?"\)\.toUpperCase\(\)\}$/,
    };
    const drawn: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      const source = code(file);
      // A Text whose words start with a username (or the member whose Eras page it is): its opening tag, then the expression.
      for (const m of source.matchAll(/<Text\b((?:[^>]|=>)*?)>\s*(\{(?:[^{}]*\b(?:desired_)?username\b[^{}]*|member)\})/g)) {
        const [, props, child] = m;
        const site = `${file}: ${child}`;
        drawn.push(site);
        if (/\bface\b/.test(props)) continue;
        expect(without[file], site).toBeDefined();
        expect(child, site).toMatch(without[file]);
      }
    }
    // The scan finds what it is meant to: the Texts above with the face, and the seven without.
    expect(drawn.length).toBeGreaterThanOrEqual(35);
    // Among them the names in an empty list's or an empty Eras page's sentence.
    expect(drawn.filter((site) => /^(app\/follows|src\/components\/EraList)\.tsx: \{(username|member)\}$/.test(site))).toHaveLength(3);
  });

  it("is only ever a username: display names, captions, comments and messages keep their own face", () => {
    let faced = 0;
    for (const file of Object.keys(READERS)) {
      const source = code(file);
      for (const m of source.matchAll(/<Text\b((?:[^>]|=>)*?)>/g)) {
        const [tag, props] = m;
        if (!/\bface\b/.test(props)) continue;
        faced += 1;
        // What the Text holds, up to the next tag: a username, and nothing after it but its closing tag.
        const words = source.slice(m.index + tag.length).split("<")[0].trim();
        const site = `${file}: ${words}`;
        if (file === "app/(tabs)/_layout.tsx") {
          // The bar's title, given the face only when it is the profile tab's username.
          expect(words, site).toBe("{title}");
          expect(props, site).toMatch(/tab === "profile" && username \? face : undefined/);
        } else if (file === "src/components/ProfileHeader.tsx") {
          // A display name, given the face only when it falls back to the username.
          expect(words, site).toBe("{profile.full_name ?? profile.username}");
          expect(props, site).toMatch(/profile\.full_name == null \? face : undefined/);
        } else if (file === "src/components/EraList.tsx") {
          // The member whose Eras page it is, which a member's page gives as their username (below).
          expect(words, site).toBe("{member}");
        } else {
          expect(words, site).toMatch(/^\{[^{}]*\b(?:desired_)?username\b[^{}]*\}$/);
          expect(words, site).not.toMatch(/full_name|caption|\.body|bio|preview/);
        }
      }
    }
    expect(faced).toBe(SITES.filter(([, , p]) => /face/.test(p.source)).length);
  });

  it("titles a bar with a username only in the names' face", () => {
    const titled: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      for (const [, options] of code(file).matchAll(/<Stack\.Screen options=\{\{(.*?)\}\} \/>/g)) {
        if (!/\btitle: [^,]*username/.test(options)) continue;
        titled.push(file);
        expect(options, file).toMatch(/headerTitleStyle: titleStyle/);
      }
    }
    expect(titled.sort()).toEqual(["app/gallery.tsx", "app/messages/[id].tsx", "app/user/[username].tsx", "app/user/[username].tsx"]);
  });

  it("is never written into a sentence the app draws as plain text, where the name could not have a face of its own", () => {
    // A template that writes a username into words, and why each may.
    const written: Record<string, RegExp[]> = {
      // Dialogs, prompts and action sheets: the system draws them, in its own face.
      "app/admin/members.tsx": [
        /^`Invitations for \$\{member\.username\}`$/,
        /^`Warn \$\{member\.username\}`$/,
        /^`Suspend \$\{member\.username\}\?`$/,
        /^`Reinstate \$\{member\.username\}\?`$/,
      ],
      "app/user/[username].tsx": [/^`Block \$\{profile\.username\}\?`$/],
      "src/hooks/usePostActions.ts": [/^`Block \$\{post\.author\.username\}`$/, /^`Block \$\{post\.author\.username\}\?`$/],
      // Spoken by VoiceOver, never drawn.
      "app/(tabs)/search.tsx": [/^`Forget \$\{item\.username\}`$/],
      // The public web page, written on the server: the preference is kept on the phone.
      "src/share/publicPage.ts": [/^`A photograph from \$\{p\.username\}’s archive · VINTAGE`$/],
      // Drawn by EraList, cut at the name (aroundName) so the name alone takes the face: above.
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
  });

  it("in an empty page's sentence is drawn by EmptyState as every sentence is, with no face of its own", () => {
    const empty = code("src/components/EmptyState.tsx");
    // A sentence, or a sentence with a username in its face: the one prop widened, and drawn as before.
    expect(empty).toMatch(/\n {2}body\?: React\.ReactNode;\n/);
    expect(empty).toMatch(/\{body \? <Text style=\{styles\.body\}>\{body\}<\/Text> : null\}/);
    expect(empty).toMatch(/body: \{ \.\.\.type\.caption, textAlign: "center", marginTop: spacing\.sm, color: colors\.inkSoft \},/);
    expect(empty).not.toMatch(/nameFace|type\.mono|\bface\b/);
  });

  it("is the member an Eras page is given: their username, on their page only", () => {
    const given: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      for (const [element] of code(file).matchAll(/<EraList\b[\s\S]*?\/>/g)) {
        const member = element.match(/\bmember=\{([^{}]*)\}/)?.[1];
        if (member) given.push(`${file}: ${member}`);
      }
    }
    expect(given).toEqual(["app/user/[username].tsx: profile.username"]);
    // The Followers and Following lists are given the username of the member whose lists they are.
    for (const file of ["app/user/[username].tsx", "app/(tabs)/profile.tsx"]) {
      expect(code(file), file).toMatch(/pathname: "\/follows",\s*params: \{ userId[^{}]*, kind, username: profile\.username \}/);
    }
  });
});

/** A word of a one-line rule, as the value it stands for here (each colour as the light print's). */
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
 * A Text's style array as written at a site, drawn under a layout with its
 * state on or off, flattened as React Native flattens it: each style over
 * the ones before it, and a state's style only while the state holds.
 */
function drawn(file: string, array: string, layout: "original" | "editorial", state: boolean): Record<string, unknown> {
  const parts = array.replace(/^\[|\]$/g, "").split(/,\s*/);
  return Object.assign(
    {},
    ...parts.map((part) => {
      if (part === "face") return nameFace(layout);
      const plain = part.match(/^styles\.(\w+)$/);
      if (plain) return rule(file, plain[1]);
      const when = part.match(/^.+ && styles\.(\w+)$/);
      if (when) return state ? rule(file, when[1]) : undefined;
      throw new Error(`${file}: not a style: ${part}`);
    }),
  );
}

describe("a state a place marks a name for", () => {
  /** Every style array that holds the face, in every file that reads it. */
  const arrays = () =>
    Object.keys(READERS).flatMap((file) =>
      [...code(file).matchAll(/style=\{(\[[^\]]*\bface\b[^\]]*\])\}/g)].map((m) => [file, m[1]] as const),
    );

  it("comes after the face wherever a name is given both, so the state still wins over the names' ink and weight", () => {
    const found = arrays();
    // Each array listed above among the places a username is drawn.
    expect(found).toHaveLength(21);
    // The one state the face is meant to override: an unread thread, which its dot and preview mark under Editorial.
    const UNREAD = "app/messages/index.tsx: [styles.username, unread && styles.unreadText, face]";
    for (const [file, array] of found) {
      if (`${file}: ${array}` === UNREAD) continue;
      const parts = array.slice(1, -1).split(/,\s*/);
      const at = parts.findIndex((part) => /\bface\b/.test(part));
      // Before the face only the place's own style, never one that depends on a state.
      for (const before of parts.slice(0, at)) expect(before, `${file}: ${array}`).toMatch(/^styles\.\w+$/);
    }
    // The three that a state marks: two with the state after the face, so it wins; the unread thread with it before.
    const marked = found.filter(([, array]) => /&& styles\./.test(array)).map(([file, array]) => `${file}: ${array}`);
    expect(marked).toEqual([
      "app/messages/[id].tsx: [styles.sharedCaption, face, mine && styles.textMine]",
      UNREAD,
      'app/post/[id].tsx: [face, t.status === "pending" && styles.withPending]',
    ]);
  });

  it("an unread thread: marked by its dot and bold preview under Editorial, where every name is dark and bold; by its name under Original", () => {
    const file = "app/messages/index.tsx";
    const array = code(file).match(/<Text style=\{(\[[^\]]*\])\}>\s*\{conversation\.peer\.username\}/)![1];
    expect(rule(file, "unreadText")).toEqual({ color: colors.ink, fontWeight: "600" });
    // The preview under it is marked by the same style.
    expect(code(file)).toMatch(/<Text style=\{\[styles\.preview, unread && styles\.unreadText\]\} numberOfLines=\{1\}>\s*\{preview\}/);
    // Under Editorial the face comes last, so a name is dark and bold whether the thread is read or not: never a read name heavier than an unread one.
    expect(drawn(file, array, "editorial", true)).toEqual({ fontSize: 15, ...EDITORIAL });
    expect(drawn(file, array, "editorial", false)).toEqual({ fontSize: 15, ...EDITORIAL });
    expect(code(file)).toMatch(/\{unread \? <View style=\{styles\.dot\} \/> : null\}/);
    // Under Original exactly as before the trial.
    expect(drawn(file, array, "original", true)).toEqual({ fontSize: 15, color: colors.ink, fontWeight: "600" });
    expect(drawn(file, array, "original", false)).toEqual({ fontSize: 15, color: colors.ink });
  });

  it("a photograph sent in your own bubble: its author's name in the bubble's light ink on its dark paper, still in the face", () => {
    const file = "app/messages/[id].tsx";
    const array = code(file).match(/<Text style=\{(\[[^\]]*\])\} numberOfLines=\{1\}>\s*\{shared\.author\.username\}/)![1];
    expect(rule(file, "bubbleMine")).toEqual({ backgroundColor: colors.shutter, borderColor: colors.shutter });
    expect(rule(file, "textMine")).toEqual({ color: colors.onShutter });
    const face = { fontFamily: type.mono, fontWeight: "700", letterSpacing: 1.1 };
    expect(drawn(file, array, "editorial", true)).toEqual({ fontSize: 11, marginTop: 4, ...face, color: colors.onShutter });
    // In their bubble, on the raised paper, the names' own ink.
    expect(drawn(file, array, "editorial", false)).toEqual({ fontSize: 11, marginTop: 4, ...face, color: NAME_INK });
    // Under Original exactly as before the trial.
    expect(drawn(file, array, "original", true)).toEqual({ fontSize: 11, marginTop: 4, color: colors.onShutter });
    expect(drawn(file, array, "original", false)).toEqual({ fontSize: 11, marginTop: 4, color: colors.inkFaint });
  });

  it("a member tagged who has not yet accepted: faint and regular, as the state sets it, with \"(pending)\" after", () => {
    const file = "app/post/[id].tsx";
    const source = code(file);
    // The state is on the words around the name, and again on the name after the face, so it wins over the face.
    const array = source.match(/style=\{(\[styles\.withName, [^\]]*\])\}/)![1];
    expect(array).toBe('[styles.withName, t.status === "pending" && styles.withPending]');
    const own = '[face, t.status === "pending" && styles.withPending]';
    expect(source).toMatch(/<Text style=\{\[face, t\.status === "pending" && styles\.withPending\]\}>\{t\.member\.username\}<\/Text>\s*\{t\.status === "pending" \? " \(pending\)" : ""\}/);
    const pending = rule(file, "withPending");
    expect(pending).toEqual({ fontWeight: "400", color: colors.inkFaint });
    // The name draws over the words around it.
    const name = (layout: "original" | "editorial", state: boolean) => ({ ...drawn(file, array, layout, state), ...drawn(file, own, layout, state) });
    // Under Editorial: a pending name faint and regular, as the state sets it, still in the face and its tracking; an accepted one in the names' bold ink.
    expect(name("editorial", true)).toEqual({ fontFamily: type.mono, letterSpacing: 1.1, color: pending.color, fontWeight: pending.fontWeight });
    expect(name("editorial", false)).toEqual(EDITORIAL);
    // Under Original exactly as before the trial: an accepted name dark and bold, a pending one faint and regular.
    expect(name("original", false)).toEqual({ fontWeight: "600", color: colors.ink });
    expect(name("original", true)).toEqual(pending);
  });
});

describe("the trial still comes out cleanly", () => {
  it("is read by exactly these files, and by nothing else", () => {
    const readers = sources().filter((rel) => /from "@\/utils\/nameFace"/.test(code(rel)));
    expect(readers.sort()).toEqual(Object.keys(READERS).sort());
    for (const [file, names] of Object.entries(READERS)) {
      expect(code(file), file).toMatch(new RegExp(`import \\{ ${names} \\} from "@/utils/nameFace";`));
    }
  });

  it("is listed, with every file it touches, where the page says how to take the trial out", () => {
    const page = readFileSync(path.join(root, "EDITORIAL_FEED_PREVIEW.md"), "utf8");
    // EmptyState reads nothing of it, but takes the sentence with the name in it for it.
    const touched = [...Object.keys(READERS), "src/components/EmptyState.tsx"];
    // The editorial card is the trial's own file, removed whole rather than checked out.
    const restored = touched.filter((f) => f !== "src/components/feed/EditorialPostCard.tsx");
    for (const file of ["src/utils/nameFace.ts", "tests/editorial-names.test.ts", ...touched]) {
      expect(page, file).toContain(file);
    }
    const out = page.slice(page.indexOf("## Taking it out of a branch that has it"));
    expect(out).toMatch(/git rm [^\n]*src\/utils\/nameFace\.ts/);
    expect(out).toMatch(/git rm [^\n]*tests\/editorial-names\.test\.ts/);
    // Every file it touches goes back to claude/product-polish's own; the editorial card is removed whole.
    const checkout = out.match(/git checkout claude\/product-polish -- [^\n]*/)?.[0] ?? "";
    for (const file of restored) {
      expect(checkout, file).toContain(/[([]/.test(file) ? `"${file}"` : ` ${file}`);
    }
    expect(out).toMatch(/git rm [^\n]*src\/components\/feed\/EditorialPostCard\.tsx/);
    expect(out).toContain("-e nameFace");
  });
});
