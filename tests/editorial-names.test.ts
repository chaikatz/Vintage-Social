import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Editorial (Preview): members' usernames, half bold.
 *
 * While the feed is Editorial every username the app draws as a name is
 * drawn as it is under Original, in the app's own face, size, colour and
 * spacing, but half bold (medium, 500): a step above the words around it
 * and a step below Original's semibold. Where a place marks a name for a
 * state of its own, the state still wins: an unread thread's name is
 * semibold, a step above the rest. A bar titled with a username, bold on the phone because the
 * stack lays its title over the system's bold, is the same serif, regular.
 * Under Original nothing changes at all.
 * First the module that says so, then the bars, then, read from the source,
 * every place that draws a username, so that none is dropped and none is
 * added without it, and every state that still wins over it. Last, which
 * files may read the module, so the trial still comes out cleanly.
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

const nameFaceModule = await import("@/utils/nameFace");
const { nameFace, nameTitleStyle, useNameFace, useNameTitleStyle } = nameFaceModule;
const { setFeedLayout, __resetFeedLayoutForTest } = await import("@/utils/feedLayout");
const { colors, type } = await import("@/theme");
/** A name under Editorial: medium, and nothing else of its own. */
const EDITORIAL = { fontWeight: "500" };

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
  it("is medium (half bold) under Editorial, and nothing at all under Original", () => {
    expect(nameFace("editorial")).toEqual(EDITORIAL);
    // Nothing, not an empty style: a style array is exactly what it was.
    expect(nameFace("original")).toBeUndefined();
    // The same object each time, so nothing redraws for it alone.
    expect(nameFace("editorial")).toBe(nameFace("editorial"));
  });

  it("is the weight alone: a name keeps the app's own face, size, colour and spacing", () => {
    expect(Object.keys(nameFace("editorial")!)).toEqual(["fontWeight"]);
    for (const own of ["fontFamily", "fontSize", "lineHeight", "letterSpacing", "color", "textTransform"]) {
      expect(nameFace("editorial"), own).not.toHaveProperty(own);
    }
    // Nor does the module set tracking or a colour anywhere, or name the typewriter face; its one family is the stack's serif, for a bar's title (below).
    const source = code("src/utils/nameFace.ts");
    expect(source).not.toMatch(/letterSpacing|color|colors\.|type\.mono|Courier/);
    expect(source.match(/fontFamily: [^,;}]+/g)).toEqual(["fontFamily: string", "fontFamily: type.serif", "fontFamily: type.serif"]);
  });

  it("follows the layout chosen in Settings, the moment it changes", () => {
    expect(useNameFace()).toBeUndefined();
    setFeedLayout("editorial");
    expect(useNameFace()).toEqual(EDITORIAL);
    setFeedLayout("original");
    expect(useNameFace()).toBeUndefined();
  });

  it("is read from the one layout preference, and nowhere else; the theme only for the stack's serif", () => {
    const source = readFileSync(path.join(root, "src/utils/nameFace.ts"), "utf8");
    expect(source.match(/from "[^"]+"/g)).toEqual(['from "@/theme"', 'from "@/utils/feedLayout"']);
    expect(source).toMatch(/^import \{ type \} from "@\/theme";$/m);
    expect(code("src/utils/nameFace.ts")).toMatch(/return nameFace\(useFeedLayout\(\)\);/);
    expect(code("src/utils/nameFace.ts")).toMatch(/const layout = useFeedLayout\(\);\s*return nameTitleStyle\(isName \? layout : "original"\);/);
  });

  it("is all the module gives: the face and a username's title style, no ink, nothing to cut a sentence with", () => {
    expect(Object.keys(nameFaceModule).sort()).toEqual(["nameFace", "nameTitleStyle", "useNameFace", "useNameTitleStyle"]);
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

/** The screens titled with a username, and how each takes the title style. */
const TITLE_READERS: Record<string, RegExp> = {
  // An era's gallery is titled with the era, which keeps the stack's own.
  "app/gallery.tsx": /const titleStyle = useNameTitleStyle\(!shown\.era\);/,
  "app/messages/[id].tsx": /const titleStyle = useNameTitleStyle\(\);/,
  "app/user/[username].tsx": /const titleStyle = useNameTitleStyle\(\);/,
};

describe("a bar titled with a username", () => {
  it("is laid by the stack over its own title face, bold on the phone, which the app's serif does not replace", () => {
    // The app's title style: a family and a size, no weight of its own.
    expect(stackTitleStyle()).toEqual({ fontFamily: type.serif, fontSize: 17 });
    expect(code("app/_layout.tsx")).toMatch(/headerTintColor: colors\.ink as unknown as string,/);
    expect(code("app/_layout.tsx")).not.toMatch(/nameFace|fontWeight/);
    // Laid over the system's bold on iOS (its medium elsewhere), so the weight under it stands: the serif's bold cut.
    const stack = readFileSync(path.join(root, "node_modules/@react-navigation/native-stack/src/views/useHeaderConfigProps.tsx"), "utf8");
    expect(stack).toMatch(/const headerTitleStyleFlattened =\s*StyleSheet\.flatten\(\[\s*Platform\.select\(\{ ios: fonts\.bold, default: fonts\.medium \}\),\s*headerTitleStyle,\s*\]\)/);
    const fonts = readFileSync(path.join(root, "node_modules/@react-navigation/native/src/theming/fonts.tsx"), "utf8");
    expect(fonts.slice(fonts.indexOf("  ios: {"))).toMatch(/^ {2}ios: \{[\s\S]*?\n {4}bold: \{\s*fontFamily: 'System',\s*fontWeight: '600',\s*\}/);
  });

  it("under Original is the stack's own title style, exactly", () => {
    expect(nameTitleStyle("original")).toEqual(stackTitleStyle());
    expect(Object.keys(nameTitleStyle("original"))).toEqual(Object.keys(stackTitleStyle()));
  });

  it("under Editorial is the same serif at the same size, regular", () => {
    expect(nameTitleStyle("editorial")).toEqual({ ...stackTitleStyle(), fontWeight: "400" });
    expect(Object.keys(nameTitleStyle("editorial"))).toEqual([...Object.keys(stackTitleStyle()), "fontWeight"]);
    // Regular, not the names' medium: the serif has no medium cut, and the phone would match 500 to its bold.
    expect(nameFace("editorial")!.fontWeight).toBe("500");
    expect(nameTitleStyle("editorial").fontWeight).toBe("400");
    // The same object each time, so nothing redraws for it alone.
    expect(nameTitleStyle("editorial")).toBe(nameTitleStyle("editorial"));
    expect(nameTitleStyle("original")).toBe(nameTitleStyle("original"));
  });

  it("follows the layout, and keeps the stack's own where the title is not a name", () => {
    expect(useNameTitleStyle()).toEqual(stackTitleStyle());
    setFeedLayout("editorial");
    expect(useNameTitleStyle()).toEqual({ fontFamily: type.serif, fontSize: 17, fontWeight: "400" });
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
      for (const [, options] of code(file).matchAll(/<Stack\.Screen options=\{\{(.*?)\}\} \/>/g)) {
        if (!/\btitle: [^,]*username/.test(options)) continue;
        titled.push(file);
        // The style itself, never undefined, at the end of the options.
        expect(options, file).toMatch(/, headerTitleStyle: titleStyle $/);
      }
    }
    // The scan finds what it is meant to: a member's profile (while it loads and once it has), their gallery, a message thread.
    expect(titled.sort()).toEqual(["app/gallery.tsx", "app/messages/[id].tsx", "app/user/[username].tsx", "app/user/[username].tsx"]);
    for (const [file, hook] of Object.entries(TITLE_READERS)) {
      expect(code(file).match(/const titleStyle = useNameTitleStyle\([^)]*\);/g), file).toHaveLength(1);
      expect(code(file), file).toMatch(hook);
      expect(code(file).match(/\btitleStyle\b/g)?.length, file).toBe(file === "app/user/[username].tsx" ? 3 : 2);
    }
    // No other screen sets a title style of its own.
    expect(sources().filter((f) => f !== "app/_layout.tsx" && /headerTitleStyle/.test(code(f))).sort()).toEqual(Object.keys(TITLE_READERS).sort());
  });

  it("on the Profile tab, which the app draws itself, is the serif at the stack's size, regular, as it always was", () => {
    const tabs = code("app/(tabs)/_layout.tsx");
    expect(tabs).toMatch(/<Text style=\{styles\.headerTitle\}>\{title\}<\/Text>/);
    expect(tabs).toMatch(/\n {2}headerTitle: \{ fontFamily: type\.serif, fontSize: 17, color: colors\.ink \},/);
    expect(tabs).not.toMatch(/nameFace|\bface\b/);
  });
});

/** Every place a username is drawn under Editorial, and how it takes the face. */
const SITES: [file: string, what: string, pattern: RegExp][] = [
  ["app/(tabs)/activity.tsx", "who did it", /<Text style=\{\[styles\.actor, face\]\}>\{item\.actor\.username\} <\/Text>/],
  ["app/admin/applications.tsx", "the username asked for", /<Text style=\{\[styles\.username, face\]\}>\{item\.desired_username\}<\/Text>/],
  ["app/blocked.tsx", "each member blocked", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
  ["app/comments.tsx", "the caption's author", /<Text style=\{\[styles\.author, face\]\}>\{post\.author\.username\}<\/Text> \{post\.caption\}/],
  ["app/comments.tsx", "each comment's author", /<Text style=\{\[styles\.author, face\]\}>\{comment\.author\.username\}<\/Text> \{comment\.body\}/],
  ["app/compose.tsx", "who was there", /<Text style=\{\[styles\.tagNames, face\]\} numberOfLines=\{1\}>\s*\{tags\.map\(\(t\) => t\.username\)\.join\(", "\)\}/],
  ["app/messages/index.tsx", "who each thread is with, an unread thread's style after the face", /<Text style=\{\[styles\.username, face, unread && styles\.unreadText\]\}>\s*\{conversation\.peer\.username\}/],
  ["app/messages/[id].tsx", "whose photograph was sent, your own bubble's ink after it", /<Text style=\{\[styles\.sharedCaption, face, mine && styles\.textMine\]\} numberOfLines=\{1\}>\s*\{shared\.author\.username\}/],
  ["app/post/[id].tsx", "the author", /<Text style=\{\[styles\.username, face\]\} numberOfLines=\{1\}>\s*\{post\.author\.username\}/],
  [
    "app/post/[id].tsx",
    "who was there, a pending tag's style after the face",
    /style=\{\[styles\.withName, face, t\.status === "pending" && styles\.withPending\]\}\s*onPress=\{\(\) => router\.push\(`\/user\/\$\{t\.member\.username\}`\)\}\s*>\s*\{t\.member\.username\}\s*\{t\.status === "pending" \? " \(pending\)" : ""\}/,
  ],
  ["app/post/[id].tsx", "each comment's author", /<Text style=\{\[styles\.captionAuthor, face\]\}>\{c\.author\.username\}<\/Text> \{c\.body\}/],
  ["app/requests.tsx", "each member asking", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
  ["app/share.tsx", "the photograph's author", /<Text style=\{\[styles\.previewAuthor, face\]\}>\{post\?\.author\?\.username \?\? ""\}<\/Text>/],
  ["app/share.tsx", "each member to send it to", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
  ["src/components/UserRow.tsx", "every list of members: Search, Recent, Followers, Likes and the admin's Members", /<Text style=\{\[styles\.username, face\]\}>\{username\}<\/Text>/],
  ["src/components/PendingPostCard.tsx", "the author", /<Text style=\{\[styles\.username, face\]\} numberOfLines=\{1\}>\s*\{draft\.author\.username\}/],
  ["src/components/PendingPostCard.tsx", "the caption's author", /<Text style=\{\[styles\.captionAuthor, face\]\}>\{draft\.author\.username\}<\/Text> \{draft\.caption\.trim\(\)\}/],
  ["src/components/ProfileHeader.tsx", "the name, only where it falls back to the username", /<Text style=\{\[styles\.name, profile\.full_name == null \? face : undefined\]\}>\{profile\.full_name \?\? profile\.username\}<\/Text>/],
  ["src/components/TagPicker.tsx", "each member chosen", /<Text style=\{\[styles\.chipText, face\]\}>\{p\.username\}<\/Text>/],
  ["src/components/TagPicker.tsx", "each member to choose", /<Text style=\{\[styles\.username, face\]\}>\{item\.username\}<\/Text>/],
];

/** The files that read the names' face: each reads its hook, once. */
const READERS = [
  "app/(tabs)/activity.tsx",
  "app/admin/applications.tsx",
  "app/blocked.tsx",
  "app/comments.tsx",
  "app/compose.tsx",
  "app/messages/[id].tsx",
  "app/messages/index.tsx",
  "app/post/[id].tsx",
  "app/requests.tsx",
  "app/share.tsx",
  "src/components/PendingPostCard.tsx",
  "src/components/ProfileHeader.tsx",
  "src/components/TagPicker.tsx",
  "src/components/UserRow.tsx",
];

describe("every username the app draws", () => {
  for (const [file, what, pattern] of SITES) {
    it(`${file}: ${what}`, () => {
      expect(code(file)).toMatch(pattern);
    });
  }

  it("takes the face from the hook, read once at the top of what draws it, and then used", () => {
    for (const file of READERS) {
      const source = code(file);
      expect(source.match(/const face = useNameFace\(\);/g), file).toHaveLength(1);
      // Read and then used: never read and left.
      expect(source.match(/\bface\b/g)?.length ?? 0, file).toBeGreaterThan(1);
    }
  });

  it("on the editorial card is the original card's name, half bold, set in its sheet, since it is drawn only under Editorial", () => {
    const card = code("src/components/feed/EditorialPostCard.tsx");
    const original = code("src/components/PostCard.tsx");
    expect(card).toMatch(/\n {2}username: \{ flexShrink: 1, fontSize: 14, fontWeight: "500", color: colors\.ink \},/);
    expect(card).toMatch(/\n {2}author: \{ fontWeight: "500" \},/);
    // The original card's own, but for the weight.
    expect(original).toMatch(/\n {2}username: \{ fontSize: 14, fontWeight: "600", color: colors\.ink \},/);
    expect(original).toMatch(/\n {2}captionAuthor: \{ fontWeight: "600" \},/);
    // Its own face, size and ink: neither the typewriter face nor tracking on a name, and the module not read.
    expect(card).not.toMatch(/nameFace|NAME_INK/);
    for (const name of ["username", "author"]) {
      expect(card.match(new RegExp(`\\n {2}${name}: \\{ [^\\n]* \\},`))?.[0], name).not.toMatch(/fontFamily|letterSpacing|type\.mono/);
    }
    expect(card).toMatch(/<Text style=\{styles\.username\} numberOfLines=\{1\}>\s*\{post\.author\.username\}/);
    expect(card).toMatch(/<Text style=\{styles\.author\}>\{post\.author\.username\}<\/Text> \{post\.caption\}/);
    expect(card).toMatch(/<Text style=\{styles\.author\}>\{c\.author\.username\}<\/Text> \{c\.body\}/);
    // The caption and the comments themselves keep the comments' own type.
    expect(card).toMatch(/\n {2}comment: \{\s*\.\.\.type\.body,\s*fontSize: 14,/);
  });

  it("is none of them left out: a Text that draws a username has the face, or a reason not to", () => {
    // Where a username is drawn without the hook, and why.
    const without: Record<string, RegExp> = {
      // Always Editorial: its sheet sets the name medium (above).
      "src/components/feed/EditorialPostCard.tsx": /^\{(post|c)\.author\.username\}$/,
      // Drawn only under Original: Home and the gallery draw the editorial card under Editorial.
      "src/components/PostCard.tsx": /^\{(post|c)\.author\.username\}$/,
      // The initial that stands in for a picture, not the name.
      "src/components/Avatar.tsx": /^\{\(username\[0\] \?\? "\?"\)\.toUpperCase\(\)\}$/,
      // A post's own page: the caption's author, in the caption's serif, which has no half bold (see below).
      "app/post/[id].tsx": /^\{post\.author\.username\}$/,
      // An admin's report line: who wrote the reported comment, then its words. The page's names stay regular, as in its sentences (below).
      "app/admin/reports.tsx": /^\{item\.comment\.author\?\.username \?\? "unknown"\}$/,
    };
    const drawn: string[] = [];
    for (const file of sources().filter((f) => f.endsWith(".tsx"))) {
      const source = code(file);
      // A Text whose words start with a username: its opening tag, then the expression.
      for (const m of source.matchAll(/<Text\b((?:=>|[^>])*?)>\s*(\{[^{}]*\b(?:desired_)?username\b[^{}]*\})/g)) {
        const [, props, child] = m;
        const site = `${file}: ${child}`;
        drawn.push(site);
        if (/\bface\b/.test(props)) continue;
        expect(without[file], site).toBeDefined();
        expect(child, site).toMatch(without[file]);
      }
    }
    // The scan finds what it is meant to: the Texts above with the face, and the seven without.
    expect(drawn.length).toBeGreaterThanOrEqual(SITES.length + 7);
  });

  it("is only ever a username: display names, captions, comments and messages keep their own weight", () => {
    let faced = 0;
    for (const file of READERS) {
      const source = code(file);
      for (const m of source.matchAll(/<Text\b((?:=>|[^>])*?)>/g)) {
        const [tag, props] = m;
        if (!/\bface\b/.test(props)) continue;
        faced += 1;
        // What the Text holds, up to its closing tag.
        const words = source.slice(m.index + tag.length).split("</Text>")[0].trim();
        const site = `${file}: ${words}`;
        if (file === "src/components/ProfileHeader.tsx") {
          // A display name, given the face only when it falls back to the username.
          expect(words, site).toBe("{profile.full_name ?? profile.username}");
          expect(props, site).toMatch(/profile\.full_name == null \? face : undefined/);
        } else if (file === "app/post/[id].tsx" && /withName/.test(props)) {
          // A member tagged: their username, then "(pending)" while they have not accepted, then the comma before the next.
          expect(words.split(/\s*\n\s*/), site).toEqual([
            "{t.member.username}",
            '{t.status === "pending" ? " (pending)" : ""}',
            '{i < shownTags.length - 1 ? ", " : ""}',
          ]);
        } else {
          // A username alone; the space after who did it in Activity aside.
          expect(words, site).toMatch(/^\{[^{}]*\b(?:desired_)?username\b[^{}]*\}$/);
          expect(words, site).not.toMatch(/full_name|caption|\.body|bio|preview/);
        }
      }
    }
    expect(faced).toBe(SITES.length);
  });

  it("in a sentence is drawn as the sentence is, regular already, so the sentence is left as it was", () => {
    // A template that writes a username into words, and why each needs nothing.
    const written: Record<string, RegExp[]> = {
      // Dialogs, prompts and action sheets: the system draws them, in its own face.
      "app/admin/members.tsx": [
        /^`Invitations for \$\{member\.username\}`$/,
        /^`Warn \$\{member\.username\}`$/,
        /^`Suspend \$\{member\.username\}\?`$/,
        /^`Reinstate \$\{member\.username\}\?`$/,
      ],
      // Spoken by VoiceOver, never drawn.
      "app/(tabs)/search.tsx": [/^`Forget \$\{item\.username\}`$/],
      "app/blocked.tsx": [/^`Unblock \$\{item\.username\}`$/],
      "app/requests.tsx": [/^`Accept \$\{item\.username\}`$/, /^`Decline \$\{item\.username\}`$/],
      // The public web page, written on the server: the preference is kept on the phone.
      "src/share/publicPage.ts": [/^`A photograph from \$\{p\.username\}’s archive · VINTAGE`$/],
      // A private profile's line, in its regular caption (below), and the Block dialog.
      "app/user/[username].tsx": [
        /^`Block \$\{profile\.username\}\?`$/,
        /^`\$\{profile\.username\} has your request\. You'll see their photographs once they accept\.`$/,
        /^`Ask to follow \$\{profile\.username\} to see their photographs\.`$/,
      ],
      // An empty Followers or Following list's sentence, in EmptyState's regular body (below).
      "app/follows.tsx": [/^`Nobody follows \$\{username\} yet\.`$/, /^`\$\{username\} isn't following anyone yet\.`$/],
      // A member's empty Eras page, in EmptyState's regular body too.
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
    // The sentences the app draws itself are set regular, so a name in one is never bold under either layout.
    const regular = (file: string, name: string) => {
      const rule = code(file).match(new RegExp(`\\n {2}${name}: \\{ ([^\\n]*) \\},`))?.[1];
      expect(rule, `${file}: ${name}`).toBeDefined();
      expect(rule, `${file}: ${name}`).not.toMatch(/fontWeight/);
    };
    regular("src/components/EmptyState.tsx", "body");
    regular("app/user/[username].tsx", "lockedTitle");
    regular("app/user/[username].tsx", "lockedBody");
    regular("app/admin/reports.tsx", "headline");
    for (const base of [type.caption, type.body, type.title]) expect(base).not.toHaveProperty("fontWeight");
    // And drawn as they always were: the sentence a string, and the name in it no Text of its own.
    expect(code("src/components/EmptyState.tsx")).toMatch(/\n {2}body\?: string;\n/);
    expect(code("app/user/[username].tsx")).toMatch(/<Text style=\{styles\.lockedTitle\}>You blocked \{profile\.username\}<\/Text>/);
    expect(code("app/admin/reports.tsx")).toMatch(/\{item\.target_type\} · reported by \{item\.reporter\?\.username \?\? "unknown"\} ·\{" "\}/);
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
 * A Text's style array as written at a site, drawn under a layout with its
 * state on or off, flattened as React Native flattens it: each style over
 * the ones before it, and a state's style only while the state holds.
 * "before" is the array as claude/product-polish writes it: without the face.
 */
function drawn(file: string, array: string, layout: "original" | "editorial" | "before", state: boolean): Record<string, unknown> {
  const parts = array.replace(/^\[|\]$/g, "").split(/,\s*/);
  const face = layout === "before" ? undefined : nameFace(layout);
  return Object.assign(
    {},
    ...parts.map((part) => {
      if (part === "face") return face;
      if (/^.+ \? face : undefined$/.test(part)) return state ? face : undefined;
      const plain = part.match(/^styles\.(\w+)$/);
      if (plain) return rule(file, plain[1]);
      const when = part.match(/^.+ && styles\.(\w+)$/);
      if (when) return state ? rule(file, when[1]) : undefined;
      throw new Error(`${file}: not a style: ${part}`);
    }),
  );
}

/** Every style array that holds the face, in every file that reads it. */
const arrays = () =>
  READERS.flatMap((file) => [...code(file).matchAll(/style=\{(\[[^\]]*\bface\b[^\]]*\])\}/g)].map((m) => [file, m[1]] as const));

describe("a name under each layout", () => {
  it("is never given to a name inside words set in a face with no half bold, where the phone would draw it bold", () => {
    // A serif or the typewriter has a regular and a bold cut and nothing between, and iOS matches 500 to the bold.
    const block = (file: string, name: string) =>
      code(file).match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\},?\\n`))?.[1] ?? "";
    let nested = 0;
    for (const file of READERS) {
      for (const m of code(file).matchAll(/<Text style=\{styles\.(\w+)\}[^>]*>\s*<Text style=\{\[[^\]]*\bface\b[^\]]*\]\}/g)) {
        nested += 1;
        expect(block(file, m[1]), `${file}: inside styles.${m[1]}`).not.toMatch(/type\.(serif|mono)|fontFamily/);
      }
    }
    expect(nested).toBeGreaterThan(0);
    // The one name left as under Original for that reason: a post's own caption is set in the serif.
    expect(block("app/post/[id].tsx", "caption")).toMatch(/fontFamily: type\.serif/);
    expect(code("app/post/[id].tsx")).toMatch(/<Text style=\{styles\.caption\}>\s*<Text style=\{styles\.captionAuthor\}>\{post\.author\.username\}<\/Text> \{post\.caption\}/);
  });

  it("is found in every style array that holds the face, one for each place above", () => {
    expect(arrays()).toHaveLength(SITES.length);
  });

  it("under Original is exactly as it was before the trial, state or not", () => {
    for (const [file, array] of arrays()) {
      for (const state of [false, true]) {
        expect(drawn(file, array, "original", state), `${file}: ${array} (${state})`).toEqual(drawn(file, array, "before", state));
      }
    }
  });

  it("under Editorial is as under Original but for its weight, which is medium unless a state after the face sets one", () => {
    let unbolded = 0;
    for (const [file, array] of arrays()) {
      for (const state of [false, true]) {
        const site = `${file}: ${array} (${state})`;
        const { fontWeight: was, ...before } = drawn(file, array, "original", state);
        const { fontWeight: now, ...after } = drawn(file, array, "editorial", state);
        // The face, the size, the colour and the spacing: as they were.
        expect(after, site).toEqual(before);
        // The weight: a state's where a state that sets one holds and comes after the face, and medium everywhere else.
        const parts = array.slice(1, -1).split(/,\s*/);
        const afterFace = parts.slice(parts.findIndex((p) => /\bface\b/.test(p)) + 1);
        const stated = afterFace
          .map((p) => p.match(/^.+ && styles\.(\w+)$/)?.[1])
          .filter((name): name is string => name != null)
          .map((name) => rule(file, name).fontWeight)
          .find((weight) => weight != null);
        const faced = !/\? face : undefined/.test(array) || state;
        if (!faced) expect(now, site).toBe(was);
        else if (state && stated != null) expect(now, site).toBe(stated);
        else expect(now, site).toBe("500");
        if (faced && (was === "600" || was === "700") && now === "500") unbolded += 1;
      }
    }
    // It does something: the names semibold under Original that Editorial sets at half that.
    expect(unbolded).toBeGreaterThanOrEqual(15);
  });

  it("comes after the place's own style and before any state's, so the state still wins", () => {
    const found = arrays();
    for (const [file, array] of found) {
      const parts = array.slice(1, -1).split(/,\s*/);
      const at = parts.findIndex((part) => /\bface\b/.test(part));
      // Before the face only the place's own style, never one that depends on a state.
      for (const before of parts.slice(0, at)) expect(before, `${file}: ${array}`).toMatch(/^styles\.\w+$/);
    }
    // The three a state marks, each with the state after the face.
    const marked = found.filter(([, array]) => /&& styles\./.test(array)).map(([file, array]) => `${file}: ${array}`);
    expect(marked).toEqual([
      "app/messages/[id].tsx: [styles.sharedCaption, face, mine && styles.textMine]",
      "app/messages/index.tsx: [styles.username, face, unread && styles.unreadText]",
      'app/post/[id].tsx: [styles.withName, face, t.status === "pending" && styles.withPending]',
    ]);
  });
});

describe("a state a place marks a name for", () => {
  it("an unread thread: its name semibold under Editorial, as under Original, a step above a read one's medium", () => {
    const file = "app/messages/index.tsx";
    const array = code(file).match(/<Text style=\{(\[[^\]]*\])\}>\s*\{conversation\.peer\.username\}/)![1];
    expect(rule(file, "unreadText")).toEqual({ color: colors.ink, fontWeight: "600" });
    // The preview under it is marked by the same style, and its dot.
    expect(code(file)).toMatch(/<Text style=\{\[styles\.preview, unread && styles\.unreadText\]\} numberOfLines=\{1\}>\s*\{preview\}/);
    expect(code(file)).toMatch(/\{unread \? <View style=\{styles\.dot\} \/> : null\}/);
    expect(drawn(file, array, "editorial", true)).toEqual({ fontSize: 15, color: colors.ink, fontWeight: "600" });
    expect(drawn(file, array, "editorial", false)).toEqual({ fontSize: 15, color: colors.ink, fontWeight: "500" });
    // Under Original exactly as before the trial.
    expect(drawn(file, array, "original", true)).toEqual({ fontSize: 15, color: colors.ink, fontWeight: "600" });
    expect(drawn(file, array, "original", false)).toEqual({ fontSize: 15, color: colors.ink });
  });

  it("a photograph sent in your own bubble: its author's name in the bubble's light ink on its dark paper", () => {
    const file = "app/messages/[id].tsx";
    const array = code(file).match(/<Text style=\{(\[[^\]]*\])\} numberOfLines=\{1\}>\s*\{shared\.author\.username\}/)![1];
    expect(rule(file, "bubbleMine")).toEqual({ backgroundColor: colors.shutter, borderColor: colors.shutter });
    expect(rule(file, "textMine")).toEqual({ color: colors.onShutter });
    expect(drawn(file, array, "editorial", true)).toEqual({ fontSize: 11, color: colors.onShutter, marginTop: 4, fontWeight: "500" });
    // In their bubble, on the raised paper, its own faint ink.
    expect(drawn(file, array, "editorial", false)).toEqual({ fontSize: 11, color: colors.inkFaint, marginTop: 4, fontWeight: "500" });
    // Under Original exactly as before the trial.
    expect(drawn(file, array, "original", true)).toEqual({ fontSize: 11, marginTop: 4, color: colors.onShutter });
    expect(drawn(file, array, "original", false)).toEqual({ fontSize: 11, marginTop: 4, color: colors.inkFaint });
  });

  it("a member tagged who has not yet accepted: faint and regular, as the state sets it, with \"(pending)\" after", () => {
    const file = "app/post/[id].tsx";
    const array = code(file).match(/style=\{(\[styles\.withName, [^\]]*\])\}/)![1];
    const pending = rule(file, "withPending");
    expect(pending).toEqual({ fontWeight: "400", color: colors.inkFaint });
    // Under Editorial: a pending name faint and regular, as the state sets it; an accepted one in its own dark ink, medium.
    expect(drawn(file, array, "editorial", true)).toEqual(pending);
    expect(drawn(file, array, "editorial", false)).toEqual({ fontWeight: "500", color: colors.ink });
    // Under Original exactly as before the trial: an accepted name dark and bold, a pending one faint and regular.
    expect(drawn(file, array, "original", false)).toEqual({ fontWeight: "600", color: colors.ink });
    expect(drawn(file, array, "original", true)).toEqual(pending);
  });
});

/** Every file that reads the module: a name's face, a username's title, or both. */
const ALL_READERS = [...new Set([...READERS, ...Object.keys(TITLE_READERS)])];

describe("the trial still comes out cleanly", () => {
  it("is read by exactly these files, each reading a hook and nothing else", () => {
    const readers = sources().filter((rel) => /from "@\/utils\/nameFace"/.test(code(rel)));
    expect(readers.sort()).toEqual([...ALL_READERS].sort());
    for (const file of ALL_READERS) {
      const hooks = [READERS.includes(file) && "useNameFace", file in TITLE_READERS && "useNameTitleStyle"].filter(Boolean).join(", ");
      expect(code(file).match(/import \{ ([^}]*) \} from "@\/utils\/nameFace";/)?.[1], file).toBe(hooks);
    }
  });

  it("leaves the places where a name was already regular in a sentence as they were", () => {
    for (const file of ["app/follows.tsx", "app/admin/reports.tsx", "src/components/EraList.tsx", "src/components/EmptyState.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8"), file).not.toMatch(/Editorial|nameFace|useNameTitleStyle|aroundName/);
      expect(code(file), file).not.toMatch(/\bface\b/);
    }
    // A member's profile takes the title style alone: its sentences are as they were (above), and nothing on it takes the face.
    const profile = readFileSync(path.join(root, "app/user/[username].tsx"), "utf8");
    expect(profile).not.toMatch(/useNameFace|aroundName/);
    expect(code("app/user/[username].tsx")).not.toMatch(/\bface\b/);
    expect(profile.match(/Editorial/g)).toHaveLength(1);
  });

  it("is listed, with every file it touches, where the page says how to take the trial out", () => {
    const page = readFileSync(path.join(root, "EDITORIAL_FEED_PREVIEW.md"), "utf8");
    for (const file of ["src/utils/nameFace.ts", "tests/editorial-names.test.ts", ...ALL_READERS]) {
      expect(page, file).toContain(file);
    }
    const out = page.slice(page.indexOf("## Taking it out of a branch that has it"));
    expect(out).toMatch(/git rm [^\n]*src\/utils\/nameFace\.ts/);
    expect(out).toMatch(/git rm [^\n]*tests\/editorial-names\.test\.ts/);
    expect(out).toMatch(/git rm [^\n]*src\/components\/feed\/EditorialPostCard\.tsx/);
    // Exactly the files it touches go back to claude/product-polish's own: no more, no fewer.
    const checkout = out.match(/git checkout claude\/product-polish -- ([^\n]*)/)?.[1] ?? "";
    const named = checkout.split(/\s+/).map((f) => f.replace(/^"|"$/g, ""));
    expect(named.sort()).toEqual(
      [
        ...ALL_READERS,
        "app/(tabs)/index.tsx",
        "app/(tabs)/_layout.tsx",
        "app/settings.tsx",
        "tests/video-playback.test.ts",
        "tests/galleryLanding.test.ts",
        "tests/stableCards.test.ts",
        "e2e/launch-test.mjs",
      ].sort(),
    );
    // A path with brackets or parentheses is quoted, so the shell takes it as it is.
    for (const file of named) if (/[([]/.test(file)) expect(checkout, file).toContain(`"${file}"`);
    expect(out).toContain("-e nameFace");
  });
});
