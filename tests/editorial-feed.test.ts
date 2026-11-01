import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editorial (Preview), the trial layout of Home.
 *
 * The preference first: original unless the phone says otherwise, kept in
 * one small file and nowhere else. Then, read from the source, the lines
 * that keep the experiment a matter of presentation: Home hands either
 * card the very same props from one seam, only Home draws the editorial
 * card, and that card's picture, like and "…" are wired exactly as
 * PostCard's are. And from the card's own sheet, the lengths it comes to
 * on a phone, laid out the way React Native lays them out.
 */

const phone = { files: new Map<string, string>() };
/** Every sheet made as the modules load; the editorial card's is the one with a rule. */
const sheets: Record<string, Record<string, unknown>>[] = [];

vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (choices: { ios?: unknown; default?: unknown }) => choices.ios ?? choices.default },
  DynamicColorIOS: ({ light }: { light: string }) => light,
  StyleSheet: {
    create: <T extends Record<string, Record<string, unknown>>>(sheet: T) => {
      sheets.push(sheet);
      return sheet;
    },
  },
  Pressable: "Pressable",
  Text: "Text",
  View: "View",
  useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
}));
// What the card draws with, stood in for: only its sheet is read here.
vi.mock("expo-haptics", () => ({}));
vi.mock("@expo/vector-icons/Feather", () => ({ default: "Feather" }));
vi.mock("@expo/vector-icons/MaterialCommunityIcons", () => ({ default: "MaterialCommunityIcons" }));
vi.mock("@/components/PostCard", () => ({ INLINE_COMMENTS: 2, PostCard: () => null }));
vi.mock("@/components/PostMedia", () => ({ PostMedia: () => null }));
vi.mock("expo-file-system", () => {
  class Directory {
    constructor(readonly uri: string) {}
  }
  class File {
    readonly path: string;
    constructor(dir: Directory, name: string) {
      this.path = `${dir.uri}/${name}`;
    }
    get exists() {
      return phone.files.has(this.path);
    }
    textSync() {
      const text = phone.files.get(this.path);
      if (text == null) throw new Error("No such file");
      return text;
    }
    create() {
      phone.files.set(this.path, "");
    }
    write(text: string) {
      phone.files.set(this.path, text);
    }
    delete() {
      phone.files.delete(this.path);
    }
  }
  return { File, Paths: { document: new Directory("document"), cache: new Directory("cache") } };
});

const { PRINT_WIDTH, exportLayout } = await import("@/utils/exportLayout");
const {
  FEED_LAYOUTS,
  getFeedLayout,
  parseFeedLayout,
  setFeedLayout,
  __resetFeedLayoutForTest,
  __subscribeForTest,
} = await import("@/utils/feedLayout");
await import("@/components/feed/EditorialPostCard");

const FILE = "document/feed-layout.json";
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

/** Every `<Tag … />` in a file. */
function tags(source: string, tag: string): string[] {
  return source.match(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`, "g")) ?? [];
}

/** One space for every run of white space, so layout alone never fails a comparison. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** The card's own `like`, from `const like =` to the line that closes it. */
const likeOf = (source: string) => /const like = \(next: boolean\) => \{[\s\S]*?\n {2}\};/.exec(source)?.[0] ?? "";

describe("the feed layout preference", () => {
  beforeEach(() => {
    phone.files.clear();
    __resetFeedLayoutForTest();
  });

  it("is the original feed until the member chooses otherwise", () => {
    expect(getFeedLayout()).toBe("original");
    expect(phone.files.has(FILE)).toBe(false);
  });

  it("offers Original first, then Editorial (Preview)", () => {
    expect(FEED_LAYOUTS.map((l) => l.value)).toEqual(["original", "editorial"]);
    expect(FEED_LAYOUTS.map((l) => l.label)).toEqual(["Original", "Editorial (Preview)"]);
  });

  it("is kept on the phone, and read back at the next launch", () => {
    setFeedLayout("editorial");
    expect(phone.files.get(FILE)).toBe(JSON.stringify("editorial"));
    __resetFeedLayoutForTest();
    expect(getFeedLayout()).toBe("editorial");
    setFeedLayout("original");
    __resetFeedLayoutForTest();
    expect(getFeedLayout()).toBe("original");
  });

  it("reads anything it does not know as the original", () => {
    expect(parseFeedLayout("editorial")).toBe("editorial");
    for (const raw of ["original", "Editorial", "magazine", null, undefined, 1, {}]) {
      expect(parseFeedLayout(raw)).toBe("original");
    }
    phone.files.set(FILE, "not json");
    expect(getFeedLayout()).toBe("original");
  });

  it("tells a mounted Home at once, and only when it changes", () => {
    const heard: string[] = [];
    const stop = __subscribeForTest(() => heard.push(getFeedLayout()));
    setFeedLayout("editorial");
    setFeedLayout("editorial");
    setFeedLayout("original");
    stop();
    setFeedLayout("editorial");
    expect(heard).toEqual(["editorial", "original"]);
  });

  it("asks nothing of the server, and is not forgotten at sign-out", () => {
    const source = readFileSync(path.join(root, "src/utils/feedLayout.ts"), "utf8");
    const imports = source.match(/from "[^"]+"/g) ?? [];
    expect(imports).toEqual(['from "react"', 'from "@/utils/diskCache"']);
    for (const file of ["src/utils/feedLayout.ts", "src/utils/diskCache.ts"]) {
      expect(code(file)).not.toMatch(/supabase|@\/api|@\/lib|fetch\(/);
    }
    // A preference of the phone's, like the appearance: signing out leaves it.
    expect(code("src/providers/SessionProvider.tsx")).not.toMatch(/feedLayout|feed-layout/i);
  });

  it("is what Home reads, through the same getter on the phone and in the first draw", () => {
    // The hook is the card choice; a snapshot of its own would draw Editorial for everyone.
    expect(code("src/utils/feedLayout.ts")).toMatch(/return useSyncExternalStore\(subscribe, getFeedLayout, getFeedLayout\);/);
  });
});

describe("Home", () => {
  const home = code("app/(tabs)/index.tsx");

  it("chooses the card in one line, from the preference", () => {
    expect(home).toMatch(/const FeedCard = useFeedLayout\(\) === "editorial" \? EditorialPostCard : PostCard;/);
    expect(home.match(/useFeedLayout\(\)/g)).toHaveLength(1);
    expect(home).toMatch(/import \{ PostCard \} from "@\/components\/PostCard";/);
    expect(home).toMatch(/import \{ EditorialPostCard \} from "@\/components\/feed\/EditorialPostCard";/);
  });

  it("hands either card exactly the props the original card was given", () => {
    expect(tags(home, "PostCard")).toHaveLength(0);
    expect(tags(home, "EditorialPostCard")).toHaveLength(0);
    const cards = tags(home, "FeedCard");
    expect(cards).toHaveLength(1);
    const props = cards[0]
      .replace(/^<FeedCard\b/, "")
      .replace(/\/>$/, "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(props).toEqual([
      "post={{ ...item, like_count: likeCountFor(item) }}",
      "likedByMe={isLiked(item)}",
      "onToggleLike={toggleLike}",
      "onOpenComments={onOpenComments}",
      "onOpenProfile={(username) => router.push(`/user/${username}`)}",
      "onShare={onShare}",
      "onOpenLikes={onOpenLikes}",
      "comments={commentsFor(item)}",
      "onMore={(p) => onMore(p)}",
      "active={focused && item.id === visibleId}",
    ]);
  });

  it("draws the chosen card the moment the choice changes", () => {
    const render = home.slice(home.indexOf("const renderItem = useCallback("), home.indexOf("const header ="));
    expect(render).toMatch(/\[FeedCard, likeCountFor, isLiked, toggleLike,/);
  });

  it("keeps the list itself as it was", () => {
    expect(home).toMatch(/keyExtractor=\{\(p\) => p\.id\}/);
    expect(home).toMatch(/ListHeaderComponent=\{header\}/);
    expect(home).toMatch(/renderItem=\{renderItem\}/);
    expect(tags(home, "PendingPostCard")).toHaveLength(1);
  });
});

describe("the editorial card is Home's alone", () => {
  it("is imported by Home and by nothing else", () => {
    const users: string[] = [];
    for (const file of [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))]) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      if (/EditorialPostCard/.test(code(rel)) && rel !== "src/components/feed/EditorialPostCard.tsx") users.push(rel);
    }
    expect(users).toEqual(["app/(tabs)/index.tsx"]);
  });

  it("is not on a profile, the timeline, the gallery or a single post", () => {
    for (const file of [
      "app/(tabs)/profile.tsx",
      "app/user/[username].tsx",
      "src/components/Timeline.tsx",
      "src/components/PhotoInspector.tsx",
      "app/gallery.tsx",
      "app/post/[id].tsx",
    ]) {
      expect(code(file)).not.toMatch(/EditorialPostCard|feedLayout/);
    }
    expect(tags(code("app/gallery.tsx"), "PostCard")).toHaveLength(1);
    expect(code("app/post/[id].tsx")).toMatch(/from "@\/components\/PostCard"/);
  });
});

describe("the editorial card", () => {
  const card = code("src/components/feed/EditorialPostCard.tsx");
  const original = code("src/components/PostCard.tsx");
  const print = code("src/components/ExportCard.tsx");
  /** A style's rules, by its name in the sheet: a block of its own, or one line. */
  const style = (name: string) =>
    card.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))?.[1] ??
    card.match(new RegExp(`\\n  ${name}: \\{ ([^\\n]*?) \\},`))?.[1] ??
    "";
  /** Where a piece of the card is drawn, counted from its outermost View. */
  const body = card.slice(card.indexOf('testID="editorial-post-card"'));
  const at = (needle: string) => body.indexOf(needle);
  const L = exportLayout(1, "print", PRINT_WIDTH);

  it("takes exactly PostCard's props", () => {
    expect(card).toMatch(/type Props = React\.ComponentProps<typeof PostCard>;/);
    expect(card).toMatch(/export function EditorialPostCard\(\{[\s\S]*?\}: Props\)/);
  });

  it("is the print without the brand: no wordmark, no tagline, no member number", () => {
    expect(card).not.toMatch(/VINTAGE|TAGLINE|Members only|EXPORT_ICON|ExportCard|wordmark|tagline/);
    expect(card).not.toMatch(/member_?[nN]o|MEMBER|formatMemberNumber/);
    // The print's own words, asked for with no number, so the name stands alone: `@elena`.
    expect(card).toMatch(/const label = exportLabelText\(post, null\);/);
    expect(card).toMatch(/import \{ PRINT_WIDTH, exportLabelText, exportLayout, type TextBox \} from "@\/utils\/exportLayout";/);
  });

  it("sets out the print in order: the picture, the rule, the label, then the words and the comments", () => {
    const order = [
      "<PostMedia",
      "<View style={styles.rule} />",
      '"Unlike" : "Like"',
      'accessibilityLabel="Comments"',
      'accessibilityLabel="Send to"',
      "{likes}",
      "{replies}",
      "{label.place}",
      "{label.date}",
      "{label.credit}",
      'accessibilityLabel="Post options"',
      "{post.caption}",
      "{preview.map(",
    ];
    const seen = order.map(at);
    order.forEach((needle, i) => expect(seen[i], needle).toBeGreaterThan(-1));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    // Nothing above the picture: it is the first thing in the card.
    expect(body.indexOf("<", 1)).toBe(at("<PostMedia"));
  });

  it("keeps the print's margins: the picture inset by the print's share of the width, a little paper above it", () => {
    expect(card).toMatch(/const PRINT = exportLayout\(1, "print", PRINT_WIDTH\);/);
    expect(style("card")).toMatch(/paddingHorizontal: share\(PRINT\.margin\),/);
    expect(style("card")).toMatch(/paddingTop: share\(GAP\),/);
    expect(style("card")).toMatch(/backgroundColor: colors\.paper,/);
    // About 7% of the width, as on the member's print.
    expect(L.margin / PRINT_WIDTH).toBeGreaterThan(0.065);
    expect(L.margin / PRINT_WIDTH).toBeLessThan(0.075);
    // Prints are told apart by the darker paper between them, not by a frame or a shadow.
    expect(style("card")).toMatch(/borderBottomColor: colors\.paperSunken,/);
    expect(card).not.toMatch(/shadow|elevation|borderRadius/);
  });

  it("draws the rule under the picture as the print does", () => {
    expect(style("rule")).toMatch(/height: PRINT\.rule\.height,/);
    expect(style("rule")).toMatch(/backgroundColor: colors\.borderStrong,/);
    expect(print).toMatch(/rule: p\.borderStrong/);
  });

  it("leaves the print's paper between the picture and the rule, on any phone", () => {
    const sheet = sheets.find((s) => "card" in s && "rule" in s);
    expect(sheet).toBeDefined();
    const { card: paper, rule } = sheet!;
    /** A percentage as React Native and the web resolve it: a share of the room it is measured in. */
    const of = (length: unknown, room: number) => {
      expect(length).toMatch(/^\d+(\.\d+)?%$/);
      return (parseFloat(String(length)) / 100) * room;
    };
    expect(card).toMatch(/const GAP = PRINT\.rule\.y - \(PRINT\.photo\.y \+ PRINT\.photo\.height\);/);
    const GAP = L.rule.y - (L.photo.y + L.photo.height);
    for (const width of [320, 390, 430]) {
      // The card is the print at the phone's width: at 390 pt the print's 29 pt gap comes to about 20.9 pt.
      const gap = (GAP * width) / PRINT_WIDTH;
      // The card's own paddings are taken of its whole width.
      const margin = of(paper.paddingHorizontal, width);
      expect(of(paper.paddingTop, width)).toBeCloseTo(gap, 1);
      // A length inside them is taken of the room between them, which the picture fills.
      const room = width - 2 * margin;
      expect(room).toBeCloseTo((L.photo.width * width) / PRINT_WIDTH, 1);
      expect(of(rule.marginTop, room)).toBeCloseTo(gap, 1);
    }
  });

  it("gives a length inside the card as a share of the picture's width, not the card's", () => {
    const written = card.slice(card.indexOf("const styles = StyleSheet.create("));
    // Only the card's own paddings are a share of the whole width.
    expect(written.match(/\bshare\(/g)).toHaveLength(3);
    expect(style("card").match(/\bshare\(/g)).toHaveLength(3);
    expect(style("rule")).toMatch(/marginTop: inner\(GAP\),/);
  });

  it("sets the place, the date and @name right-aligned, in the print's typewriter lines and inks", () => {
    expect(card).toMatch(/function line\(box: TextBox\) \{\s*return \{\s*fontFamily: type\.mono,\s*fontSize: box\.size,\s*letterSpacing: box\.spacing,/);
    const lines: [string, string, string][] = [
      ["place", "PRINT.place", "inkSoft"],
      ["date", "PRINT.byline", "inkSoft"],
      ["creditText", "PRINT.credit", "inkFaint"],
    ];
    for (const [name, box, ink] of lines) {
      expect(style(name), name).toContain(`...line(${box}),`);
      expect(style(name), name).toContain('textAlign: "right",');
      expect(style(name), name).toMatch(new RegExp(`color: colors\\.${ink}\\b`));
    }
    // The same inks the print gives its place, its date and its credit.
    expect(print).toMatch(/rect\(L\.place\),[\s\S]*?color: c\.inkSoft,/);
    expect(print).toMatch(/rect\(L\.byline\),[\s\S]*?color: c\.inkSoft,/);
    expect(print).toMatch(/rect\(L\.credit\),[\s\S]*?color: c\.inkFaint,/);
    expect(style("dateline")).toMatch(/alignItems: "flex-end",/);
    // A long place takes a second line rather than pushing the date off.
    expect(card).toMatch(/style=\{styles\.place\} numberOfLines=\{2\}/);
  });

  it("opens the profile from @name, with the \"…\" after it on the same line", () => {
    const credit = body.slice(at("<View style={styles.credit}>"), at("{post.caption}"));
    expect(credit).toMatch(/onPress=\{\(\) => onOpenProfile\(post\.author\.username\)\}\s*accessibilityRole="button"/);
    expect(credit.indexOf("{label.credit}")).toBeGreaterThan(-1);
    expect(credit.indexOf('accessibilityLabel="Post options"')).toBeGreaterThan(credit.indexOf("{label.credit}"));
    expect(style("credit")).toMatch(/flexDirection: "row",/);
  });

  it("sets the caption in the comments' own type", () => {
    const face = (rules: string) =>
      rules
        .split("\n")
        .filter((l) => /type\.body|fontSize|fontFamily|lineHeight|color/.test(l))
        .map((l) => l.trim());
    expect(face(style("caption"))).toEqual(face(style("comment")));
    expect(face(style("caption"))).toContain("fontSize: 14,");
    expect(style("caption")).not.toMatch(/type\.(serif|mono)/);
  });

  it("keeps its label on screen at the largest text sizes", () => {
    const mono = card.match(/<Text[^>]*styles\.(countText|place|date|creditText)\b[^>]*>/g) ?? [];
    expect(mono).toHaveLength(6);
    for (const t of mono) expect(t).toMatch(/maxFontSizeMultiplier=\{LABEL_CAP\}/);
    expect(card).toMatch(/const LABEL_CAP = 2;/);
    // The right-hand lines go under the buttons rather than off the edge, and ask for more room as they grow.
    expect(style("label")).toMatch(/flexWrap: "wrap",/);
    expect(style("dateline")).toMatch(/flexShrink: 1,/);
    expect(card).toMatch(/const scale = Math\.min\(Math\.max\(useWindowDimensions\(\)\.fontScale, 1\), LABEL_CAP\);/);
    expect(card).toMatch(/style=\{\[styles\.dateline, dateline\]\}/);
    expect(card).toMatch(/const dateline = \{ flexBasis: DATELINE \* scale \};/);
    // At the cap the longest date still fits across a 320 pt screen, inside the margins.
    // React Native grows the letters with Larger Text and leaves their tracking as set.
    const longest = "SEPTEMBER 30, 2026".length * (L.byline.size * 0.6 * 2 + L.byline.spacing);
    expect(longest).toBeLessThan(320 * (1 - (2 * L.margin) / PRINT_WIDTH));
  });

  it("draws the picture exactly as PostCard does, without the hairlines a print has no need of", () => {
    const mine = tags(card, "PostMedia");
    expect(mine).toHaveLength(1);
    expect(flat(mine[0])).toBe(flat(tags(original, "PostMedia")[0] ?? "").replace(/ \/>$/, " bare />"));
    expect(mine[0]).toMatch(/onDoubleTap=\{\(\) => like\(true\)\}/);
    expect(mine[0]).toMatch(/active=\{active\}/);
    expect(mine[0]).toMatch(/warm=\{warm\}/);
    expect(mine[0]).toMatch(/recyclingKey=\{post\.id\}/);
    expect(mine[0]).toMatch(/surface=\{surface\}/);
    expect(card).toMatch(/^\s*active = true,$/m);
    expect(card).toMatch(/^\s*warm = true,$/m);
    // `bare` takes off the frame's two rules and nothing else.
    expect(code("src/components/PostMedia.tsx")).toMatch(/bare: \{ borderTopWidth: 0, borderBottomWidth: 0 \},/);
  });

  it("likes through the very same steps as PostCard", () => {
    expect(likeOf(card).length).toBeGreaterThan(0);
    expect(likeOf(card)).toBe(likeOf(original));
    expect(card).toMatch(/onPress=\{\(\) => like\(!likedByMe\)\}\s*accessibilityLabel=\{likedByMe \? "Unlike" : "Like"\}/);
  });

  it("calls what Home passes in for the \"…\", comments, sending and the likes", () => {
    expect(card).toMatch(/onPress=\{\(\) => onMore\(post\)\} accessibilityLabel="Post options"/);
    expect(card).toMatch(/onPress=\{\(\) => onOpenComments\(post\)\} accessibilityLabel="Comments"/);
    expect(card).toMatch(/onPress=\{\(\) => onShare\(post\)\} accessibilityLabel="Send to"/);
    expect(card).toMatch(/onPress=\{\(\) => onOpenLikes\?\.\(post\)\} disabled=\{!onOpenLikes\}/);
    expect(card).toMatch(/onPress=\{\(\) => onOpenComments\(post\)\} accessibilityRole="button"/);
    // The same labels as the original card, for VoiceOver and the launch test alike.
    for (const label of ['"Post options"', '"Comments"', '"Send to"', '"Unlike" : "Like"']) {
      expect(original).toContain(label);
    }
  });

  it("decides nothing for itself", () => {
    expect(card).not.toMatch(/@\/api|supabase|usePostActions|useQuery|useState|useEffect/);
    expect(card).toMatch(/import \{ INLINE_COMMENTS, PostCard \} from "\.\.\/PostCard";/);
    expect(card).toMatch(/const preview = \(comments \?\? \[\]\)\.slice\(-INLINE_COMMENTS\);/);
  });

  it("gives every button a full target", () => {
    expect(card).toMatch(/const TARGET = 44;/);
    for (const name of ["button", "count"]) {
      expect(style(name), name).toMatch(/minWidth: TARGET,/);
      expect(style(name), name).toMatch(/minHeight: TARGET,/);
    }
    expect(style("name")).toMatch(/minHeight: TARGET,/);
    expect(card).toMatch(/<Pressable\s*style=\{styles\.button\}\s*onPress=\{\(\) => like\(!likedByMe\)\}/);
    for (const label of ["Comments", "Send to"]) {
      expect(card).toMatch(new RegExp(`<Pressable style=\\{styles\\.button\\}[^\\n]*accessibilityLabel="${label}"`));
    }
    expect(card).toMatch(/<Pressable style=\{\[styles\.button, styles\.more, reach\]\} onPress=\{\(\) => onMore\(post\)\}/);
    // Where the counts' targets meet the buttons', the buttons are on top.
    expect(style("actions")).toMatch(/zIndex: 1,/);
    // The name and the "…" reach above and below their line, by no more than the line leaves of a target.
    expect(card).toMatch(/const reach = \{ marginVertical: -Math\.max\(0, TARGET - CREDIT_LINE \* scale\) \/ 2 \};/);
    expect(card).toMatch(/style=\{\[styles\.name, reach\]\}/);
    expect(card).toMatch(/testID="editorial-post-card"/);
  });
});

describe("Settings", () => {
  const settings = code("app/settings.tsx");

  it("offers both layouts as a radio group, Original first, taking effect at once", () => {
    const group = settings.slice(settings.indexOf('accessibilityLabel="Feed layout"') - 80);
    expect(group).toMatch(/^[\s\S]*?accessibilityRole="radiogroup" accessibilityLabel="Feed layout">\s*\{FEED_LAYOUTS\.map\(/);
    expect(group).toMatch(/onPress=\{\(\) => setFeedLayout\(value\)\}\s*accessibilityRole="radio"\s*accessibilityState=\{\{ selected: on \}\}/);
    expect(settings).toMatch(/const feedLayout = useFeedLayout\(\);/);
    expect(settings).toMatch(/const on = feedLayout === value;/);
    expect(settings).toMatch(/<Text style=\{styles\.prefLabel\}>Feed layout<\/Text>/);
  });

  it("puts it under Appearance, before the profile's Save", () => {
    const appearance = settings.indexOf(">Appearance<");
    const layout = settings.indexOf(">Feed layout<");
    const save = settings.indexOf('<Button title="Save"');
    expect(appearance).toBeGreaterThan(0);
    expect(layout).toBeGreaterThan(appearance);
    expect(save).toBeGreaterThan(layout);
  });
});
