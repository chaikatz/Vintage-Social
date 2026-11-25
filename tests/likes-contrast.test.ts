import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { colors, spacing } from "@/theme";
import { LIKES_SLOP } from "@/utils/ownLikes";

/**
 * The owner's likes line, as it is read and as it is tapped: "No likes
 * yet" and the likers list's note against the paper they stand on, at
 * WCAG's 4.5:1 for text, light and dark; and the count, the owner's way
 * into who liked it, at least 44 points tall to a finger.
 */

// The theme read as iOS, so each dynamic colour comes back as its two prints.
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  DynamicColorIOS: (o: { light: string; dark: string }) => ({ light: o.light, dark: o.dark }),
}));

type Token = keyof typeof colors;
type Print = { light: string; dark: string };
const print = (token: Token): Print => {
  const c = colors[token] as unknown;
  return typeof c === "string" ? { light: c, dark: c } : (c as Print);
};
const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
const style = (src: string, name: string) =>
  src.slice(src.indexOf("StyleSheet.create({")).match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";
const tokenOf = (rule: string): Token => {
  const name = rule.match(/color:\s*colors\.(\w+)/)?.[1];
  expect(name, rule).toBeTruthy();
  return name as Token;
};

describe("the owner's likes line", () => {
  const quiet: [string, string][] = [
    ["src/components/PostCard.tsx", "noLikes"],
    ["app/post/[id].tsx", "noLikes"],
    ["app/likes.tsx", "note"],
  ];
  for (const [file, name] of quiet) {
    it(`${file}'s ${name} reads at 4.5:1 on paper, light and dark`, () => {
      const ink = print(tokenOf(style(read(file), name)));
      const paper = print("paper");
      expect(ratio(ink.light, paper.light)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(ink.dark, paper.dark)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("is 44 points tall to a finger on the card and the photograph's page", () => {
    for (const file of ["src/components/PostCard.tsx", "app/post/[id].tsx"]) {
      const src = read(file);
      expect(src, file).toMatch(/onOpenLikes[^\n]*\n[\s\S]{0,80}hitSlop=\{LIKES_SLOP\}/);
      const likes = style(src, "likes");
      const line = Number(likes.match(/lineHeight: (\d+)/)?.[1]);
      const top = likes.match(/paddingTop: spacing\.(\w+)/)?.[1] as keyof typeof spacing;
      const drawn = line + (spacing[top] as number);
      expect(drawn + LIKES_SLOP.top + LIKES_SLOP.bottom, file).toBeGreaterThanOrEqual(44);
    }
  });
});
