import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
/** The source without its comments, so prose is not taken for code. */
const code = (file: string) =>
  readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the invitation card on Invitations", () => {
  const source = code("app/invites.tsx");
  const card = source.match(/\n {2}card: \{([\s\S]*?)\n {2}\},/)?.[1] ?? "";

  it("is drawn as a card", () => {
    expect(source).toMatch(/<View style=\{styles\.card\}>/);
    expect(card.length).toBeGreaterThan(0);
  });

  it("lies on the page as a printed card does: a brighter stock, a fine edge and a soft shadow under it", () => {
    // A shade brighter than the page, not the page itself.
    expect(card).toMatch(/backgroundColor: colors\.paperRaised,/);
    expect(card).not.toMatch(/backgroundColor: colors\.paper,/);
    // A fine edge, not a hard ink frame.
    expect(card).toMatch(/borderWidth: StyleSheet\.hairlineWidth,/);
    expect(card).toMatch(/borderColor: colors\.borderStrong,/);
    // A soft shadow, falling a little below it, on iOS and on Android.
    expect(card).toMatch(/shadowColor: "#000",/);
    const opacity = Number(card.match(/shadowOpacity: ([\d.]+),/)?.[1]);
    expect(opacity).toBeGreaterThan(0.05);
    expect(opacity).toBeLessThan(0.25);
    expect(card).toMatch(/shadowRadius: \d+,/);
    expect(card).toMatch(/shadowOffset: \{ width: 0, height: [1-9]\d* \},/);
    expect(card).toMatch(/elevation: [1-9],/);
  });
});
