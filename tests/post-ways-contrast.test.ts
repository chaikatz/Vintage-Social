import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { colors } from "@/theme";

/**
 * The Post tab as it is seen, on paper and on black: its words and marks
 * against what they stand on at WCAG's 4.5:1 for text (and so for the
 * marks beside it), the header's other page's name at least 3:1, and the
 * selected cell's rust border against the sunken paper of a cell at the
 * 3:1 WCAG asks of what shows a control's state. The colours are the
 * tokens the page's parts name in their styles, read from the source, so a
 * change of token there is held here.
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
const header = read("src/components/post/PostHeader.tsx");
const hero = read("src/components/post/RollHero.tsx");
const cells = read("src/components/post/RollCell.tsx");
const panel = read("src/components/post/MountPanel.tsx");
const door = read("src/components/post/DoorPage.tsx");

/** Ink on ground, as the page draws it, and the ratio it must reach. */
const PAIRS: [string, Token, Token, number][] = [
  ["the current page's name", token(style(header, "ink"), "color"), "paper", 4.5],
  // Twenty points of the serif is under WCAG's large text (24), so it is held to 4.5:1 as well as 3:1.
  ["the other page's name", token(style(header, "other"), "color"), "paper", 4.5],
  ["LIBRARY and VIDEO", token(style(ways, "wayWord"), "color"), "paper", 4.5],
  ["POST", token(style(ways, "postWord"), "color"), "paper", 4.5],
  ["POST's arrow", token(style(ways, "stroke"), "backgroundColor"), "paper", 4.5],
  ["the camera's mark", token(cells.match(/<Feather name="camera"[^>]*>/)?.[0] ?? "", "color"), token(style(cells, "tile"), "backgroundColor"), 4.5],
  ["SHARE MORE", token(style(cells, "moreWord"), "color"), token(style(cells, "tile"), "backgroundColor"), 4.5],
  ["a panel's eyebrow", token(style(panel, "eyebrow"), "color"), token(style(panel, "panel"), "backgroundColor"), 4.5],
  ["a panel's headline", token(style(panel, "headline"), "color"), token(style(panel, "panel"), "backgroundColor"), 4.5],
  ["a panel's words", token(style(panel, "body"), "color"), token(style(panel, "panel"), "backgroundColor"), 4.5],
  ["a panel's bar", token(style(panel, "barWord"), "color"), token(style(panel, "bar"), "backgroundColor"), 4.5],
  ["the way to Settings", token(style(panel, "path"), "color"), token(style(panel, "panel"), "backgroundColor"), 4.5],
  ["OPEN SETTINGS", token(style(panel, "quietWord"), "color"), token(style(panel, "panel"), "backgroundColor"), 4.5],
  ["the door's name", token(style(door, "eyebrow"), "color"), token(style(door, "page"), "backgroundColor"), 4.5],
  ["the door's line", token(style(door, "line"), "color"), token(style(door, "page"), "backgroundColor"), 4.5],
  ["the selected cell's border", token(style(cells, "box"), "borderColor"), token(style(cells, "cell"), "backgroundColor"), 3],
];

describe("the Post tab, on paper and on black", () => {
  for (const side of ["light", "dark"] as const) {
    it(`sets its words and marks at 4.5:1 or more on what they stand on, and its box at 3:1 (${side})`, () => {
      for (const [what, ink, ground, least] of PAIRS) {
        expect(ratio(print(ink)[side], print(ground)[side]), `${what}: ${ink} on ${ground}`).toBeGreaterThanOrEqual(least);
      }
    });
  }

  it("names the tokens the mock gives each of them", () => {
    const byName = Object.fromEntries(PAIRS.map(([what, ink, ground]) => [what, `${ink} on ${ground}`]));
    expect(byName).toMatchObject({
      "the current page's name": "ink on paper",
      "the other page's name": "inkOther on paper",
      "LIBRARY and VIDEO": "inkSoft on paper",
      POST: "ink on paper",
      "the camera's mark": "ink on paper",
      "the selected cell's border": "accent on paperSunken",
    });
    // The camera tile is the paper ruled in the strong line, as the mock draws it.
    expect(token(style(cells, "tile"), "borderColor")).toBe("borderStrong");
  });

  it("raises the other page's name from the faint ink, which falls under 3:1 on paper, only as far as 4.5:1, in the mock's hue", () => {
    // The mock's own faint ink, and the theme's, on the paper: both under 3:1.
    expect(ratio("#A39A88", print("paper").light)).toBeLessThan(3);
    expect(ratio(print("inkFaint").light, print("paper").light)).toBeLessThan(3);
    // On paper the lightest tone of the mock's hue that reads at 4.5:1; on black the faint ink, which already reaches it.
    expect(print("inkOther")).toEqual({ light: "#777063", dark: print("inkFaint").dark });
    expect(ratio(print("inkOther").light, print("paper").light)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(print("inkOther").dark, print("paper").dark)).toBeGreaterThanOrEqual(4.5);
    // Lighter than the soft ink, so the page you are on stands apart from the other by 3:1, as the mock's two do by more.
    expect(ratio(print("inkOther").light, print("paper").light)).toBeLessThan(ratio(print("inkSoft").light, print("paper").light));
    expect(ratio(print("inkOther").light, print("ink").light)).toBeGreaterThanOrEqual(3);
    expect(ratio(print("inkSoft").light, print("ink").light)).toBeLessThan(3);
    // And still plainly the quieter of the two.
    for (const side of ["light", "dark"] as const) {
      expect(ratio(print("inkOther")[side], print("paper")[side])).toBeLessThan(ratio(print("ink")[side], print("paper")[side]));
    }
  });

  it("keeps the faint ink off the page's small capitals, where it fails 4.5:1 on paper", () => {
    expect(ratio(print("inkFaint").light, print("paper").light)).toBeLessThan(4.5);
    for (const [what, ink] of PAIRS) expect(ink, what).not.toBe("inkFaint");
  });

  it("is drawn in the theme's own tokens, but for the library picker's scrims over a photograph", () => {
    for (const [name, src] of [["ways", ways], ["header", header], ["panel", panel], ["door", door]] as const) {
      const drawn = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1").replace(/shadowColor: "#000"/g, "");
      expect(drawn, name).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
    }
    expect(cells.match(/rgba?\(/g)).toHaveLength(1);
    expect(cells).toMatch(/const SCRIM = "rgba\(28, 25, 21, 0\.45\)";/);
    expect(hero.match(/rgba?\(/g)).toHaveLength(1);
    expect(hero).toMatch(/const SCRIM = "rgba\(28, 25, 21, 0\.55\)";/);
  });
});
