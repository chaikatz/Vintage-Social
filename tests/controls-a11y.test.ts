import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/Avatar", () => ({ Avatar: () => null }));
vi.mock("react-native", () => ({
  Pressable: () => null,
  StyleSheet: { create: <T,>(s: T) => s },
  Text: () => null,
  View: () => null,
}));
vi.mock("@/theme", () => ({ colors: {}, spacing: { sm: 8, md: 12, lg: 16 }, radii: {} }));

/**
 * The app's shared controls, as VoiceOver meets them: the Button says it
 * is one, by its title, even while its spinner stands in for the title;
 * a member's row keeps its own control (Follow, Forget, Warn) reachable,
 * beside the part that opens the member rather than swallowed by it.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Button", () => {
  const src = code("src/components/Button.tsx");
  it("is a button, named by its title, with its state", () => {
    expect(src).toMatch(/accessibilityRole="button"/);
    expect(src).toMatch(/accessibilityLabel=\{title\}/);
    expect(src).toMatch(/accessibilityState=\{\{ disabled: isDisabled, busy: loading \}\}/);
  });
});

describe("UserRow", () => {
  const src = code("src/components/UserRow.tsx");

  it("puts the row's control beside the pressable part, never inside it", () => {
    const pressable = src.slice(src.indexOf("<Pressable"), src.indexOf("</Pressable>"));
    expect(pressable).not.toMatch(/\{right\}/);
    expect(src).toMatch(/<\/Pressable>\s*\{right\}\s*<\/View>/);
  });

  it("names the member it opens", async () => {
    const { userRowLabel } = await import("@/components/UserRow");
    expect(userRowLabel("june", "June Nakamura", "Osaka")).toBe("june, June Nakamura, Osaka");
    expect(userRowLabel("june", null, undefined)).toBe("june");
    expect(src).toMatch(/accessibilityRole="button"\s*accessibilityLabel=\{userRowLabel\(username, title, subtitle\)\}/);
  });

  it("keeps the look: the row's sides padded, the member's part its height", () => {
    expect(src).toMatch(/row: \{\s*flexDirection: "row",\s*alignItems: "center",\s*paddingHorizontal: spacing\.lg,\s*\}/);
    expect(src).toMatch(/person: \{\s*flex: 1,\s*flexDirection: "row",\s*alignItems: "center",\s*paddingVertical: spacing\.sm \+ 2,\s*\}/);
  });
});
