import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MARK_HTML } from "../src/brand/markHtml.generated";

/**
 * The page the app's web view shows for the turning V. It is generated
 * (scripts/build-mark.mjs) and committed, so this holds the committed copy
 * to what the app relies on: self-contained, offline, and quiet.
 */
describe("the mark's page for the app", () => {
  it("is one self-contained page that fetches nothing", () => {
    expect(MARK_HTML.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(MARK_HTML).not.toMatch(/<script[^>]+src=/);
    expect(MARK_HTML).not.toMatch(/<link[^>]+href=/);
    expect(MARK_HTML).not.toContain("unpkg");
    expect(MARK_HTML).not.toContain("import(");
  });

  it("carries the V, tells the app when it is drawn, and leaves the fill and the ink to the app", () => {
    expect(MARK_HTML).toContain('data-fill="__FILL__"');
    expect(MARK_HTML).toContain('data-ink="__INK__"');
    expect(MARK_HTML).toContain("ReactNativeWebView");
    expect(MARK_HTML).toContain("background:transparent");
    // The two named meshes of the mark, as in public/3d/mark.js.
    expect(MARK_HTML).toContain("letter_v");
    expect(MARK_HTML).toContain("underline");
  });

  it("stays a reasonable weight for a JS bundle to carry", () => {
    expect(MARK_HTML.length).toBeLessThan(1_200_000);
  });
});

const root = path.resolve(import.meta.dirname, "..");
const read = (file: string) => readFileSync(path.join(root, file));
/** The source without its comments. */
const code = (file: string) =>
  read(file)
    .toString("utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

/**
 * On the black page the V is white, like every other mark there: the scene
 * is cut in the ink the app hands it, and the still that stands in for it
 * is a white one. On paper both are the espresso they have always been.
 */
describe("the mark on the black page", () => {
  it("is cut in the ink the page hands the scene, and in the espresso when it hands none", () => {
    const app = code("public/3d/app.js");
    expect(app).toMatch(/const inkHex = document\.body\.dataset\.ink \?\? '';/);
    expect(app).toMatch(/const ink = \/\^\[0-9a-f\]\{6\}\$\/i\.test\(inkHex\) \? parseInt\(inkHex, 16\) : undefined;/);
    expect(app).toMatch(/buildVintageMark\(THREE, \{ color: ink \}\)/);
    expect(code("public/3d/mark.js")).toMatch(/const color = options\.color \?\? 0x473d35;/);
  });

  it("is white wherever the theme prints the black page, and only there", () => {
    const stage = code("src/components/MarkStage.tsx");
    expect(stage).toMatch(/const onBlack = Platform\.OS === "ios" && scheme === "dark";/);
    expect(stage).toMatch(/\.replace\(\s*'data-ink="__INK__"',\s*`data-ink="\$\{onBlack \? INK_ON_BLACK : ""\}"`,?\s*\)/);
    expect(stage).toMatch(/source=\{onBlack \? STILL_ON_BLACK : STILL\}/);
    expect(stage).toMatch(/const STILL_ON_BLACK = require\("\.\.\/\.\.\/assets\/brand\/mark-v-dark\.png"\);/);
    // A white, leaning a hair cool against the scene's warm light: never cream.
    const ink = stage.match(/const INK_ON_BLACK = "([0-9a-f]{6})";/)?.[1] ?? "";
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(ink.slice(i, i + 2), 16));
    expect(Math.min(r, g, b)).toBeGreaterThanOrEqual(0xf0);
    expect(b).toBeGreaterThanOrEqual(r);
    // The web build prints only the paper page, so it keeps the espresso still.
    expect(code("src/components/MarkStage.web.tsx")).not.toMatch(/mark-v-dark/);
  });

  it("swaps in the scene for the print it was drawn for, and the still until it has", () => {
    const stage = code("src/components/MarkStage.tsx");
    expect(stage).toMatch(/const ready = readyOn === onBlack;/);
    expect(stage).toMatch(/if \(e\.nativeEvent\.data === "ready"\) setReadyOn\(onBlack\);/);
    expect(stage).toMatch(/if \(!ready\) \{\s*opacity\.setValue\(0\);/);
  });

  it("has a white still the same size as the espresso one", () => {
    const size = (png: Buffer) => [png.readUInt32BE(16), png.readUInt32BE(20)];
    const paper = read("assets/brand/mark-v.png");
    const black = read("assets/brand/mark-v-dark.png");
    expect(size(black)).toEqual(size(paper));
    expect(black.equals(paper)).toBe(false);
  });
});
