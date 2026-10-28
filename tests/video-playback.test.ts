import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Video playback, read from the source.
 *
 * iOS gives an app a few hardware decoders, and a player too many leaves
 * a clip on a black frame; Home plays well because its players are made
 * ahead of the reader and only the card on screen plays. These pin the
 * lines that keep it so: Home's rule, the clip's own play, pause and
 * nudge, the gallery's warm window, and the short list of places allowed
 * to make a player at all.
 */

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

describe("Home", () => {
  const home = code("app/(tabs)/index.tsx");

  it("plays only the card on screen, while Home is in front", () => {
    expect(home).toMatch(/const focused = useIsFocused\(\)/);
    expect(home).toMatch(/active=\{focused && item\.id === visibleId\}/);
    expect(home).toMatch(/itemVisiblePercentThreshold: 60/);
    expect(home).toMatch(/minimumViewTime: 120/);
    expect(home).toMatch(/onViewableItemsChanged=\{onViewableItemsChanged\}/);
  });

  it("never holds a clip back from its player", () => {
    for (const card of tags(home, "PostCard")) expect(card).not.toMatch(/\bwarm=/);
    expect(home).not.toMatch(/\bwarm\b/);
  });
});

describe("the pending card and the single post", () => {
  it("always have their player", () => {
    const pending = code("src/components/PendingPostCard.tsx");
    const detail = code("app/post/[id].tsx");
    for (const media of [...tags(pending, "PostMedia"), ...tags(detail, "PostMedia")]) {
      expect(media).not.toMatch(/\bwarm=/);
    }
    expect(tags(pending, "PostMedia")).toHaveLength(1);
    expect(tags(detail, "PostMedia")).toHaveLength(1);
  });

  it("keeps the single post's clip playing while it is in front", () => {
    expect(tags(code("app/post/[id].tsx"), "PostMedia")[0]).toMatch(/active=\{focused\}/);
  });
});

describe("PostMedia", () => {
  const media = code("src/components/PostMedia.tsx");

  it("gives a clip its player unless told otherwise", () => {
    expect(media).toMatch(/^\s*warm = true,$/m);
    expect(media).toMatch(/warm\?: boolean;/);
  });

  it("draws a clip without a player in the same frame, as its poster", () => {
    const branch = media.slice(media.indexOf("if (isVideo) {"), media.indexOf("const url = mediaUrl(\"media\", post.media_path);"));
    expect(branch).toMatch(/<View style=\{frame\}>\s*\{warm \? \(\s*<VideoMedia/);
    expect(branch).toMatch(/\) : \(\s*<VideoPoster/);
    // The frame's height comes from the post's proportions alone, whichever is drawn in it.
    expect(media).toMatch(/const frame = \[styles\.media, bare && styles\.bare, \{ aspectRatio: ratio \}\];/);
    const poster = media.slice(media.indexOf("function VideoPoster"), media.indexOf("const useClipTiming"));
    expect(poster.length).toBeGreaterThan(0);
    expect(poster).not.toMatch(/useVideoPlayer|VideoView|useEvent/);
    expect(poster).toMatch(/mediaUrl\("thumbnails", poster\)/);
    expect(poster).toMatch(/onPress=\{onPress\}/);
  });

  it("plays and pauses a clip on `active`, and asks again once it is ready", () => {
    const video = media.slice(media.indexOf("function VideoMedia"), media.indexOf("function VideoPoster"));
    expect(video).toMatch(/if \(active\) player\.play\(\);\s*else player\.pause\(\);/);
    expect(video).toMatch(/p\.muted = true/);
    expect(video).toMatch(/p\.audioMixingMode = "duckOthers"/);
    expect(video).toMatch(/p\.staysActiveInBackground = false/);
    expect(video).toMatch(/status === "readyToPlay" && active && !player\.playing/);
    expect(video.match(/retried\.current = true/g)).toHaveLength(1);
    expect(video).toMatch(/activeRef\.current && player\.play\(\)/);
  });

  it("times clips in a development build only", () => {
    expect(media).toMatch(/const useClipTiming: \([\s\S]*?\) => void = clipTiming\s*\?/);
    expect(media).toMatch(/: \(\) => undefined;/);
    const timing = code("src/utils/videoTiming.ts");
    expect(timing).toMatch(/export const clipTiming: ClipTimer \| null = perfEnabled\(\) \? createClipTimer\(\) : null;/);
  });
});

describe("the feed card", () => {
  const card = code("src/components/PostCard.tsx");

  it("passes the gallery's word on to its picture, and has a player by default", () => {
    expect(card).toMatch(/^\s*warm = true,$/m);
    const media = tags(card, "PostMedia")[0] ?? "";
    expect(media).toMatch(/warm=\{warm\}/);
    expect(media).toMatch(/active=\{active\}/);
  });
});

describe("the gallery", () => {
  const gallery = code("app/gallery.tsx");

  it("still plays only the card on screen, once it has landed", () => {
    expect(gallery).toMatch(/active=\{ready && focused && item\.id === visibleId\}/);
  });

  it("still draws every card above the tapped one to measure them", () => {
    expect(gallery).toMatch(/initialNumToRender=\{Math\.min\(startIndex \+ 3, MEASURE_LIMIT\)\}/);
  });

  it("gives a player only to the clips around the card on screen", () => {
    const card = tags(gallery, "PostCard")[0] ?? "";
    expect(card).toMatch(/warm=\{isWarm\(index, warm\)\}/);
    expect(gallery).toMatch(/renderItem=\{\(\{ item, index \}\) =>/);
    expect(gallery).toMatch(/warmWindow\(\{ ready, startIndex, seenIndex: seenIndex < 0 \? null : seenIndex, count: posts\.length \}\)/);
    // What is reported on screen while the list is hidden and measuring does not move the window.
    expect(gallery).toMatch(/if \(id && readyRef\.current\) setSeenId\(id\);/);
  });
});

describe("the timeline's inspector", () => {
  const inspector = code("src/components/PhotoInspector.tsx");

  it("mounts a film only on the page on screen", () => {
    expect(inspector).toMatch(/\{active \? \(\s*<Film /);
  });

  it("asks a film to play again once it is ready, as the feed does", () => {
    const film = inspector.slice(inspector.indexOf("function Film"));
    expect(film).toMatch(/useEvent\(player, "statusChange"/);
    expect(film).toMatch(/if \(status === "readyToPlay" && !player\.playing\) player\.play\(\);/);
  });
});

describe("players", () => {
  const ALLOWED: Record<string, { count: number }> = {
    "src/components/PostMedia.tsx": { count: 1 },
    "src/components/PhotoInspector.tsx": { count: 1 },
    "app/compose.tsx": { count: 1 },
  };

  it("are made only where the list says, one place in each", () => {
    const found: Record<string, number> = {};
    for (const file of [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))]) {
      const rel = path.relative(root, file).split(path.sep).join("/");
      const n = code(rel).match(/\b(?:useVideoPlayer|createVideoPlayer)\(|\bnew VideoPlayer\b/g)?.length ?? 0;
      if (n > 0) found[rel] = n;
    }
    expect(found).toEqual(Object.fromEntries(Object.entries(ALLOWED).map(([f, { count }]) => [f, count])));
  });

  it("in PostMedia belong to VideoMedia alone", () => {
    const media = code("src/components/PostMedia.tsx");
    const video = media.slice(media.indexOf("function VideoMedia"), media.indexOf("function VideoPoster"));
    expect(video).toMatch(/useVideoPlayer\(url,/);
  });
});

describe("the profiles", () => {
  // The author is aged as the profile row it is: a member's page has that
  // row's own age; your own page's session profile has none, so 0.
  const authorAge: Record<string, string> = {
    "app/(tabs)/profile.tsx": "0",
    "app/user/[username].tsx": "profileQ.dataUpdatedAt",
  };
  for (const [file, age] of Object.entries(authorAge)) {
    const screen = code(file);
    const open = screen.slice(screen.indexOf("const openPost = "), screen.indexOf("};", screen.indexOf("const openPost = ")));

    it(`hand the next screen what they hold, before opening it (${file})`, () => {
      expect(open).toMatch(/seedPost\(queryClient, p, profile, posts?Q?\.dataUpdatedAt\);[\s\S]*?router\.push\(`\/post\/\$\{p\.id\}`\)/);
      expect(open).toMatch(/seedAuthor\([^)]*\);[\s\S]*?router\.push\(\{ pathname: "\/gallery"/);
    });

    it(`age the author by its own row, in the post and the era alike (${file})`, () => {
      const seeds = screen.match(/seedAuthor\([^)]*\)/g);
      expect(seeds).toEqual([`seedAuthor(queryClient, profile, ${age})`, `seedAuthor(queryClient, profile, ${age})`]);
    });

    it(`time a tap only in a development build (${file})`, () => {
      expect(screen).not.toMatch(/clipTiming[!.]/);
      expect(screen).toMatch(/clipTiming\?\.asked\(p, "gallery"\)/);
    });
  }
});
