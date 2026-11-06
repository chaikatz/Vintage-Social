import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  demoFetchExplore,
  demoFetchFeedPage,
  demoFetchPost,
  demoFetchUserPosts,
  demoReset,
  demoSignIn,
  demoSubmitReport,
} from "@/demo/store";
import { DEMO_IDS } from "@/demo/fixtures";

/**
 * Guideline 1.2: a photograph a member reports leaves their own feed,
 * Explore and grids the moment the report is in, and stays out of their
 * view whatever an admin decides; nobody else's view changes. The
 * database does it for every read (0033, proven in
 * supabase/tests/14_moderation_0029_0033.sql); the report screen takes it
 * off what is already on screen; the demo store, which stands in for the
 * database in the web demo, does as 0033 does.
 */

const root = path.resolve(import.meta.dirname, "..");
const code = (file: string) =>
  readFileSync(path.join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the report screen", () => {
  const src = code("app/report.tsx");

  it("takes a reported photograph off every list on screen once the report is in, before the thank-you", () => {
    const submit = src.slice(src.indexOf("const submit = async"), src.indexOf("return (", src.indexOf("const submit = async")));
    expect(submit).toMatch(
      /await submitReport\(\{[\s\S]*?\}\);\s+const targetType = params\.targetType \?\? "post";\s+const hidden = targetType === "post" && params\.postId && !isAdmin \? params\.postId : null;\s+if \(hidden\) void removePostEverywhere\(queryClient, hidden\);\s+showAlert\("Thank you", "An admin will take a look\.", \[\s+\{ text: "Done", onPress: \(\) => leave\(hidden\) \},/,
    );
  });

  it("reported from the photograph's own page, Done closes that page too, which would show it again", () => {
    const leave = src.slice(src.indexOf("const leave = (hidden"), src.indexOf("return (", src.indexOf("const leave = (hidden")));
    // The page beneath is that photograph's own.
    expect(leave).toMatch(/const state = navigation\.getState\(\);/);
    expect(leave).toMatch(/const below = state\?\.routes\[index - 1\];/);
    expect(leave).toMatch(
      /hidden != null && below\?\.name === "post\/\[id\]" && \(below\.params as \{ id\?: string \} \| undefined\)\?\.id === hidden/,
    );
    // Not it: back, as before. It: the report and the page, or Home when the page was the first screen.
    expect(leave).toMatch(/if \(!ownPage\) \{\s+router\.back\(\);\s+\} else if \(index >= 2\) \{\s+router\.dismiss\(2\);\s+\} else \{\s+router\.dismissAll\(\);\s+router\.replace\("\/"\);\s+\}/);
    // The route name it looks for is the post page's, as the root stack names it.
    expect(readFileSync(path.join(root, "app/_layout.tsx"), "utf8")).toMatch(/<Stack\.Screen name="post\/\[id\]"/);
  });

  it("only after the report is in: a report that failed leaves the photograph where it was", () => {
    const failed = src.slice(src.indexOf("} catch (err) {"), src.indexOf("} finally {"));
    expect(failed).not.toMatch(/removePostEverywhere/);
  });
});

describe("the demo store, as 0033", () => {
  beforeEach(() => {
    demoReset();
    demoSignIn("reviewer@example.com"); // Elena
  });

  it("a photograph Elena reports leaves her feed, Explore, its author's grid and its own page", () => {
    const theirs = demoFetchFeedPage(DEMO_IDS.elena, null, 100).find((p) => p.author_id !== DEMO_IDS.elena)!;
    expect(theirs).toBeTruthy();
    demoSubmitReport({
      reporter_id: DEMO_IDS.elena,
      target_type: "post",
      post_id: theirs.id,
      comment_id: null,
      profile_id: null,
      reason: "Spam or scam",
      details: null,
    });
    expect(demoFetchFeedPage(DEMO_IDS.elena, null, 100).some((p) => p.id === theirs.id)).toBe(false);
    expect(demoFetchExplore(DEMO_IDS.elena, 500).some((p) => p.id === theirs.id)).toBe(false);
    expect(demoFetchUserPosts(theirs.author_id).some((p) => p.id === theirs.id)).toBe(false);
    expect(demoFetchPost(theirs.id)).toBeNull();
    // Nobody else's: its author's own feed still has it.
    expect(demoFetchFeedPage(theirs.author_id, null, 100).some((p) => p.id === theirs.id)).toBe(true);
  });

  it("a member's own photograph is never hidden from them, and a comment report hides no photograph", () => {
    const mine = demoFetchUserPosts(DEMO_IDS.elena)[0];
    const before = demoFetchFeedPage(DEMO_IDS.elena, null, 100).length;
    demoSubmitReport({
      reporter_id: DEMO_IDS.elena, target_type: "post", post_id: mine.id,
      comment_id: null, profile_id: null, reason: "Something else", details: null,
    });
    demoSubmitReport({
      reporter_id: DEMO_IDS.elena, target_type: "comment", post_id: null,
      comment_id: "demo-comment-1", profile_id: null, reason: "Something else", details: null,
    });
    expect(demoFetchPost(mine.id)).not.toBeNull();
    expect(demoFetchFeedPage(DEMO_IDS.elena, null, 100).length).toBe(before);
  });
});
