import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A message thread reaches the member it is with: their profile from the
 * title, and Report member and Block member from a "…" beside it, as on
 * their profile (App Review Guideline 1.2: a way to report and to block
 * from where unwelcome content arrives). The thread had only a title, and
 * a member sent something unwelcome had to leave it, find the sender in
 * Search and open their profile to do either. Seen working in the web
 * demo by e2e/launch-test.mjs.
 */

const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");
const thread = read("app/messages/[id].tsx");
const profile = read("app/user/[username].tsx");

describe("the thread's header", () => {
  it("has a \"…\" once the member is known, and a title that opens their profile", () => {
    expect(thread).toMatch(/const peer = peerQ\.data \?\? null;/);
    expect(thread).toMatch(
      /headerRight: peer\s*\?\s*\(\) => \(\s*<Pressable onPress=\{threadMenu\} hitSlop=\{10\} accessibilityRole="button" accessibilityLabel="More">\s*<Feather name="more-horizontal" size=\{20\} color=\{colors\.ink\} \/>/,
    );
    expect(thread).toMatch(/headerTitle: peer\s*\?\s*\(\{ children, tintColor \}\) => \(\s*<Pressable onPress=\{openProfile\}[^>]*accessibilityRole="link"/);
    // Drawn as the stack draws a title: its serif at its size, over its own bold.
    expect(thread).toMatch(/<HeaderTitle tintColor=\{tintColor\} style=\{\[styles\.title,/);
    expect(thread).toMatch(/title: \{ fontFamily: type\.serif, fontSize: 17 \}/);
    expect(read("app/_layout.tsx")).toMatch(/headerTitleStyle: \{ fontFamily: type\.serif, fontSize: 17 \}/);
    expect(thread).toMatch(/const openProfile = useCallback\(\(\) => \{\s*if \(peer\) router\.push\(`\/user\/\$\{peer\.username\}`\);/);
  });

  it("offers View profile, Report member and Block member, as the profile's own menu does", () => {
    const menu = thread.slice(thread.indexOf("const threadMenu = useCallback("), thread.indexOf("const send = useMutation("));
    expect(menu).toMatch(/showAlert\(peer\.username, undefined, \[\s*\{ text: "View profile", onPress: openProfile \},/);
    expect(menu).toMatch(
      /text: "Report member",\s*style: "destructive",\s*onPress: \(\) => router\.push\(\{ pathname: "\/report", params: \{ targetType: "profile", profileId: peer\.id \} \}\),/,
    );
    // The profile screen's words for a block, the same in both.
    const words = /"They won't see your photographs or profile[^"]*"/;
    const said = words.exec(profile)?.[0];
    expect(said).toBeTruthy();
    expect(menu).toContain(said!);
    expect(menu).toMatch(/`Block \$\{peer\.username\}\?`/);
    // Block member asks first: its tap opens the question, and only the
    // question's Block blocks.
    expect(menu).toMatch(
      /\{\s*text: "Block member",\s*style: "destructive",\s*onPress: \(\) =>\s*showAlert\(\s*`Block \$\{peer\.username\}\?`,/,
    );
    expect(menu).toMatch(/\{ text: "Block", style: "destructive", onPress: \(\) => block\.mutate\(peer\) \}/);
    expect(menu.match(/block\.mutate\(/g)).toHaveLength(1);
    expect(menu).toMatch(/\{ text: "Cancel", style: "cancel" \},\s*\]\);\s*\}, \[/);
  });

  it("blocks through the same call, lets go of what the block changes, and leaves the thread", () => {
    expect(thread).toMatch(/import \{ blockMember \} from "@\/api\/blocks";/);
    const block = thread.slice(thread.indexOf("const block = useMutation("), thread.indexOf("const threadMenu = useCallback("));
    expect(block).toMatch(/mutationFn: \(member: Pick<ProfileRow, "id" \| "username">\) => blockMember\(member\.id\),/);
    // What the profile's own Block lets go of (afterBlockChange), their
    // profile and photographs among it, as this member last read them.
    for (const key of [
      '\\["blocked-ids", userId\\]',
      '\\["blocked", userId\\]',
      '\\["follow-state", userId, member\\.id\\]',
      '\\["profile", member\\.username\\]',
      '\\["user-posts", member\\.id\\]',
      '\\["conversations", userId\\]',
      '\\["feed"\\]',
      '\\["explore"\\]',
      '\\["activity"\\]',
    ]) {
      expect(block).toMatch(new RegExp(`queryClient\\.invalidateQueries\\(\\{ queryKey: ${key} \\}\\);`));
    }
    // The same keys the profile screen reads them under.
    expect(profile).toMatch(/queryKey: \["profile", username\],/);
    expect(profile).toMatch(/queryKey: \["user-posts", profile\?\.id\],/);
    expect(profile).toMatch(/queryClient\.invalidateQueries\(\{ queryKey: \["user-posts", profile\?\.id\] \}\);/);
    expect(block).toMatch(/if \(router\.canGoBack\(\)\) router\.back\(\);\s*else router\.replace\("\/"\);/);
    expect(block).toMatch(/onError: \(err\) => showAlert\("That didn’t work", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/);
  });

  it("the report screen takes a member as its subject", () => {
    expect(read("app/report.tsx")).toMatch(/profileId\?: string;/);
    expect(read("src/types/db.ts")).toMatch(/"post" \| "comment" \| "profile"/);
  });
});
