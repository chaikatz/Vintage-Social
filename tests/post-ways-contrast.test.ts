import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { colors } from "@/theme";

/**
 * The camera and the clip on the Post tab, as they are seen: their words
 * and marks against their box, on paper and on black, at WCAG's 4.5:1 for
 * text (and so for the marks beside it); their edge against the page at
 * 3:1, what WCAG asks of the edge that shows a control is there; and the
 * clip's limit under them at 4.5:1. The colours are the tokens the page
 * names in its styles, read from the source, so a change of token there
 * is held here.
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

const tab = readFileSync(path.resolve(import.meta.dirname, "..", "app/(tabs)/create.tsx"), "utf8");
const style = (name: string) => tab.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? "";
/** The token a style, or a line of the source, names for a property. */
function token(src: string, prop: string): Token {
  const name = src.match(new RegExp(`${prop}[:=]\\s*\\{?colors\\.(\\w+)`))?.[1];
  expect(name, `${prop} in ${src.slice(0, 60)}`).toBeTruthy();
  expect(name! in colors, name).toBe(true);
  return name as Token;
}

const boxed = tab.slice(tab.indexOf("function BoxedWay"), tab.indexOf("function QuietWay"));
const word = token(style("boxWord"), "color");
const mark = token(boxed.match(/<Feather [^>]*>/)?.[0] ?? "", "color");
const spinner = token(boxed.match(/<ActivityIndicator [^>]*>/)?.[0] ?? "", "color");
const fill = token(style("box"), "backgroundColor");
const pressedFill = token(style("boxPressed"), "backgroundColor");
const edge = token(style("box"), "borderColor");
const note = token(style("waysNoteText"), "color");

describe("the camera and the clip, on paper and on black", () => {
  for (const side of ["light", "dark"] as const) {
    it(`letters and marks them at 4.5:1 or more on their box, at rest and pressed (${side})`, () => {
      for (const ground of [fill, pressedFill]) {
        for (const ink of [word, mark]) {
          expect(ratio(print(ink)[side], print(ground)[side]), `${ink} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
        expect(ratio(print(spinner)[side], print(ground)[side]), `spinner on ${ground}`).toBeGreaterThanOrEqual(3);
      }
    });

    it(`draws their edge at 3:1 or more against the page and their own box (${side})`, () => {
      expect(ratio(print(edge)[side], print("paper")[side])).toBeGreaterThanOrEqual(3);
      expect(ratio(print(edge)[side], print(fill)[side])).toBeGreaterThanOrEqual(3);
    });

    it(`sets the clip's limit under them at 4.5:1 or more on the page (${side})`, () => {
      expect(ratio(print(note)[side], print("paper")[side])).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("is drawn in the theme's own tokens, none of them a colour of its own", () => {
    for (const t of [word, mark, spinner, fill, pressedFill, edge, note]) expect(Object.keys(colors)).toContain(t);
    const own = boxed + style("box") + style("boxPressed") + style("boxWord") + style("waysNoteText");
    expect(own).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i);
  });

  it("is clearer than the faint capitals they were: the words in the darkest ink there is", () => {
    // The quiet capitals were the secondary ink, at 10.5 points; the faint ink fails 4.5:1 on paper.
    expect(word).toBe("ink");
    expect(ratio(print("inkFaint").light, print("paper").light)).toBeLessThan(4.5);
    expect(note).not.toBe("inkFaint");
  });
});
