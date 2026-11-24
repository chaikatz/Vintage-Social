import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Editorial (Preview): the members' names in Cormorant Garamond Bold
 * Italic, the owner's choice (24 November; in its bold once the owner had
 * seen build 56), every name in the one cut.
 *
 * The iPhone finds a font built into the app by its PostScript name, and a
 * name it cannot find falls back to the system font without a word, so the
 * name the cut is asked for by is read here from the font file itself. The
 * file is built in by expo-font's plugin in app.json (UIAppFonts), and
 * travels with its licence. The phone draws the cut of the family nearest
 * the weight asked for, so the weight it is asked for at is the file's own.
 */

const root = path.resolve(import.meta.dirname, "..");
const module = readFileSync(path.join(root, "src/utils/nameFace.ts"), "utf8");

/** The cut's file, and what its name, OS/2 and head tables must say. */
const FILE = "assets/fonts/CormorantGaramond-BoldItalic.ttf";

/** Where a table starts in a font file, by its tag. */
function table(font: Buffer, tag: string): number {
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + 16 * i;
    if (font.toString("latin1", record, record + 4) === tag) return font.readUInt32BE(record + 8);
  }
  throw new Error(`no ${tag} table`);
}

/** The name table's Windows-platform strings, by name id. */
function names(font: Buffer): Map<number, string> {
  const at = table(font, "name");
  const count = font.readUInt16BE(at + 2);
  const strings = at + font.readUInt16BE(at + 4);
  const out = new Map<number, string>();
  for (let i = 0; i < count; i++) {
    const r = at + 6 + 12 * i;
    if (font.readUInt16BE(r) !== 3) continue;
    const id = font.readUInt16BE(r + 6);
    const length = font.readUInt16BE(r + 8);
    const offset = font.readUInt16BE(r + 10);
    const raw = font.subarray(strings + offset, strings + offset + length);
    out.set(id, Buffer.from(raw).swap16().toString("utf16le"));
  }
  return out;
}

describe("the names' face", () => {
  const font = readFileSync(path.join(root, FILE));

  it("is one cut, the bold italic, asked for by the PostScript name its file gives itself, so the phone finds it", () => {
    const family = module.match(/\nconst FAMILY = "([^"]+)";\n/)?.[1];
    expect(family).toBe("CormorantGaramond-BoldItalic");
    const strings = names(font);
    expect(strings.get(6)).toBe(family);
    // One of the family's four plain cuts: its family and style are in the name table's first two places.
    expect(strings.get(1)).toBe("Cormorant Garamond");
    expect(strings.get(2)).toBe("Bold Italic");
    expect(strings.get(4)).toBe("Cormorant Garamond Bold Italic");
    for (const id of [16, 17]) expect([undefined, id === 16 ? "Cormorant Garamond" : "Bold Italic"], String(id)).toContain(strings.get(id));
    // The file is named for the PostScript name it holds.
    expect(path.basename(FILE, ".ttf")).toBe(family);
    // No other name in the module, nor anywhere it could be asked for.
    expect(module.match(/"CormorantGaramond-[^"]*"/g)).toEqual([`"${family}"`]);
  });

  it("is bold and italic in itself, so nothing fakes either, and is asked for at its own weight on the phone, regular on the web", () => {
    // OS/2: weight 700; fsSelection italic (bit 0), bold (bit 5), and its typographic metrics used (bit 7).
    const os2 = table(font, "OS/2");
    expect(font.readUInt16BE(os2 + 4)).toBe(700);
    const selection = font.readUInt16BE(os2 + 62);
    expect(selection & 1).toBe(1);
    expect(selection & (1 << 5)).toBe(1 << 5);
    expect(selection & (1 << 6)).toBe(0);
    expect(selection).toBe(0xa1);
    // head: bold and italic (macStyle bits 0 and 1).
    expect(font.readUInt16BE(table(font, "head") + 44) & 3).toBe(3);
    // Asked for at its own weight on the phone, whose RCTFont draws the family's cut nearest the weight asked for, and
    // as italic as the named one; at the regular weight on the web, where the cut is a family of its own registered
    // without a weight. Never a style over it.
    expect(module).toMatch(/\nconst WEIGHT = Platform\.OS === "web" \? "400" : "700";\n/);
    const rctFont = readFileSync(path.join(root, "node_modules/react-native/React/Views/RCTFont.mm"), "utf8");
    expect(rctFont).toMatch(/font = \[UIFont fontWithName:familyName size:fontSize\];\s*if \(font\) \{[\s\S]*?familyName = font\.familyName;\s*fontWeight = weight \? fontWeight : RCTGetFontWeight\(font\);\s*isItalic = style \? isItalic : isItalicFont\(font\);/);
    expect(rctFont).toMatch(/if \(isItalic == isItalicFont\(match\) && isCondensed == isCondensedFont\(match\)\) \{\s*CGFloat testWeight = RCTGetFontWeight\(match\);\s*if \(ABS\(testWeight - fontWeight\) < ABS\(closestWeight - fontWeight\)\)/);
    expect(module).not.toMatch(/fontStyle/);
  });

  it("is built into the iPhone app by expo-font's plugin, that file alone, and carries its licence", () => {
    const app = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
    const plugin = (app.expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === "expo-font") as [string, { fonts: string[] }];
    expect(plugin?.[1].fonts).toEqual([`./${FILE}`]);
    expect(existsSync(path.join(root, FILE))).toBe(true);
    // The earlier cuts are gone with everything that read them: the folder holds the one cut and its licence.
    expect(readdirSync(path.join(root, "assets/fonts")).sort()).toEqual(["CormorantGaramond-BoldItalic.ttf", "CormorantGaramond-OFL.txt"]);
    expect(readFileSync(path.join(root, "assets/fonts/CormorantGaramond-OFL.txt"), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
    expect(names(font).get(0)).toMatch(/Copyright 2015 The Cormorant Project Authors/);
  });

  it("is loaded on the web, where there is no plugin, once, by the same name, and a failure is let go", () => {
    expect(module).toMatch(
      /if \(Platform\.OS === "web"\) \{\s*require\("expo-font"\)\s*\.loadAsync\(\{ \[FAMILY\]: require\("\.\.\/\.\.\/assets\/fonts\/CormorantGaramond-BoldItalic\.ttf"\) \}\)\s*\.catch\(\(\) => \{\}\);\s*\}/,
    );
    expect(module.match(/\.ttf"/g)).toHaveLength(1);
    // Nowhere else: the editorial card takes it from the module.
    const card = readFileSync(path.join(root, "src/components/feed/EditorialPostCard.tsx"), "utf8");
    expect(card).not.toMatch(/expo-font|\.ttf|"CormorantGaramond/);
    expect(card).toMatch(/^import \{ nameStyle \} from "@\/utils\/nameFace";$/m);
  });
});
