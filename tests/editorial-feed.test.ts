import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Editorial (Preview), the trial layout of the feed.
 *
 * The two preferences first: the original feed on off-white paper unless
 * the phone says otherwise, each kept in one small file and nowhere else.
 * Then, read from the source, the lines that keep the experiment a matter
 * of presentation: Home and the gallery hand either card the very same
 * props from one seam each, only they draw the editorial card, and that
 * card's picture, like and "…" are wired exactly as PostCard's are. And
 * from the card's own sheet, the lengths it comes to on a phone, laid out
 * the way React Native lays them out.
 */

const phone = { files: new Map<string, string>() };
/** Every sheet made as the modules load; the editorial card's is the one with a rule. */
const sheets: Record<string, Record<string, unknown>>[] = [];
/** Every colour made for both appearances, as iOS is asked for it. */
const dynamic: { light: string; dark: string }[] = [];

vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (choices: { ios?: unknown; default?: unknown }) => choices.ios ?? choices.default },
  DynamicColorIOS: (pair: { light: string; dark: string }) => {
    dynamic.push(pair);
    return pair.light;
  },
  StyleSheet: {
    create: <T extends Record<string, Record<string, unknown>>>(sheet: T) => {
      sheets.push(sheet);
      return sheet;
    },
  },
  AppState: { currentState: "active", addEventListener: () => ({ remove: () => {} }) },
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
vi.mock("@/components/Avatar", () => ({ Avatar: () => null }));
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
const {
  FEED_PAPERS,
  getFeedPaper,
  paperStyle,
  parseFeedPaper,
  setFeedPaper,
  __resetFeedPaperForTest,
  __subscribeToPaperForTest,
} = await import("@/utils/feedPaper");
const { colors, dark, light, type } = await import("@/theme");
await import("@/components/feed/EditorialPostCard");

const FILE = "document/feed-layout.json";
const PAPER_FILE = "document/feed-paper.json";
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

/** Every `<Tag … />` in a file. */
function tags(source: string, tag: string): string[] {
  return source.match(new RegExp(`<${tag}\\b[\\s\\S]*?\\/>`, "g")) ?? [];
}

/** A tag's props, one to a line, as they are written. */
function props(tag: string, name: string): string[] {
  return tag
    .replace(new RegExp(`^<${name}\\b`), "")
    .replace(/\/>$/, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/** One space for every run of white space, so layout alone never fails a comparison. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

/** The card's own `like`, from `const like =` to the line that closes it. */
const likeOf = (source: string) => /const like = \(next: boolean\) => \{[\s\S]*?\n {2}\};/.exec(source)?.[0] ?? "";

/** The one line that picks the card, the same on Home and in the gallery. */
const SEAM = /const FeedCard = useFeedLayout\(\) === "editorial" \? EditorialPostCard : PostCard;/;

describe("the feed layout preference", () => {
  beforeEach(() => {
    phone.files.clear();
    __resetFeedLayoutForTest();
  });

  it("is the original feed until the member chooses otherwise", () => {
    expect(getFeedLayout()).toBe("original");
    expect(phone.files.has(FILE)).toBe(false);
  });

  it("offers Original first, then Editorial (no \"Preview\" in what members and App Review see)", () => {
    expect(FEED_LAYOUTS.map((l) => l.value)).toEqual(["original", "editorial"]);
    expect(FEED_LAYOUTS.map((l) => l.label)).toEqual(["Original", "Editorial"]);
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

  it("tells a mounted feed at once, and only when it changes", () => {
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

  it("is what a feed reads, through the same getter on the phone and in the first draw", () => {
    // The hook is the card choice; a snapshot of its own would draw Editorial for everyone.
    expect(code("src/utils/feedLayout.ts")).toMatch(/return useSyncExternalStore\(subscribe, getFeedLayout, getFeedLayout\);/);
  });
});

describe("the paper preference", () => {
  beforeEach(() => {
    phone.files.clear();
    __resetFeedPaperForTest();
  });

  it("is the off-white until the member chooses otherwise", () => {
    expect(getFeedPaper()).toBe("off-white");
    expect(phone.files.has(PAPER_FILE)).toBe(false);
  });

  it("offers Off-white first, then White", () => {
    expect(FEED_PAPERS.map((p) => p.value)).toEqual(["off-white", "white"]);
    expect(FEED_PAPERS.map((p) => p.label)).toEqual(["Off-white", "White"]);
  });

  it("is kept on the phone in a file of its own, and read back at the next launch", () => {
    setFeedPaper("white");
    expect(phone.files.get(PAPER_FILE)).toBe(JSON.stringify("white"));
    expect(phone.files.has(FILE)).toBe(false);
    __resetFeedPaperForTest();
    expect(getFeedPaper()).toBe("white");
    setFeedPaper("off-white");
    __resetFeedPaperForTest();
    expect(getFeedPaper()).toBe("off-white");
    const source = code("src/utils/feedPaper.ts");
    expect(source).toMatch(/const FILE = "feed-paper\.json";/);
    expect(source).toMatch(/const KEY = "vintage\.feed-paper";/);
  });

  it("reads anything it does not know as the off-white", () => {
    expect(parseFeedPaper("white")).toBe("white");
    for (const raw of ["off-white", "White", "cream", null, undefined, 1, {}]) {
      expect(parseFeedPaper(raw)).toBe("off-white");
    }
    phone.files.set(PAPER_FILE, "not json");
    expect(getFeedPaper()).toBe("off-white");
  });

  it("tells a mounted feed at once, and only when it changes", () => {
    const heard: string[] = [];
    const stop = __subscribeToPaperForTest(() => heard.push(getFeedPaper()));
    setFeedPaper("white");
    setFeedPaper("white");
    setFeedPaper("off-white");
    stop();
    setFeedPaper("white");
    expect(heard).toEqual(["white", "off-white"]);
  });

  it("asks nothing of the server, and is not forgotten at sign-out", () => {
    const source = readFileSync(path.join(root, "src/utils/feedPaper.ts"), "utf8");
    const imports = source.match(/from "[^"]+"/g) ?? [];
    expect(imports).toEqual([
      'from "react"',
      'from "react-native"',
      'from "@/theme"',
      'from "@/utils/diskCache"',
      'from "@/utils/feedLayout"',
    ]);
    expect(code("src/utils/feedPaper.ts")).not.toMatch(/supabase|@\/api|@\/lib|fetch\(/);
    expect(code("src/providers/SessionProvider.tsx")).not.toMatch(/feedPaper|feed-paper/i);
  });

  it("is read through the same getter on the phone and in the first draw", () => {
    expect(code("src/utils/feedPaper.ts")).toMatch(/return useSyncExternalStore\(subscribe, getFeedPaper, getFeedPaper\);/);
  });

  it("is the app's own paper for Off-white, and plain white for White", () => {
    expect(paperStyle("off-white")).toEqual({ backgroundColor: colors.paper });
    expect(colors.paper).toBe(light.paper);
    expect(paperStyle("white")).toEqual({ backgroundColor: "#FFFFFF" });
  });

  it("keeps the dark print's black under either, in the dark appearance", () => {
    expect(dynamic).toContainEqual({ light: "#FFFFFF", dark: dark.paper });
    expect(dynamic).toContainEqual({ light: light.paper, dark: dark.paper });
    expect(dark.paper).toBe("#000000");
  });

  it("lays a screen on the chosen paper only while the feed is Editorial", () => {
    const source = code("src/utils/feedPaper.ts");
    expect(source).toMatch(
      /export function useFeedBackground\(\): \{ backgroundColor: ColorValue \} \{\s*const layout = useFeedLayout\(\);\s*const choice = useFeedPaper\(\);\s*return paperStyle\(layout === "editorial" \? choice : "off-white"\);\s*\}/,
    );
  });
});

describe("Home", () => {
  const home = code("app/(tabs)/index.tsx");

  it("chooses the card in one line, from the preference", () => {
    expect(home).toMatch(SEAM);
    expect(home.match(/useFeedLayout\(\)/g)).toHaveLength(1);
    expect(home).toMatch(/import \{ PostCard \} from "@\/components\/PostCard";/);
    expect(home).toMatch(/import \{ EditorialPostCard \} from "@\/components\/feed\/EditorialPostCard";/);
  });

  it("lies on the feed's paper", () => {
    expect(home).toMatch(/const paper = useFeedBackground\(\);/);
    expect(home).toMatch(/<Screen padded=\{false\} style=\{paper\}>/);
    expect(home).toMatch(/import \{ useFeedBackground \} from "@\/utils\/feedPaper";/);
  });

  it("hands either card exactly the props the original card was given", () => {
    expect(tags(home, "PostCard")).toHaveLength(0);
    expect(tags(home, "EditorialPostCard")).toHaveLength(0);
    const cards = tags(home, "FeedCard");
    expect(cards).toHaveLength(1);
    expect(props(cards[0], "FeedCard")).toEqual([
      "post={counted(item, likeCountFor(item))}",
      "viewerId={userId}",
      "likedByMe={isLiked(item)}",
      "onToggleLike={toggleLike}",
      "onOpenComments={onOpenComments}",
      "onOpenProfile={openProfile}",
      "onShare={onShare}",
      "onOpenLikes={onOpenLikes}",
      "comments={commentsOrNone(commentsFor(item))}",
      "onCommentLongPress={onCommentLongPress}",
      "onMore={more}",
      "active={focused && item.id === visibleId}",
      'priority={index < FIRST_SCREEN ? "high" : "normal"}',
    ]);
  });

  it("draws the chosen card the moment the choice changes", () => {
    const render = home.slice(home.indexOf("const renderItem = useCallback("), home.indexOf("const header ="));
    expect(render).toMatch(/\[FeedCard, counted, userId, likeCountFor, isLiked, toggleLike,/);
  });

  it("keeps the list itself as it was", () => {
    expect(home).toMatch(/keyExtractor=\{\(p\) => p\.id\}/);
    expect(home).toMatch(/ListHeaderComponent=\{header\}/);
    expect(home).toMatch(/renderItem=\{renderItem\}/);
    // A post on its way up is drawn by the card that follows the one chosen, handed the original's props.
    expect(home).toMatch(/const PendingCard = FeedCard === EditorialPostCard \? EditorialPendingCard : PendingPostCard;/);
    expect(tags(home, "PendingPostCard")).toHaveLength(0);
    expect(tags(home, "EditorialPendingCard")).toHaveLength(0);
    const cards = tags(home, "PendingCard");
    expect(cards).toHaveLength(1);
    expect(props(cards[0], "PendingCard")).toEqual([
      "key={p.id}",
      "pending={p}",
      "active={focused && visibleId === null && i === 0}",
      "focused={focused}",
      "onOpenProfile={(username) => router.push(`/user/${username}`)}",
    ]);
  });
});

describe("the bars around Home", () => {
  const tabs = code("app/(tabs)/_layout.tsx");

  it("put the wordmark's bar on the feed's paper, on Home alone", () => {
    const header = tabs.slice(tabs.indexOf("function TabHeader("));
    expect(header).toMatch(/const paper = useFeedBackground\(\);/);
    expect(header).toMatch(/<View style=\{\[styles\.header, tab === "index" && paper, \{ paddingTop: insets\.top \+ spacing\.sm \}\]\}>/);
  });

  it("put the tab bar on the feed's paper while Home is in front, and leave it for the other tabs", () => {
    const layout = tabs.slice(tabs.indexOf("export default function TabsLayout("), tabs.indexOf("function TabHeader("));
    // Read before the layout can return early, so the hooks run the same way every time.
    expect(layout.indexOf("const paper = useFeedBackground();")).toBeGreaterThan(-1);
    expect(layout.indexOf("const paper = useFeedBackground();")).toBeLessThan(layout.indexOf("if (session === null) return"));
    const home = layout.slice(layout.indexOf('name="index"'), layout.indexOf('name="search"'));
    expect(home).toMatch(/tabBarStyle: \[styles\.bar, \{ paddingBottom: insets\.bottom \}, paper\],/);
    expect(layout).toMatch(/screenOptions=\{\{[\s\S]*?tabBarStyle: \[styles\.bar, \{ paddingBottom: insets\.bottom \}\],/);
    expect(layout.match(/tabBarStyle:/g)).toHaveLength(2);
  });
});

describe("the gallery", () => {
  const gallery = code("app/gallery.tsx");

  it("chooses the card in the same one line as Home", () => {
    expect(gallery).toMatch(SEAM);
    expect(gallery.match(/useFeedLayout\(\)/g)).toHaveLength(1);
    expect(gallery).toMatch(/import \{ EditorialPostCard \} from "@\/components\/feed\/EditorialPostCard";/);
    expect(gallery).toMatch(/import \{ useFeedLayout \} from "@\/utils\/feedLayout";/);
  });

  it("hands either card exactly the props it gave the original card, inside the row it measures", () => {
    expect(tags(gallery, "PostCard")).toHaveLength(0);
    expect(tags(gallery, "EditorialPostCard")).toHaveLength(0);
    const cards = tags(gallery, "FeedCard");
    expect(cards).toHaveLength(1);
    expect(props(cards[0], "FeedCard")).toEqual([
      "post={counted(item, likeCountFor(item))}",
      "viewerId={userId}",
      "likedByMe={isLiked(item)}",
      "onToggleLike={toggleLike}",
      "onOpenComments={onOpenComments}",
      "onOpenProfile={openProfile}",
      "onShare={onShare}",
      "onOpenLikes={onOpenLikes}",
      "comments={commentsOrNone(commentsFor(item))}",
      "onCommentLongPress={onCommentLongPress}",
      "onMore={more}",
      "active={ready && focused && item.id === visibleId}",
      "warm={isWarm(index, warm)}",
      "frameOnly={!isWarm(index, pictures)}",
      "standIn={isWarm(index, standIns)}",
      'priority={item.id === postId ? "high" : "normal"}',
      'surface="gallery"',
    ]);
    // The row the landing measures (and, for the tapped one, looks for) holds the card.
    expect(gallery).toMatch(
      /<View ref=\{item\.id === postId \? tapped : undefined\} onLayout=\{\(e\) => onCardLayout\(item\.id, e\)\}>\s*<FeedCard\b/,
    );
  });

  it("lies on the feed's paper, under a bar on the same paper", () => {
    expect(gallery).toMatch(/const paper = useFeedBackground\(\);/);
    expect(gallery).toMatch(/<Screen padded=\{false\} style=\{paper\}>/);
    // Its title, the author's username or the era, in the stack's serif; the username's regular under Editorial (tests/editorial-names.test.ts).
    expect(gallery).toMatch(
      /<Stack\.Screen options=\{\{ title: shown\.era \?\? authorQ\.data\?\.username \?\? "", headerStyle: paper as \{ backgroundColor: string \}, headerTitle: nameHeaderTitle\(titleStyle\), headerTitleStyle: titleStyle \}\} \/>/,
    );
  });
});

describe("the editorial card is drawn by Home and the gallery alone", () => {
  it("is imported by Home and the gallery and by nothing else, but the card of a post on its way up, drawn from its pieces", () => {
    const users = sources().filter(
      (rel) => /EditorialPostCard/.test(code(rel)) && rel !== "src/components/feed/EditorialPostCard.tsx",
    );
    expect(users.sort()).toEqual(["app/(tabs)/index.tsx", "app/gallery.tsx", "src/components/feed/EditorialPendingCard.tsx"]);
    // And that card by Home alone.
    const pending = sources().filter(
      (rel) => /EditorialPendingCard/.test(code(rel)) && rel !== "src/components/feed/EditorialPendingCard.tsx",
    );
    expect(pending).toEqual(["app/(tabs)/index.tsx"]);
  });

  it("has its paper read only by the feeds, Home's bars, Settings and the card", () => {
    const users = sources().filter((rel) => /@\/utils\/feedPaper/.test(code(rel)));
    expect(users.sort()).toEqual([
      "app/(tabs)/_layout.tsx",
      "app/(tabs)/index.tsx",
      "app/gallery.tsx",
      "app/settings.tsx",
      "src/components/feed/EditorialPendingCard.tsx",
      "src/components/feed/EditorialPostCard.tsx",
    ]);
  });

  it("is not on a profile, the timeline or a single post", () => {
    for (const file of [
      "app/(tabs)/profile.tsx",
      "app/user/[username].tsx",
      "src/components/Timeline.tsx",
      "src/components/PhotoInspector.tsx",
      "app/post/[id].tsx",
    ]) {
      expect(code(file)).not.toMatch(/EditorialPostCard|feedLayout|feedPaper/);
    }
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
  /** A piece of the card's (PrintMember, PrintLabel, PrintCaption), from its name to its closing brace. */
  const piece = (name: string) => {
    const from = card.indexOf(`export function ${name}(`);
    expect(from, name).toBeGreaterThan(-1);
    return card.slice(from, card.indexOf("\n}\n", from) + 2);
  };
  /** What a piece returns, as it is written. */
  const drawnBy = (name: string) => {
    const fn = piece(name);
    const ret = fn.slice(fn.indexOf("return ") + "return ".length);
    return ret.slice(0, ret.lastIndexOf(";")).trim();
  };
  /** The card's own JSX, from its outermost View to the end of EditorialPostCard. */
  const own = card.slice(card.indexOf('testID="editorial-post-card"'), card.indexOf("interface Drawn {"));
  /** The card as it is drawn: its own JSX with each of its pieces' JSX in its place. */
  const labelOf = drawnBy("PrintLabel");
  const body = own
    .replace("<PrintMember post={post} onOpenProfile={onOpenProfile} />", drawnBy("PrintMember"))
    .replace("<PrintLabel post={post}>", labelOf.slice(0, labelOf.indexOf("{children}")))
    .replace("</PrintLabel>", labelOf.slice(labelOf.indexOf("{children}") + "{children}".length))
    .replace("<PrintCaption post={post} onOpenProfile={onOpenProfile} />", `{${drawnBy("PrintCaption")}}`);
  const at = (needle: string) => body.indexOf(needle);
  /** The row above the picture. */
  const header = body.slice(at("<View style={styles.header}>"), at("<PostMedia"));
  /** The label under the rule. */
  const label = body.slice(at("<View style={styles.label}>"), at("{likes ? ("));
  const posted = card.slice(card.indexOf("function PostedTime("), card.indexOf("const PRINT ="));
  const sheet = sheets.find((s) => "card" in s && "rule" in s);
  const L = exportLayout(1, "print", PRINT_WIDTH);
  /** A percentage as React Native and the web resolve it: a share of the room it is measured in. */
  const of = (length: unknown, room: number) => {
    expect(length).toMatch(/^\d+(\.\d+)?%$/);
    return (parseFloat(String(length)) / 100) * room;
  };

  it("draws its member, its label and its caption by its own pieces, handed the post and the way to a member", () => {
    for (const tag of [
      "<PrintMember post={post} onOpenProfile={onOpenProfile} />",
      "<PrintLabel post={post}>",
      "</PrintLabel>",
      "<PrintCaption post={post} onOpenProfile={onOpenProfile} />",
    ]) {
      expect(own.split(tag), tag).toHaveLength(2);
      expect(body, tag).not.toContain(tag);
    }
    expect(body).not.toMatch(/<Print[A-Z]/);
  });

  it("takes exactly PostCard's props", () => {
    expect(card).toMatch(/type Props = React\.ComponentProps<typeof PostCard>;/);
    expect(card).toMatch(/export const EditorialPostCard = React\.memo\(function EditorialPostCard\(\{[\s\S]*?\}: Props\)/);
  });

  it("is the print without the brand: no wordmark, no tagline, no member number", () => {
    expect(card).not.toMatch(/VINTAGE|TAGLINE|Members only|EXPORT_ICON|ExportCard|wordmark|tagline/);
    expect(card).not.toMatch(/member_?[nN]o|MEMBER|formatMemberNumber/);
    expect(card).toMatch(/const label = exportLabelText\(post, null\);/);
    expect(card).toMatch(/import \{ PRINT_WIDTH, exportLabelText, exportLayout, type TextBox \} from "@\/utils\/exportLayout";/);
  });

  it("sets out the post in order: the member, the picture, the rule, the label, the words, the comments, and when", () => {
    const order = [
      "<View style={styles.header}>",
      "<Avatar",
      "<Text style={styles.username}",
      'accessibilityLabel="Post options"',
      "<PostMedia",
      "<View style={styles.rule} />",
      '"Unlike" : "Like"',
      'accessibilityLabel="Comments"',
      'accessibilityLabel="Send to"',
      "{label.place}",
      "{label.date}",
      "{likes ? (",
      "{post.caption}",
      "{preview.map(",
      "<PostedTime at={post.created_at} />",
    ];
    const seen = order.map(at);
    order.forEach((needle, i) => expect(seen[i], needle).toBeGreaterThan(-1));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
    // Nothing above the member: their row is the first thing in the card.
    expect(body.indexOf("<", 1)).toBe(at("<View style={styles.header}>"));
  });

  it("puts the member above the picture as the original card does: their picture and name, then the \"…\"", () => {
    const member = /<Pressable\s*style=\{styles\.member\}[\s\S]*?<\/Pressable>/.exec(header)?.[0] ?? "";
    expect(member).toMatch(/onPress=\{\(\) => onOpenProfile\(post\.author\.username\)\}/);
    expect(member).toMatch(/accessibilityRole="button"\s*accessibilityLabel=\{post\.author\.username\}/);
    // Their picture, 28 pt, in a 1 pt ring with 2 pt of the card's paper between: 34 pt in all, the original card's size.
    expect(member).toMatch(/<View style=\{styles\.ring\}>\s*<Avatar path=\{post\.author\.avatar_url\} username=\{post\.author\.username\} size=\{FACE\} \/>\s*<\/View>/);
    expect(card).toMatch(/const FACE = 28;/);
    expect(card).toMatch(/const RING_WIDTH = 1;/);
    expect(style("ring")).toMatch(/width: AVATAR,\s*height: AVATAR,\s*borderRadius: AVATAR \/ 2,\s*borderWidth: RING_WIDTH,\s*borderColor: colors\.nameInk,/);
    expect(style("ring")).not.toMatch(/backgroundColor|padding/);
    // 28 + 2 * 2 + 2 * 1.
    expect(28 + 2 * 2 + 2 * 1).toBe(34);
    // 13 pt between the ring and the name.
    expect(style("member")).toMatch(/gap: 13,/);
    expect(member).toMatch(/\{post\.author\.username\}\s*<\/Text>/);
    // The original card's size for the picture.
    expect(card).toMatch(/const AVATAR = 34;/);
    expect(tags(original, "Avatar")[0]).toMatch(/size=\{34\}/);
    // The owner's restyle (24 November, a size up the same day, in the bold once the owner had seen build 56): the
    // name in Cormorant Garamond Bold Italic, 16 pt, in the name ink, the names' face beside the 12.5 pt words, with
    // the room its letters reach into (see tests/editorial-names.test.ts, tests/editorial-name-font.test.ts, tests/editorial-name-room.test.ts).
    // The original card keeps its own.
    expect(original).toMatch(/\n {2}username: \{ fontSize: 14, fontWeight: "600", color: colors\.ink \},/);
    expect(card).toMatch(/\nconst WORDS = 12\.5;\nconst NAME = nameStyle\(WORDS\);\n/);
    expect(card).toMatch(/\n {2}username: \{ flexShrink: 1, \.\.\.nameStyle\(WORDS, "alone"\), color: colors\.nameInk \},/);
    // The cut asked for at its own weight, so the phone lands on it (src/utils/nameFace.ts); no style over the italic.
    expect(sheet!.username).toEqual({
      flexShrink: 1,
      fontFamily: "CormorantGaramond-BoldItalic",
      fontSize: 16,
      fontWeight: "700",
      paddingHorizontal: 3,
      marginHorizontal: -3,
      color: colors.nameInk,
    });
    expect(sheet!.username).not.toHaveProperty("fontStyle");
    expect(sheet!.username).not.toHaveProperty("letterSpacing");
    // Only the name: the place and the date are on the label.
    expect(header).not.toMatch(/label\.|Byline|taken_at|location/);
    // The "…" ends the row, after the name.
    expect(header.indexOf('accessibilityLabel="Post options"')).toBeGreaterThan(header.indexOf("</Pressable>"));
    expect(header).toMatch(/<Pressable\s*style=\{\[styles\.button, styles\.more\]\}\s*onPress=\{\(\) => onMore\(post\)\}/);
    expect(style("header")).toMatch(/flexDirection: "row",/);
    expect(style("member")).toMatch(/flex: 1,/);
  });

  it("leaves as much paper between the member's picture and the photograph as between the photograph and the hairline", () => {
    expect(sheet).toBeDefined();
    const { header: row, print: sheetOfPrint, rule } = sheet!;
    // The row is a target's height with the picture centred in it, and ends where the picture does.
    expect((44 - 34) / 2 + Number(row.marginBottom)).toBe(0);
    // Then the print's own paper over the photograph, the same share of the width as under it, before the hairline.
    expect(style("print")).toMatch(/paddingTop: share\(GAP\),/);
    expect(style("rule")).toMatch(/marginTop: share\(GAP\),/);
    for (const width of [320, 390, 430]) {
      expect(of(sheetOfPrint.paddingTop, width)).toBeCloseTo(of(rule.marginTop, width), 6);
    }
    // The member's targets reach into that paper, and the paper lets a touch through to them.
    expect(style("print")).toMatch(/pointerEvents: "box-none",/);
  });

  it("has no counts but your own photograph's likes: never a count of comments, and the likes through the one rule", () => {
    expect(card).not.toMatch(/comment_count|\{likes\}|\{replies\}|View all/);
    expect(card).not.toMatch(/styles\.(counts|count|countText)\b/);
    // The count of likes is read once, through likesLine, for the reader the card is given (src/utils/ownLikes.ts).
    expect(card.match(/like_count/g)).toHaveLength(1);
    expect(card).toMatch(/const likes = likesLine\(post, viewerId, post\.like_count\);/);
    expect(card).toMatch(/^import \{ LIKES_HINT, likesLine \} from "@\/utils\/ownLikes";$/m);
    // Taken from the props, and handed the post on a tap, only where the count opens anything.
    expect(card.match(/onOpenLikes/g)).toHaveLength(3);
    // The label draws nothing of the post's but its place and date.
    expect(label).not.toMatch(/\{post\./);
  });

  it("shows your own photograph's count under the label, and opens who liked it; on anyone else's, nothing", () => {
    const line = body.slice(at("{likes ? ("), at("{post.caption ? ("));
    expect(line).toMatch(
      /\{likes \? \(\s*likes\.opens \? \(\s*<Pressable\s+onPress=\{\(\) => onOpenLikes\?\.\(post\)\}\s+disabled=\{!onOpenLikes\}\s+hitSlop=\{6\}\s+accessibilityRole="button"\s+accessibilityLabel=\{likes\.label\}\s+accessibilityHint=\{LIKES_HINT\}\s*>\s*<Text maxFontSizeMultiplier=\{LABEL_CAP\} style=\{styles\.likes\}>\s*\{likes\.text\}\s*<\/Text>\s*<\/Pressable>\s*\) : \(\s*<Text maxFontSizeMultiplier=\{LABEL_CAP\} style=\{\[styles\.likes, styles\.noLikes\]\} accessibilityLabel=\{likes\.label\}>\s*\{likes\.text\}\s*<\/Text>\s*\)\s*\) : null\}/,
    );
    // One height for the count and for "No likes yet", so the first like changes the words and not the card; the
    // words' size, from the edge the words start at.
    expect(card).toMatch(/export const LIKES_LINE = 18;/);
    expect(style("likes")).toMatch(/fontSize: WORDS,\s*lineHeight: LIKES_LINE,\s*fontWeight: "600",\s*color: colors\.ink,\s*paddingHorizontal: EDGE,/);
    expect(card).toMatch(/\n {2}noLikes: \{ fontWeight: "400", color: colors\.inkFaint \},/);
    expect(sheet!.likes).toMatchObject({ fontSize: 12.5, lineHeight: 18 });
    expect(sheet!.noLikes).not.toHaveProperty("lineHeight");
    expect(sheet!.noLikes).not.toHaveProperty("fontSize");
  });

  it("labels the print with the place and the date alone, without the member's @name", () => {
    expect(card).not.toMatch(/label\.credit|creditText|memberCredit/);
    const words = label.match(/\{label\.\w+\}/g) ?? [];
    expect(words).toEqual(["{label.place}", "{label.date}"]);
    expect(label).not.toMatch(/onOpenProfile|onMore/);
  });

  it("writes the caption after the member's name, as a comment is written", () => {
    // The name a link to the member's page, the words after it with every @name a link too (src/components/MemberText.tsx).
    expect(body).toMatch(
      /\{post\.caption \? \(\s*<Text style=\{styles\.caption\}>\s*<NameEdge name=\{post\.author\.username\} size=\{WORDS\} \/>\s*<NameLink username=\{post\.author\.username\} onOpenProfile=\{onOpenProfile\} style=\{styles\.author\} \/>\s*<Text style=\{styles\.nameGap\}>\{NAME_GAP\}<\/Text>\s*<MentionText text=\{post\.caption\} onOpenProfile=\{onOpenProfile\} size=\{WORDS\} \/>\s*<\/Text>\s*\) : null\}/,
    );
    expect(body).toMatch(
      /<Text style=\{styles\.comment\} numberOfLines=\{2\}>\s*<NameEdge name=\{c\.author\.username\} size=\{WORDS\} \/>\s*<NameLink\s+username=\{c\.author\.username\}\s+onOpenProfile=\{onOpenProfile\}\s+onLongPress=\{onCommentLongPress \? \(\) => onCommentLongPress\(c\) : undefined\}\s+style=\{styles\.author\}\s*\/>\s*<Text style=\{styles\.nameGap\}>\{NAME_GAP\}<\/Text>\s*<MentionText\s+text=\{c\.body\}\s+onOpenProfile=\{onOpenProfile\}\s+onLongPress=\{onCommentLongPress \? \(\) => onCommentLongPress\(c\) : undefined\}\s+size=\{WORDS\}\s*\/>\s*<\/Text>/,
    );
    // Who wrote it, as the header draws them: Cormorant Garamond Bold Italic, 16 pt, in the name ink; then 4 pt (a third of an em at 12 pt).
    // Before it, the room its first letter reaches into, where it reaches out (tests/editorial-name-room.test.ts).
    // Every @name in their words in the same face, at the words' size (src/components/MemberText.tsx).
    expect(original).toMatch(/\n {2}captionAuthor: \{ fontWeight: "600" \},/);
    expect(card).toMatch(/\n {2}author: \{ \.\.\.NAME, color: colors\.nameInk \},/);
    expect(sheet!.author).toEqual({ fontFamily: "CormorantGaramond-BoldItalic", fontSize: 16, fontWeight: "700", color: colors.nameInk });
    expect(card).toMatch(/const NAME_GAP = "\\u2004";/);
    expect(card).toMatch(/\n {2}nameGap: \{ fontSize: 12 \},/);
    // No weight or style of the card's own over the face: it is the bold italic itself, found by its PostScript name.
    expect(style("username")).not.toMatch(/fontWeight|fontStyle/);
    expect(card.match(/\n {2}author: \{[^\n]*\},/)?.[0]).not.toMatch(/fontWeight|fontStyle/);
  });

  it("keeps the print's margins for the print alone: the picture inset by the print's share of the width", () => {
    expect(card).toMatch(/const PRINT = exportLayout\(1, "print", PRINT_WIDTH\);/);
    expect(style("print")).toMatch(/paddingHorizontal: share\(PRINT\.margin\),/);
    // The picture is the print's; the card itself runs to the screen's sides.
    expect(body).toMatch(/<View style=\{styles\.print\}>\s*<PostMedia\b[\s\S]*?\/>\s*<\/View>/);
    expect(style("card")).not.toMatch(/paddingHorizontal|marginHorizontal/);
    // About 7% of the width, as on the member's print.
    expect(L.margin / PRINT_WIDTH).toBeGreaterThan(0.065);
    expect(L.margin / PRINT_WIDTH).toBeLessThan(0.075);
  });

  it("sets everything around the print where Instagram does: one edge on the left, the same on the right", () => {
    expect(card).toMatch(/const EDGE = 12;/);
    // The member, the label with its buttons, the caption, the comments and when it went up start EDGE in.
    for (const name of ["header", "label", "posted"]) {
      expect(style(name), name).toMatch(/paddingHorizontal: EDGE,/);
    }
    // The caption and the comments by margin: their names are links, and on the phone a link in padded words is tapped a padding away from where it is drawn (tests/name-link-hit-area.test.ts).
    for (const name of ["caption", "comment"]) {
      expect(style(name), name).toMatch(/marginHorizontal: EDGE,/);
      expect(style(name), name).not.toMatch(/padding/);
    }
    // The hairline runs between the same two edges.
    expect(style("rule")).toMatch(/marginHorizontal: EDGE,/);
    // Outlines, not targets, at the edge: the heart's on the left, the dots' on the right.
    expect(style("actions")).toMatch(/marginLeft: -INSET,/);
    expect(style("more")).toMatch(/marginRight: -\(TARGET - DOTS \* 0\.75\) \/ 2,/);
    // Your own photograph's count of likes starts there too: a line with no link in it, so by padding.
    expect(style("likes")).toMatch(/paddingHorizontal: EDGE,/);
    // And nothing else sets its own sides.
    const written = card.slice(card.indexOf("const styles = StyleSheet.create("));
    expect(written.match(/padding(Horizontal|Left|Right): /g)).toHaveLength(5);
    expect(written.match(/marginHorizontal: EDGE,/g)).toHaveLength(3);
  });

  it("sets the buttons and the place and the date where the print sets its label under the rule", () => {
    expect(card).toMatch(/const LABEL_TOP = PRINT\.place\.y - PRINT\.rule\.y;/);
    expect(style("label")).toMatch(/alignItems: "flex-start",/);
    expect(style("label")).toMatch(/marginTop: LABEL_TOP,/);
    // The outlines start level with the first line of the label; the targets reach up into the paper under the rule.
    expect(style("actions")).toMatch(/marginTop: -INSET,/);
    // The caption starts as far under the label's last line as under the buttons' outlines.
    expect(style("dateline")).toMatch(/paddingBottom: INSET,/);
    expect(card).not.toMatch(/UNDER_RULE|UNDER_WORDS/);
  });

  it("lies on the paper chosen, with nothing between one print and the next but that paper", () => {
    expect(card).toMatch(/const paper = paperStyle\(useFeedPaper\(\)\);/);
    expect(card).toMatch(/<View style=\{\[styles\.card, paper\]\} testID="editorial-post-card">/);
    expect(card).toMatch(/import \{ paperStyle, useFeedPaper \} from "@\/utils\/feedPaper";/);
    // No colour of its own, no strip of another paper, no frame and no shadow.
    expect(style("card")).not.toMatch(/backgroundColor|border/);
    expect(card).not.toMatch(/paperSunken|paperRaised|borderBottom|shadow|elevation/);
    // The one rounded thing on the card is the ring round the member's picture.
    expect(card.match(/borderRadius/g)).toHaveLength(1);
    expect(style("ring")).toMatch(/borderRadius: AVATAR \/ 2,/);
  });

  it("leaves about Instagram's gap between one post and the next, the same on any phone", () => {
    const { card: paper } = sheet!;
    expect(card).toMatch(/const FOOT = 14;/);
    expect(card).toMatch(/const HEAD = 4;/);
    // From the foot of one post's last line to the next member's picture, in points, not a share of the width.
    const between = Number(paper.paddingBottom) + Number(paper.paddingTop) + (44 - 34) / 2;
    expect(between).toBeGreaterThanOrEqual(20);
    expect(between).toBeLessThanOrEqual(28);
  });

  it("draws the rule under the picture as the print does", () => {
    expect(style("rule")).toMatch(/height: PRINT\.rule\.height,/);
    expect(style("rule")).toMatch(/backgroundColor: colors\.borderStrong,/);
    expect(print).toMatch(/rule: p\.borderStrong/);
  });

  it("leaves the print's paper between the picture and the rule, on any phone", () => {
    const { print: sheetOfPrint, rule } = sheet!;
    expect(card).toMatch(/const GAP = PRINT\.rule\.y - \(PRINT\.photo\.y \+ PRINT\.photo\.height\);/);
    const GAP = L.rule.y - (L.photo.y + L.photo.height);
    for (const width of [320, 390, 430]) {
      // The card is the print at the phone's width: at 390 pt the print's 29 pt gap comes to about 20.9 pt.
      expect(of(rule.marginTop, width)).toBeCloseTo((GAP * width) / PRINT_WIDTH, 1);
      // And the picture is the print's picture at that width.
      expect(width - 2 * of(sheetOfPrint.paddingHorizontal, width)).toBeCloseTo((L.photo.width * width) / PRINT_WIDTH, 1);
    }
  });

  it("takes only the print's own lengths as shares of the width; the rest is in points, as Instagram's", () => {
    const written = card.slice(card.indexOf("const styles = StyleSheet.create("));
    expect(written.match(/\bshare\(/g)).toHaveLength(3);
    expect(style("print")).toMatch(/paddingHorizontal: share\(PRINT\.margin\),/);
    expect(style("print")).toMatch(/paddingTop: share\(GAP\),/);
    expect(style("rule")).toMatch(/marginTop: share\(GAP\),/);
    expect(card).not.toMatch(/\binner\(/);
  });

  it("sets the place and the date right-aligned, in the print's typewriter lines and inks", () => {
    expect(card).toMatch(/function line\(box: TextBox\) \{\s*return \{\s*fontFamily: type\.mono,\s*fontSize: box\.size,\s*letterSpacing: box\.spacing,/);
    const lines: [string, string, string][] = [
      ["place", "PRINT.place", "inkSoft"],
      ["date", "PRINT.byline", "inkSoft"],
    ];
    for (const [name, box, ink] of lines) {
      expect(style(name), name).toContain(`...line(${box}),`);
      expect(style(name), name).toContain('textAlign: "right",');
      expect(style(name), name).toMatch(new RegExp(`color: colors\\.${ink}\\b`));
    }
    // The same inks the print gives its place and its date.
    expect(print).toMatch(/rect\(L\.place\),[\s\S]*?color: c\.inkSoft,/);
    expect(print).toMatch(/rect\(L\.byline\),[\s\S]*?color: c\.inkSoft,/);
    expect(style("dateline")).toMatch(/alignItems: "flex-end",/);
    // A long place takes a second line rather than pushing the date off.
    expect(card).toMatch(/style=\{styles\.place\} numberOfLines=\{2\}/);
  });

  it("sets the caption in the comments' own type", () => {
    const face = (rules: string) =>
      rules
        .split("\n")
        .filter((l) => /type\.body|fontSize|fontFamily|lineHeight|color/.test(l))
        .map((l) => l.trim());
    expect(face(style("caption"))).toEqual(face(style("comment")));
    // 12.5 pt: the visual height of the 16 pt italic names (the owner's restyle, 24 November, a size up from 11 and 14);
    // the body's own line spacing kept.
    expect(face(style("caption"))).toContain("fontSize: WORDS,");
    expect(card).toMatch(/\nconst WORDS = 12\.5;\n/);
    expect(style("caption")).not.toMatch(/lineHeight/);
    expect(style("caption")).not.toMatch(/type\.(serif|mono)/);
  });

  it("ends with when it went up, in the label's typewriter face a shade fainter", () => {
    // Last, after the caption and the comments, and once.
    expect(own).toMatch(/<PostedTime at=\{post\.created_at\} \/>\s*<\/View>\s*\);\s*\}\);?\s*$/);
    expect(card.match(/<PostedTime\b/g)).toHaveLength(1);
    // When it was posted, not when it was taken; said in full to a screen reader.
    expect(posted).toMatch(/accessibilityLabel=\{postedAgoSpoken\(at, now\)\}/);
    expect(posted).toMatch(/\{postedAgo\(at, now\)\}/);
    expect(posted).not.toMatch(/taken_at/);
    expect(posted).toMatch(/style=\{styles\.posted\}/);
    expect(style("posted")).toMatch(/\.\.\.line\(PRINT\.byline\),\s*color: colors\.inkFaint,/);
    // Written as it is said: 29m ago, never 29M AGO, which reads as months.
    expect(style("posted")).not.toMatch(/textTransform/);
  });

  it("follows the app's one clock for that line alone, and starts no timer of its own", () => {
    expect(posted).toMatch(/const now = new Date\(useMinute\(\)\);/);
    // Only the line follows the clock, so a tick draws the line again, not the card and its picture.
    const whole = card.slice(card.indexOf("export const EditorialPostCard = React.memo(function EditorialPostCard("), card.indexOf("function PostedTime("));
    expect(whole.length).toBeGreaterThan(0);
    expect(whole).not.toMatch(/useMinute\(/);
    expect(card.match(/useMinute\(/g)).toHaveLength(1);
    expect(card).not.toMatch(/\bset(Interval|Timeout)\(|\bAppState\b/);
    expect(card).toMatch(/import \{ postedAgo, postedAgoSpoken \} from "@\/utils\/time";/);
    expect(card).toMatch(/import \{ useMinute \} from "@\/utils\/useMinute";/);
  });

  it("keeps its typewriter lines on screen at the largest text sizes", () => {
    const mono = card.match(/<Text[^>]*styles\.(place|date|posted)\b[^>]*>/g) ?? [];
    expect(mono).toHaveLength(3);
    for (const t of mono) expect(t).toMatch(/maxFontSizeMultiplier=\{LABEL_CAP\}/);
    expect(card).toMatch(/const LABEL_CAP = 2;/);
    // The right-hand lines go under the buttons rather than off the edge, and ask for more room as they grow.
    expect(style("label")).toMatch(/flexWrap: "wrap",/);
    expect(style("dateline")).toMatch(/flexShrink: 1,/);
    expect(card).toMatch(/const scale = Math\.min\(Math\.max\(useWindowDimensions\(\)\.fontScale, 1\), LABEL_CAP\);/);
    expect(card).toMatch(/style=\{\[styles\.dateline, dateline\]\}/);
    expect(card).toMatch(/const dateline = \{ flexBasis: DATELINE \* scale \};/);
    // At the cap the longest date still fits across a 320 pt screen, inside the edges.
    // React Native grows the letters with Larger Text and leaves their tracking as set.
    const longest = "SEPTEMBER 30, 2026".length * (L.byline.size * 0.6 * 2 + L.byline.spacing);
    expect(longest).toBeLessThan(320 - 2 * 12);
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
    expect(card).toMatch(/onPress=\{\(\) => like\(!likedByMe\)\}\s*accessibilityRole="button"\s*accessibilityLabel=\{likedByMe \? "Unlike" : "Like"\}/);
  });

  it("calls what the screen passes in for the name, the \"…\", comments and sending", () => {
    expect(card).toMatch(/onPress=\{\(\) => onMore\(post\)\}\s*accessibilityRole="button"\s*accessibilityLabel="Post options"/);
    expect(card).toMatch(/onPress=\{\(\) => onOpenComments\(post\)\}\s*accessibilityRole="button"\s*accessibilityLabel="Comments"/);
    expect(card).toMatch(/onPress=\{\(\) => onShare\(post\)\}\s*accessibilityRole="button"\s*accessibilityLabel="Send to"/);
    expect(card.match(/onPress=\{\(\) => onOpenProfile\(post\.author\.username\)\}/g)).toHaveLength(1);
    // The same labels as the original card, for VoiceOver and the launch test alike.
    for (const name of ['"Post options"', '"Comments"', '"Send to"', '"Unlike" : "Like"']) {
      expect(original).toContain(name);
    }
  });

  it("decides nothing for itself", () => {
    expect(card).not.toMatch(/@\/api|supabase|usePostActions|useQuery|useState|useEffect/);
    expect(card).toMatch(/import \{ INLINE_COMMENTS, PostCard \} from "\.\.\/PostCard";/);
    expect(card).toMatch(/const preview = withAuthors\(comments \?\? \[\]\)\.slice\(-INLINE_COMMENTS\);/);
  });

  it("draws nothing for a post naming nobody, after its hooks and before anything reads a name", () => {
    // Row-level security can send a post without its author (src/components/hiddenAuthors.ts).
    const whole = card.slice(card.indexOf("function EditorialPostCard("), card.indexOf("interface Drawn {"));
    const guard = whole.indexOf("if (!authorShown(post)) return null;");
    expect(guard).toBeGreaterThan(-1);
    // Every hook above it, so they are called in the same order whatever the post.
    const hooks = whole.match(/\buse[A-Z]\w*\(/g) ?? [];
    expect(hooks.length).toBeGreaterThan(0);
    for (const hook of hooks) expect(whole.lastIndexOf(hook), hook).toBeLessThan(guard);
    // Nothing that reads the author before it: the label's words name the member too, and its pieces are drawn after.
    for (const reader of ["withAuthors(comments", "<PrintMember post={post}", "<PrintLabel post={post}>", "<PrintCaption post={post}"]) {
      expect(whole.indexOf(reader), reader).toBeGreaterThan(guard);
    }
    // The card itself reads no name: its pieces do, and they are drawn only past the guard, the label's hook with it.
    expect(whole).not.toMatch(/post\.author\./);
    expect(piece("PrintLabel")).toMatch(/const scale = Math\.min\(Math\.max\(useWindowDimensions\(\)\.fontScale, 1\), LABEL_CAP\);/);
    expect(card).toMatch(/^import \{ authorShown, withAuthors \} from "\.\.\/hiddenAuthors";$/m);
  });

  it("draws a post naming nobody as nothing, where it used to break the feed", async () => {
    const { createElement } = await import("react");
    // React's own server renderer draws it here, with nothing on screen: react-dom ships no types of its own.
    const server = "react-dom/server";
    const { renderToString } = (await import(/* @vite-ignore */ server)) as { renderToString: (element: unknown) => string };
    const { EditorialPostCard } = await import("@/components/feed/EditorialPostCard");
    const post = {
      id: "p1",
      author_id: "a1",
      caption: "The 19 tram",
      location: "Milan",
      taken_at: "2026-10-28T09:00:00Z",
      created_at: "2026-10-28T10:00:00Z",
      media_type: "photo",
      media_path: "a1/p1.jpg",
      thumb_path: null,
      width: 1200,
      height: 1500,
    };
    const props = (author: unknown) => ({
      post: { ...post, author },
      likedByMe: false,
      onToggleLike: () => undefined,
      onOpenComments: () => undefined,
      onOpenProfile: () => undefined,
      onMore: () => undefined,
      comments: [{ id: "c1", body: "Lovely", author: null }],
    });
    const draw = (author: unknown) =>
      renderToString(createElement(EditorialPostCard, props(author) as unknown as Parameters<typeof EditorialPostCard>[0]));
    expect(draw(null)).toBe("");
    // The same post with its author is drawn, its name and all: the card is not simply empty.
    expect(draw({ id: "a1", username: "elena.marchetti", full_name: null, avatar_url: null })).toContain("elena.marchetti");
  });

  it("gives every control a full target, a role and a name", () => {
    expect(card).toMatch(/const TARGET = 44;/);
    expect(style("button")).toMatch(/minWidth: TARGET,/);
    expect(style("button")).toMatch(/minHeight: TARGET,/);
    expect(style("member")).toMatch(/minHeight: TARGET,/);
    // Every control is a button with a name, a whole target wide: the
    // member, the heart, the comments, sending and the "…". A comment under
    // the picture is read out as its own words.
    // Your own photograph's count is a line of words that opens who liked it, as PostCard's is (above).
    const controls = (card.match(/<Pressable\b[\s\S]*?[^=]>(?=\s*\n)/g) ?? []).filter(
      (p) => !/key=\{c\.id\}/.test(p) && !/accessibilityLabel=\{likes\.label\}/.test(p),
    );
    expect(controls).toHaveLength(5);
    for (const control of controls) {
      expect(control).toMatch(/style=\{(styles\.member|styles\.button|\[styles\.button, styles\.more\])\}/);
      expect(control).toMatch(/accessibilityRole="button"/);
      expect(control).toMatch(/accessibilityLabel=/);
    }
    expect(card).toMatch(/testID="editorial-post-card"/);
  });
});

describe("a post on its way up, under Editorial", () => {
  const pending = code("src/components/feed/EditorialPendingCard.tsx");
  const card = code("src/components/feed/EditorialPostCard.tsx");
  const original = code("src/components/PendingPostCard.tsx");
  const feedCache = code("src/uploads/feedCache.ts");
  /** The card as it is drawn, from its outermost View to the end of EditorialPendingCard. */
  const body = pending.slice(pending.indexOf('testID="editorial-pending-card"'), pending.indexOf("const NO_WORDS ="));
  const at = (needle: string) => body.indexOf(needle);
  /** A rule of the card's own sheet, as written. */
  const rule = (source: string, name: string) =>
    source.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))?.[1] ?? source.match(new RegExp(`\\n  ${name}: \\{ ([^\\n]*?) \\},`))?.[1] ?? "";

  it("is the editorial card's own pieces, on its own sheet and paper", () => {
    expect(pending).toMatch(/<View style=\{\[printStyles\.card, paper\]\} testID="editorial-pending-card">/);
    expect(pending).toMatch(/const paper = paperStyle\(useFeedPaper\(\)\);/);
    expect(body).toMatch(/<View style=\{printStyles\.header\}>\s*<PrintMember post=\{post\} onOpenProfile=\{onOpenProfile\} \/>\s*<\/View>/);
    expect(body).toMatch(
      /<View style=\{printStyles\.print\}>\s*<PostMedia post=\{card\.media\} active=\{active && clipMayPlay\(state\)\} cachePolicy="memory" bare \/>\s*<\/View>/,
    );
    expect(body).toMatch(/<PrintLabel post=\{post\}>\s*<NoButtonsYet \/>\s*<\/PrintLabel>/);
    expect(body).toMatch(/<PrintCaption post=\{post\} onOpenProfile=\{onOpenProfile\} \/>/);
    // The line where the card will say when it went up, in that line's face and at its cap, so it is as tall.
    expect(body).toMatch(/<Text\s+maxFontSizeMultiplier=\{LABEL_CAP\}\s+style=\{printStyles\.posted\}\s+numberOfLines=\{1\}/);
    expect(pending).toMatch(/const NO_WORDS = "\\u00a0";/);
    // Every piece from the card itself, nothing drawn again here.
    expect(pending).toMatch(/import \{\s*EDGE,\s*LABEL_CAP,\s*LIKES_LINE,\s*NoButtonsYet,\s*PRINT,\s*PrintCaption,\s*PrintLabel,\s*PrintMember,\s*WORDS,\s*line,\s*printStyles,\s*\} from "\.\/EditorialPostCard";/);
    expect(pending).not.toMatch(/<Avatar\b|<NameLink\b|<MentionText\b|exportLabelText|nameStyle|useNameFace/);
  });

  it("sets out its rows in the card's order, with what is not yet so left as paper or saying so", () => {
    const order = [
      "<View style={printStyles.header}>",
      "<PostMedia",
      "<ProgressRule fraction={card.fraction} look={RULE} />",
      "<PrintLabel post={post}>",
      "<PendingStatus pending={pending} card={card} focused={focused} look={STATUS} />",
      "{card.failed && pending.error ?",
      "<PrintCaption",
      "{withWhom ?? NO_WORDS}",
    ];
    const seen = order.map(at);
    order.forEach((needle, i) => expect(seen[i], needle).toBeGreaterThan(-1));
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it("is the post as it will be saved, so the label and the caption do not change when the row takes its place", () => {
    expect(pending).toMatch(/author: draft\.author,\s*caption: draft\.caption\.trim\(\),\s*location: clampLocation\(draft\.location\),\s*taken_at: draft\.takenAt,\s*created_at: card\.createdAt,/);
    // The row the feed is handed (src/uploads/feedCache.ts).
    expect(feedCache).toMatch(/caption: draft\.caption\.trim\(\),/);
    expect(feedCache).toMatch(/taken_at: draft\.takenAt,/);
    expect(feedCache).toMatch(/location: clampLocation\(draft\.location\),/);
    expect(feedCache).toMatch(/like_count: 0,/);
  });

  it("offers nothing to like, comment on, send or open, and never reads as posted", () => {
    expect(pending).not.toMatch(/onDoubleTap|onToggleLike|onOpenComments|onShare|onMore|onOpenLikes|likesLine|PostedTime|postedAgo|useMinute/);
    expect(pending).not.toMatch(/"Like"|"Unlike"|"Comments"|"Send to"|"Post options"/);
    expect(pending).not.toMatch(/from "\.\.\/PostCard"|EditorialPostCard\b(?! *")/);
    // The buttons' room is the three buttons' own, left as paper and hidden from VoiceOver.
    expect(card).toMatch(/export function NoButtonsYet\(\) \{\s*return <View style=\{\[styles\.actions, styles\.noButtons\]\} importantForAccessibility="no-hide-descendants" \/>;\s*\}/);
    expect(card).toMatch(/const BUTTONS = 3;/);
    expect(card).toMatch(/\n {2}noButtons: \{ width: BUTTONS \* TARGET, height: TARGET \},/);
    // Home gives every card all three, the send button with them.
    expect(code("app/(tabs)/index.tsx")).toMatch(/onShare=\{onShare\}/);
    // The last line is hidden from VoiceOver while it holds nothing.
    expect(body).toMatch(/accessible=\{withWhom != null\}\s*importantForAccessibility=\{withWhom == null \? "no-hide-descendants" : "auto"\}/);
  });

  it("says and does exactly what the original pending card does: the same hook, the same line, the same rule", () => {
    expect(pending).toMatch(/const card = usePendingCard\(pending, focused\);/);
    expect(original).toMatch(/const card = usePendingCard\(pending, focused\);/);
    expect(original).toMatch(/<PendingStatus pending=\{pending\} card=\{card\} focused=\{focused\} \/>/);
    expect(original).toMatch(/<ProgressRule fraction=\{card\.fraction\} \/>/);
    expect(pending).toMatch(/import \{ PendingStatus, ProgressRule, usePendingCard, type PendingCardProps, type StatusLook \} from "\.\.\/PendingPostCard";/);
    // Only the hook speaks, holds and discards; neither card does it itself.
    for (const source of [pending, original.slice(original.indexOf("export function PendingPostCard("), original.indexOf("export interface PendingCardState"))]) {
      expect(source).not.toMatch(/announceForAccessibility|holdPost|discardPost|retryPost|showAlert/);
    }
    expect(original.match(/announceForAccessibility\(/g)).toHaveLength(1);
    // Focus and the clip as the original has them.
    expect(pending).toMatch(/export function EditorialPendingCard\(\{ pending, active = false, focused = true, onOpenProfile \}: Props\)/);
  });

  it("puts its line where your own post's count will be, at the count's height, in the label's typewriter face", () => {
    expect(rule(pending, "row")).toMatch(/minHeight: LIKES_LINE,/);
    expect(rule(pending, "row")).toMatch(/paddingHorizontal: EDGE,/);
    // Wrapping, it gains a line's height and no gap between lines.
    expect(rule(pending, "row")).toMatch(/columnGap: spacing\.sm,/);
    expect(rule(pending, "row")).not.toMatch(/\bgap:|rowGap/);
    for (const name of ["state", "action", "dot"]) {
      expect(rule(pending, name), name).toMatch(/\.\.\.line\(PRINT\.byline\),/);
      expect(rule(pending, name), name).toMatch(/lineHeight: LIKES_LINE,/);
    }
    expect(rule(card, "likes")).toMatch(/lineHeight: LIKES_LINE,/);
    // With Larger Text the line grows as far as the count's line and the label do, no further, so it keeps their
    // height at every size: every word in it is capped at LABEL_CAP, as the count and the lines it hands off to are.
    expect(pending).toMatch(/const STATUS: StatusLook = \{[^}]*\n {2}cap: LABEL_CAP,\n\};/);
    expect(original).toMatch(/\n {2}cap\?: number;\n\}/);
    const status = original.slice(original.indexOf("export function PendingStatus("), original.indexOf("export function ProgressRule("));
    const words = status.match(/<Text\b[^>]*>/g) ?? [];
    expect(words).toHaveLength(4);
    for (const t of words) expect(t, t).toMatch(/^<Text maxFontSizeMultiplier=\{set\.cap\} /);
    const likes = card.match(/<Text[^>]*styles\.likes\b[^>]*>/g) ?? [];
    expect(likes).toHaveLength(2);
    for (const t of likes) expect(t, t).toMatch(/maxFontSizeMultiplier=\{LABEL_CAP\}/);
    expect(body).toMatch(/<Text\s+maxFontSizeMultiplier=\{LABEL_CAP\}\s+style=\{printStyles\.posted\}/);
    // The original card's line sets no cap: ORIGINAL_STATUS has none.
    const originalLook = original.slice(original.indexOf("const ORIGINAL_STATUS: StatusLook = {"));
    expect(originalLook.slice(0, originalLook.indexOf("};"))).not.toMatch(/cap:/);
    // The hairline is the card's rule, holding the accent as it fills, faint while it waits.
    expect(pending).toMatch(/const RULE = \{ track: \[printStyles\.rule, styles\.track\], fill: styles\.fill, paused: styles\.paused \};/);
    expect(rule(pending, "track")).toBe("overflow: \"hidden\"");
    expect(rule(pending, "fill")).toMatch(/height: "100%", backgroundColor: colors\.accent/);
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

  it("offers the two papers as a radio group, Off-white first, only while Editorial is chosen", () => {
    const shown = settings.indexOf('{feedLayout === "editorial" ? (');
    const group = settings.slice(shown);
    expect(shown).toBeGreaterThan(settings.indexOf('accessibilityLabel="Feed layout"'));
    expect(group).toMatch(/^\{feedLayout === "editorial" \? \(\s*<>\s*<View style=\{\[styles\.settingText, styles\.subSetting\]\}>\s*<Text style=\{styles\.prefLabel\}>Paper<\/Text>/);
    expect(group).toMatch(/accessibilityRole="radiogroup" accessibilityLabel="Paper">\s*\{FEED_PAPERS\.map\(/);
    expect(group).toMatch(/onPress=\{\(\) => setFeedPaper\(value\)\}\s*accessibilityRole="radio"\s*accessibilityState=\{\{ selected: on \}\}/);
    // The whole of it is inside the condition.
    expect(group.indexOf(") : null}")).toBeGreaterThan(group.indexOf("FEED_PAPERS.map("));
    expect(settings).toMatch(/const feedPaper = useFeedPaper\(\);/);
    expect(settings).toMatch(/const on = feedPaper === value;/);
  });

  it("puts them under Appearance, before the profile's Save", () => {
    const appearance = settings.indexOf(">Appearance<");
    const layout = settings.indexOf(">Feed layout<");
    const paper = settings.indexOf(">Paper<");
    const save = settings.indexOf('<Button title="Save"');
    expect(appearance).toBeGreaterThan(0);
    expect(layout).toBeGreaterThan(appearance);
    expect(paper).toBeGreaterThan(layout);
    expect(save).toBeGreaterThan(paper);
  });
});
