import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_IDS, DEMO_POSTS } from "@/demo/fixtures";
import { memoryHeadline, onThisDay } from "@/utils/memories";

/**
 * On this day (`app/memories.tsx`), your own posts from this date in
 * earlier years, has a way in from the app itself: the Post tab's On this
 * day door went with the owner's redesign of that tab (round 27), and the
 * notification alone left a member who missed it, or has push off, no way
 * to the page. The way in is one quiet line on your own profile, there
 * only on a day that has a memory, read from the posts the profile
 * already holds.
 */

const root = path.resolve(import.meta.dirname, "..");
const code = (f: string) =>
  readFileSync(path.join(root, f), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("On this day's way in", () => {
  const profile = code("app/(tabs)/profile.tsx");
  const line = code("src/components/OnThisDayLine.tsx");

  it("is a line on your own profile, above the views, only on a day with a memory, opening On this day", () => {
    expect(profile).toMatch(/import \{ OnThisDayLine \} from "@\/components\/OnThisDayLine";/);
    expect(profile).toMatch(/const memories = useMemo\(\(\) => onThisDay\(posts\.data \?\? \[\], new Date\(today\)\), \[posts\.data, today\]\);/);
    expect(profile).toMatch(
      /\{memories\.length > 0 \? <OnThisDayLine memory=\{memories\[0\]\} count=\{memories\.length\} onPress=\{\(\) => router\.push\("\/memories"\)\} \/> : null\}\s*\{rows\.length > 0 \? <GridSortToggle/,
    );
    // Read from the posts already on the page: no query of its own.
    expect(line).not.toMatch(/useQuery|fetch|supabase/);
  });

  it("says what its notification says, and is a button to VoiceOver", () => {
    expect(line).toMatch(/const headline = memoryHeadline\(memory\);/);
    expect(line).toMatch(/accessibilityRole="button"/);
    expect(line).toMatch(/accessibilityLabel=\{`On this day\. \$\{headline\}\$\{more\}`\}/);
    expect(line).toMatch(/accessibilityHint="Opens On this day\."/);
    expect(line).toMatch(/minHeight: 44/);
  });

  it("shows for the demo's Elena on 18 January, a year after the fog on the Naviglio, and not today", () => {
    const elena = DEMO_POSTS.filter((p) => p.author_id === DEMO_IDS.elena);
    const jan18 = onThisDay(elena, new Date(2026, 0, 18, 12));
    expect(jan18).toHaveLength(1);
    expect(memoryHeadline(jan18[0])).toMatch(/^1 year ago today/);
    expect(onThisDay(elena, new Date(2026, 5, 3, 12))).toHaveLength(0);
  });

  it("is still what the Memory Room's notification opens", () => {
    expect(code("src/utils/pushRoute.ts")).toMatch(/return "\/memories";/);
  });
});
