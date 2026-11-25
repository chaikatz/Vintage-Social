import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { colors } from "@/theme";

/**
 * The Post tab as it is seen, on paper and on black: its words and marks
 * against what they stand on at WCAG's 4.5:1 for text (and so for the
 * marks beside it), and the grease-pencil box against the sunken paper of
 * a cell at the 3:1 WCAG asks of what shows a control's state. The
 * colours are the tokens the page's parts name in their styles, read from
 * the source, so a change of token there is held here.
 */

// The theme read as iOS, so each dynamic colour comes back as its two prints.
vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  DynamicColorIOS: (o: { light: string; dark: string }) => ({ light: o.light, dark: o.dark }),
}));

type Token = keyof typeof colors;
type Print = { light: string; dark: string };

function print(token: Token): Print {
  const c = colors[token] as unknown;
  return typeof c === "string" ? { light: c, dark: c } : (c as Print);
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG's contrast ratio. */
const ratio = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const read = (f: string) => readFileSync(path.resolve(import.meta.dirname, "..", f), "utf8");
/** One entry of the file's StyleSheet, as written. */
const style = (src: string, name: string) =>
  src.slice(src.indexOf("StyleSheet.create({")).match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";
/** The token a style, or a line of the source, names for a property. */
function token(src: string, prop: string): Token {
  const name = src.match(new RegExp(`${prop}[:=]\\s*\\{?colors\\.(\\w+)`))?.[1];
  expect(name, `${prop} in ${src.slice(0, 60)}`).toBeTruthy();
  expect(name! in colors, name).toBe(true);
  return name as Token;
}

const ways = read("src/components/post/WaysRow.tsx");
const doors = read("src/components/post/PostDoors.tsx");
const hero = read("src/components/post/RollHero.tsx");
const cells = read("src/components/post/RollCell.tsx");
const panel = read("src/components/post/MountPanel.tsx");
const footer = read("src/components/post/RollFooter.tsx");

/** Ink on ground, as the page draws it, and the ratio it must reach. */
const PAIRS: [string, Token, Token, number][] = [
  ["RECENT", token(style(ways, "recent"), "color"), "paper", 4.5],
  ["the ways' words", token(style(ways, "wayWord"), "color"), "paper", 4.5],
  ["the ways' marks", token(ways.match(/<Feather name=\{icon\}[^>]*>/)?.[0] ?? "", "color"), "paper", 4.5],
  ["the limited line", token(style(ways, "limitedText"), "color"), "paper", 4.5],
  ["SHARE MORE", token(style(ways, "shareMoreWord"), "color"), "paper", 4.5],
  ["On this day's eyebrow", token(style(doors, "dayEyebrow"), "color"), token(style(doors, "day"), "backgroundColor"), 4.5],
  ["On this day's line", token(style(doors, "dayLine"), "color"), token(style(doors, "day"), "backgroundColor"), 4.5],
  ["On this day's years", token(style(doors, "sub"), "color"), token(style(doors, "day"), "backgroundColor"), 4.5],
  ["the Memory Room's eyebrow", token(style(doors, "roomEyebrow"), "color"), token(style(doors, "room"), "backgroundColor"), 4.5],
  ["the Memory Room's line", token(style(doors, "roomLine"), "color"), token(style(doors, "room"), "backgroundColor"), 4.5],
  ["the Memory Room's pressed line", token(style(doors, "roomLine"), "color"), token(style(doors, "roomPressed"), "backgroundColor"), 4.5],
  ["SET ASIDE", token(style(doors, "shelfWord"), "color"), "paper", 4.5],
  ["POST", token(style(hero, "postWord"), "color"), token(style(hero, "post"), "backgroundColor"), 4.5],
  ["the strip's date", token(style(hero, "date"), "color"), token(style(hero, "mount"), "backgroundColor"), 4.5],
  ["the camera tile", token(style(cells, "cameraWord"), "color"), token(style(cells, "camera"), "backgroundColor"), 4.5],
  ["a panel's bar", token(style(panel, "barWord"), "color"), token(style(panel, "bar"), "backgroundColor"), 4.5],
  ["a panel's headline", token(style(panel, "headline"), "color"), token(style(panel, "mount"), "backgroundColor"), 4.5],
  ["the foot's line", token(style(footer, "line"), "color"), "paper", 4.5],
  ["the grease-pencil box", token(style(cells, "box"), "borderColor"), token(style(cells, "cell"), "backgroundColor"), 3],
];

describe("the Post tab, on paper and on black", () => {
  for (const side of ["light", "dark"] as const) {
    it(`sets its words and marks at 4.5:1 or more on what they stand on, and its box at 3:1 (${side})`, () => {
      for (const [what, ink, ground, least] of PAIRS) {
        expect(ratio(print(ink)[side], print(ground)[side]), `${what}: ${ink} on ${ground}`).toBeGreaterThanOrEqual(least);
      }
    });
  }

  it("names the tokens the spec gives each of them", () => {
    const byName = Object.fromEntries(PAIRS.map(([what, ink, ground]) => [what, `${ink} on ${ground}`]));
    expect(byName).toMatchObject({
      RECENT: "inkSoft on paper",
      "the ways' words": "ink on paper",
      "SHARE MORE": "accent on paper",
      "On this day's eyebrow": "inkSoft on paper",
      "the Memory Room's eyebrow": "gold on card",
      POST: "camera on onCamera",
      "the strip's date": "onCamera on camera",
      "the camera tile": "onCamera on cameraTile",
      "the grease-pencil box": "accent on paperSunken",
    });
  });

  it("keeps the faint ink off the page's small capitals, where it fails 4.5:1 on paper", () => {
    expect(ratio(print("inkFaint").light, print("paper").light)).toBeLessThan(4.5);
    for (const [what, ink] of PAIRS) expect(ink, what).not.toBe("inkFaint");
  });

  it("gives the camera tile the camera's dark on paper, and a grey a step up from the black on black", () => {
    expect(print("cameraTile")).toEqual({ light: "#1C1915", dark: "#1C1C1E" });
    expect(print("cameraTile").dark).not.toBe(print("paper").dark);
  });

  it("is drawn in the theme's own tokens, but for the opening scrim, which is the library picker's", () => {
    for (const [name, src] of [["ways", ways], ["doors", doors], ["hero", hero], ["panel", panel], ["footer", footer]] as const) {
      expect(src.replace(/shadowColor: "#000"/g, ""), name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
    expect(cells.match(/rgba?\(/g)).toHaveLength(1);
    expect(cells).toMatch(/const SCRIM = "rgba\(28, 25, 21, 0\.45\)";/);
  });
});
