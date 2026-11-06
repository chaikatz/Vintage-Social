import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

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
      "app/messages/index.tsx",
      "app/messages/[id].tsx",
      "app/comments.tsx",
      "app/memories.tsx",
      "app/(tabs)/activity.tsx",
      "app/(tabs)/search.tsx",
      // One bad row on these used to take the member out to the whole app's page.
      "app/(tabs)/index.tsx",
      "app/(tabs)/profile.tsx",
      "app/(tabs)/create.tsx",
      "app/post/[id].tsx",
      "app/user/[username].tsx",
      "app/gallery.tsx",
      "app/library-picker.tsx",
      "app/settings.tsx",
      "app/invites.tsx",
      "app/requests.tsx",
      "app/blocked.tsx",
      "app/likes.tsx",
    ]) {
      expect(read(screen), screen).toMatch(/^export \{ RecoverPage as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    }
  });

  it("put the way back on the page where the header cannot be counted on for it", () => {
    // The editor hides its back button while a post develops, and its back swipe is off; a sheet has no back button.
    for (const screen of ["app/compose.tsx", "app/export.tsx"]) {
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

  it("the whole app's opens afresh: every read made again, not drawn from what broke", () => {
    expect(recover).toMatch(/useRetry\(\(\) => \{\s*queryClient\.clear\(\);\s*return retry\(\);\s*\}\)/);
    // Drawn where the providers have gone down with the layout: it reads none of them.
    expect(recover).not.toMatch(/useSession|useQueryClient|useRouter/);
  });
});
