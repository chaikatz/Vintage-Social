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

  it("the landing's ways in grow too, and Sign in keeps its own height", () => {
    expect(style(landing, "way")).toMatch(/minHeight: 44/);
    expect(style(landing, "way")).not.toMatch(/[^n]height:/i);
    expect(style(landing, "waySignIn")).toMatch(/minHeight: 0/);
  });
});
