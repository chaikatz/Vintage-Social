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
 * PostCard's are.
 */

const phone = { files: new Map<string, string>() };

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
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

const {
  FEED_LAYOUTS,
  getFeedLayout,
  parseFeedLayout,
  setFeedLayout,
  __resetFeedLayoutForTest,
  __subscribeForTest,
} = await import("@/utils/feedLayout");

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

  it("takes exactly PostCard's props", () => {
    expect(card).toMatch(/type Props = React\.ComponentProps<typeof PostCard>;/);
    expect(card).toMatch(/export function EditorialPostCard\(\{[\s\S]*?\}: Props\)/);
  });

  it("puts nothing above the photograph: the member, the place and date, and the \"…\" come under it", () => {
    const body = card.slice(card.indexOf('testID="editorial-post-card"'));
    const at = (needle: string) => body.indexOf(needle);
    expect(at("<PostMedia")).toBeGreaterThan(-1);
    for (const after of ["<Avatar", "{post.author.username}", "<Byline post={post} />", 'accessibilityLabel="Post options"', "{post.caption}"]) {
      expect(at(after)).toBeGreaterThan(at("<PostMedia"));
    }
    // The member over the dateline, then the words, then the buttons.
    expect(at("<Byline post={post} />")).toBeGreaterThan(at("{post.author.username}"));
    expect(at("{post.caption}")).toBeGreaterThan(at('accessibilityLabel="Post options"'));
    expect(at('accessibilityLabel={likedByMe ? "Unlike" : "Like"}')).toBeGreaterThan(at("{post.caption}"));
  });

  it("sets the caption in the comments' own type", () => {
    const style = (name: string) => card.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\}`))?.[1] ?? "";
    const face = (rules: string) => rules.split("\n").filter((l) => /type\.body|fontSize|fontFamily|lineHeight|color/.test(l)).map((l) => l.trim());
    expect(face(style("caption"))).toEqual(face(style("comment")));
    expect(face(style("caption"))).toContain("fontSize: 14,");
    expect(style("caption")).not.toMatch(/type\.serif/);
  });

  it("keeps its counts on screen at the largest text sizes", () => {
    const counts = card.match(/<Text[^>]*styles\.countText[^>]*>/g) ?? [];
    expect(counts).toHaveLength(3);
    for (const t of counts) expect(t).toMatch(/maxFontSizeMultiplier=\{COUNT_CAP\}/);
    expect(card).toMatch(/const COUNT_CAP = 2;/);
  });

  it("draws the picture exactly as PostCard does: the same frame, the same double tap, the same playback", () => {
    const mine = tags(card, "PostMedia");
    expect(mine).toHaveLength(1);
    expect(flat(mine[0])).toBe(flat(tags(original, "PostMedia")[0] ?? ""));
    expect(mine[0]).toMatch(/onDoubleTap=\{\(\) => like\(true\)\}/);
    expect(mine[0]).toMatch(/active=\{active\}/);
    expect(mine[0]).toMatch(/warm=\{warm\}/);
    expect(card).toMatch(/^\s*active = true,$/m);
    expect(card).toMatch(/^\s*warm = true,$/m);
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
    expect(card).toMatch(/onPress=\{\(\) => onOpenProfile\(post\.author\.username\)\}/);
    // The same labels as the original card, for VoiceOver and the launch test alike.
    for (const label of ['"Post options"', '"Comments"', '"Send to"', '"Unlike" : "Like"']) {
      expect(original).toContain(label);
    }
  });

  it("decides nothing for itself", () => {
    expect(card).not.toMatch(/@\/api|supabase|usePostActions|useQuery|useState|useEffect/);
    expect(card).toMatch(/import \{ Byline, INLINE_COMMENTS, PostCard \} from "\.\.\/PostCard";/);
    expect(card).toMatch(/const preview = \(comments \?\? \[\]\)\.slice\(-INLINE_COMMENTS\);/);
  });

  it("gives every button a full target", () => {
    expect(card).toMatch(/const TARGET = 44;/);
    const button = /button: \{[\s\S]*?\}/.exec(card)?.[0] ?? "";
    expect(button).toMatch(/minWidth: TARGET,/);
    expect(button).toMatch(/minHeight: TARGET,/);
    const count = /count: \{[\s\S]*?\}/.exec(card)?.[0] ?? "";
    expect(count).toMatch(/minWidth: TARGET,/);
    expect(count).toMatch(/minHeight: TARGET,/);
    for (const label of ["Post options", "Comments", "Send to"]) {
      expect(card).toMatch(new RegExp(`<Pressable style=\\{styles\\.button\\}[^\\n]*accessibilityLabel="${label}"`));
    }
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
