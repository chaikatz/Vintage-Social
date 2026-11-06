import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The door's bars and ways in grow with the phone's text size. A fixed
 * 44-point height cut a two-line label in half at the larger sizes ("SUBMIT
 * APPLICATION", "APPLY FOR MEMBERSHIP"); a minimum of 44 keeps the same
 * bar at the default size and lets it grow. Read from the source.
 */
const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const style = (src: string, name: string) => src.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";

describe("at the door", () => {
  const button = read("src/components/gate/GateButton.tsx");
  const landing = read("app/(gate)/landing.tsx");

  it("a bar is at least 44 points, never a fixed height", () => {
    expect(style(button, "base")).toMatch(/minHeight: 44/);
    expect(style(button, "base")).not.toMatch(/[^n]height:/i);
  });

  it("a quiet way keeps its own height, as it did", () => {
    expect(style(button, "quiet")).toMatch(/minHeight: 0, paddingVertical: spacing\.md/);
  });

  it("every screen scrolls when its words outgrow it, so the last way out is always in reach", () => {
    // The waiting screen did not scroll: at the largest sizes Sign out and
    // Delete my account, last of all, were below the bottom of the screen.
    for (const f of ["apply", "invite", "landing", "pending", "sign-in"]) {
      expect(read(`app/(gate)/${f}.tsx`), f).not.toMatch(/scroll=\{false\}/);
    }
    expect(read("app/(gate)/pending.tsx")).toMatch(/<GateLayout back=\{false\}>/);
    expect(read("src/components/gate/GateLayout.tsx")).toMatch(/scroll = true/);
    // The landing fills the screen as before and scrolls only when it must.
    expect(landing).toMatch(/<ScrollView contentContainerStyle=\{styles\.scroll\} alwaysBounceVertical=\{false\}[^>]*>\s*<View style=\{\[styles\.content,/);
    expect(style(landing, "scroll")).toMatch(/flexGrow: 1/);
    expect(style(landing, "content")).toMatch(/flex: 1/);
    expect(read("app/(gate)/invite.tsx")).toMatch(/<ScrollView\b/);
  });

  it("a bar's label never runs under its arrow, and sits where it did at the default size", () => {
    // The arrow is 18 wide and 16 in from the edge; the label is centred across the bar.
    expect(button).toMatch(/<Feather name="arrow-right" size=\{18\}[^>]*style=\{styles\.arrow\} \/>/);
    expect(style(button, "arrow")).toMatch(/position: "absolute", right: 16/);
    const clearance = Number(button.match(/const ARROW_CLEARANCE = (\d+);/)?.[1]);
    expect(clearance).toBeGreaterThanOrEqual(16 + 18 + 8);
    for (const bar of ["solid", "outline", "card"]) expect(style(button, bar), bar).toContain("paddingHorizontal: ARROW_CLEARANCE");
    // Symmetric, so the centred label does not move; the quiet way has no arrow and no padding.
    expect(style(button, "quiet")).not.toMatch(/padding(Horizontal|Left|Right)/);
    for (const bar of ["solid", "outline", "card"]) expect(style(button, bar), bar).not.toMatch(/padding(Left|Right)/);
    // At the default size the longest label at the door still fits on one line between the clearances
    // of the narrowest phone's bar (375 points less the page's two margins): Courier New is 0.6 em wide.
    const layout = read("src/components/gate/GateLayout.tsx");
    expect(layout).toMatch(/body: \{ flex: 1, paddingHorizontal: spacing\.xl \+ spacing\.xs \}/);
    const bar = 375 - 2 * (24 + 4);
    const longest = Math.max(
      ...["I have an invitation", "Submit application", "Check status", "Sign in"].map((t) => t.length * (11 * 0.6 + 2.4) - 2.4),
    );
    expect(longest).toBeLessThan(bar - 2 * clearance);
  });

  it("the scrolling page sits still when it all fits, as the landing does", () => {
    const layout = read("src/components/gate/GateLayout.tsx");
    expect(layout).toMatch(/<ScrollView\s+contentContainerStyle=\{\[styles\.scroll[^\]]*\]\}[\s\S]*?alwaysBounceVertical=\{false\}[\s\S]*?>\s*\{body\}/);
  });

  it("the landing's ways in grow too, and Sign in keeps its own height", () => {
    expect(style(landing, "way")).toMatch(/minHeight: 44/);
    expect(style(landing, "way")).not.toMatch(/[^n]height:/i);
    expect(style(landing, "waySignIn")).toMatch(/minHeight: 0/);
  });
});
