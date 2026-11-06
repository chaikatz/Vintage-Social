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
    ]) {
      expect(read(screen), screen).toMatch(/^export \{ RecoverPage as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    }
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
