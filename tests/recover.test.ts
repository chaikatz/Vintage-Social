import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { forgetUnwatchedReads } from "@/components/recoverReads";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
/** A file's code without its comments, so a guard reads what runs. */
const code = (file: string) =>
  read(file)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * A page that breaks while it is drawn. Without a boundary React gives up
 * on the whole tree, which in a release build closes the app. The web
 * walk (e2e/recover-test.mjs) breaks a page on purpose and sees these in
 * the browser; here, that every one is in place and says nothing but ours.
 */
describe("the recover pages", () => {
  const recover = read("src/navigation/Recover.tsx");

  it("stand in for the whole app, and for each screen of ours that draws rows from the server", () => {
    expect(read("app/_layout.tsx")).toMatch(/^export \{ RecoverApp as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    for (const screen of [
      "app/(tabs)/activity.tsx",
      "app/(tabs)/search.tsx",
      // One bad row on these used to take the member out to the whole app's page. A tab's
      // page is left by the tab bar.
      "app/(tabs)/index.tsx",
      "app/(tabs)/profile.tsx",
      "app/(tabs)/create.tsx",
    ]) {
      expect(read(screen), screen).toMatch(/^export \{ RecoverPage as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    }
  });

  it("put the way back on the page where the header cannot be counted on for it", () => {
    // A screen opened straight from a link is the first in its stack, with no back button;
    // the editor hides its back button while a post develops, and its back swipe is off; a
    // sheet has no back button.
    for (const screen of [
      "app/post/[id].tsx",
      "app/user/[username].tsx",
      // The inbox, a conversation and a photograph's comments: opened from a notification or
      // a link, each is the first in its stack. Their recover page used to offer Try again alone.
      "app/messages/index.tsx",
      "app/messages/[id].tsx",
      "app/comments.tsx",
      "app/gallery.tsx",
      "app/memories.tsx",
      "app/library-picker.tsx",
      "app/settings.tsx",
      "app/invites.tsx",
      "app/requests.tsx",
      "app/blocked.tsx",
      "app/likes.tsx",
      "app/compose.tsx",
      "app/export.tsx",
    ]) {
      expect(read(screen), screen).toMatch(/^export \{ RecoverPageWithBack as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    }
    // The Memory Room has no header at all, and its back swipe is the left edge alone.
    expect(read("app/darkroom.tsx")).toMatch(/^export \{ RecoverRoom as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    expect(recover).toMatch(/export function RecoverPageWithBack\(props: ErrorBoundaryProps\) \{\s*return <RecoverPage \{\.\.\.props\} withBack \/>;/);
    expect(recover).toMatch(
      /export function RecoverRoom\(props: ErrorBoundaryProps\) \{\s*const insets = useSafeAreaInsets\(\);\s*return <RecoverPage \{\.\.\.props\} withBack top=\{insets\.top\} \/>;/,
    );
    expect(recover).toMatch(/\{withBack \? <GoBack \/> : null\}/);
    // Back where the member came from, or Home when the screen was opened from a notification.
    expect(recover).toMatch(/function leave\(\) \{\s*if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\("\/\(tabs\)"\);\s*\}/);
    expect(recover).toMatch(/<Pressable onPress=\{leave\}[^>]*accessibilityRole="button">\s*<Text style=\{styles\.retryText\}>Go back<\/Text>/);
    // Clear of the status bar where there is no header to start under.
    expect(recover).toMatch(/style=\{\[styles\.screen, top > 0 && \{ paddingTop: top \+ PAGE_TOP \}\]\}/);
  });

  it("say it in our words, never the runtime's, and offer one thing to do", () => {
    // The error is for the development log only.
    expect(recover).not.toMatch(/\{error\.(message|stack|name)\}/);
    expect(recover).toMatch(/if \(typeof __DEV__ !== "undefined" && __DEV__\) console\.error\(/);
    expect(recover).toContain("Nothing you’ve posted is lost.");
    expect(recover.match(/<TryAgain onPress=\{tryAgain\} disabled=\{trying\} \/>/g)).toHaveLength(2);
  });

  it("draw in the theme's own ink and paper, in either print", () => {
    const styles = recover.slice(recover.indexOf("StyleSheet.create"));
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    expect(styles).toMatch(/backgroundColor: colors\.paper,/);
  });

  it("a screen's tries again from reads made afresh, not from the row it broke on", () => {
    // RecoverPageWithBack and RecoverRoom are RecoverPage, so all three do.
    expect(code("src/navigation/Recover.tsx")).toMatch(
      /export function RecoverPage\(\{ error, retry, withBack = false, top = 0 \}: PageProps\) \{\s*useLogged\(error\);\s*const \{ trying, tryAgain \} = useRetry\(\(\) => \{\s*forgetUnwatchedReads\(queryClient\);\s*return retry\(\);\s*\}\);/,
    );
    expect(recover).toMatch(/^import \{ forgetUnwatchedReads \} from "@\/components\/recoverReads";$/m);
  });

  it("the whole app's opens afresh: every read made again, not drawn from what broke", () => {
    expect(recover).toMatch(/useRetry\(\(\) => \{\s*queryClient\.clear\(\);\s*return retry\(\);\s*\}\)/);
    // Drawn where the providers have gone down with the layout: it reads none of them.
    expect(recover).not.toMatch(/useSession|useQueryClient|useRouter/);
  });
});

/**
 * A screen that broke on a bad row its read brought. react-query reads
 * again only once a screen is on screen, and a screen that breaks as it is
 * drawn never is: drawn again from the same cache, it broke again at once,
 * and Try again did nothing until the cache let go of the row by itself.
 * Here the cache as it stands when the member taps Try again: the broken
 * screen was on screen once and its boundary has taken it down, and the
 * screen under it in the stack is still watching its own read.
 */
describe("trying again on a screen's recover page", () => {
  const bad = { id: "p1", author: null };
  const good = { id: "p1", author: { username: "elena" } };

  function scene() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    let reads = 0;
    const post = {
      queryKey: ["post", "p1"],
      queryFn: async () => {
        reads += 1;
        return good;
      },
    };
    const feed = { queryKey: ["feed", "me"], queryFn: async () => [{ id: "p0" }] };
    client.setQueryData(post.queryKey, bad);
    client.setQueryData(feed.queryKey, [{ id: "p0" }]);
    // The screen under it, still on screen.
    const under = new QueryObserver(client, feed);
    const leave = under.subscribe(() => undefined);
    // The broken screen: on screen once, then caught by its boundary.
    new QueryObserver(client, post).subscribe(() => undefined)();
    /** The screen drawn again: what its read hands it as it is drawn, before it is on screen. */
    const redraw = () => {
      const observer = new QueryObserver(client, post);
      return { observer, drawn: observer.getOptimisticResult(client.defaultQueryOptions(post)).data };
    };
    return { client, redraw, reads: () => reads, leave };
  }

  it("left alone, the screen is drawn again from the row it broke on, and never read again", () => {
    const { redraw, reads, leave } = scene();
    expect(redraw().drawn).toBe(bad);
    expect(reads()).toBe(0);
    leave();
  });

  it("lets go of the broken screen's reads, so it is drawn from a read made afresh", async () => {
    const { client, redraw, reads, leave } = scene();
    forgetUnwatchedReads(client);
    const { observer, drawn } = redraw();
    // Drawn waiting, as it was the first time it opened, and read once it is on screen.
    expect(drawn).toBeUndefined();
    const stop = observer.subscribe(() => undefined);
    await vi.waitFor(() => expect(observer.getCurrentResult().data).toBe(good));
    expect(reads()).toBe(1);
    stop();
    leave();
  });

  it("keeps every read a screen still on screen watches", () => {
    const { client, leave } = scene();
    forgetUnwatchedReads(client);
    expect(client.getQueryData(["feed", "me"])).toEqual([{ id: "p0" }]);
    expect(client.getQueryData(["post", "p1"])).toBeUndefined();
    leave();
  });
});
