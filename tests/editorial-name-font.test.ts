import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Editorial (Preview): the members' names in Cormorant Garamond Medium
 * Italic, the owner's choice (24 November), and its SemiBold Italic for a
 * name a state marks heavier (an unread thread's).
 *
 * The iPhone finds a font built into the app by its PostScript name, and a
 * name it cannot find falls back to the system font without a word, so the
 * name each cut is asked for by is read here from the font file itself. The
 * files are built in by expo-font's plugin in app.json (UIAppFonts), and
 * travel with their licence. The phone draws the cut of the family nearest
 * the weight asked for, so the weight each is asked for at is the file's
 * own.
 */

const root = path.resolve(import.meta.dirname, "..");
const module = readFileSync(path.join(root, "src/utils/nameFace.ts"), "utf8");

/** The cuts as src/utils/nameFace.ts names them: its key, the PostScript name and the weight it is asked for at. */
const CUTS = [...module.matchAll(/\n {2}(\w+): \{ family: "([^"]+)", weight: "(\d+)" \},/g)].map(([, cut, family, weight]) => ({
  cut,
  family,
  weight: Number(weight),
}));

/** Each cut's file, and what its name table and OS/2 table must say. */
const FILES: Record<string, { file: string; subfamily: string; weight: number }> = {
  medium: { file: "assets/fonts/CormorantGaramond-MediumItalic.ttf", subfamily: "Medium Italic", weight: 500 },
  semibold: { file: "assets/fonts/CormorantGaramond-SemiBoldItalic.ttf", subfamily: "SemiBold Italic", weight: 600 },
};

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
  it("has two cuts, the medium and the semibold, each named as its file names itself, so the phone finds it", () => {
    expect(CUTS.map((c) => c.cut)).toEqual(["medium", "semibold"]);
    for (const { cut, family, weight } of CUTS) {
      const { file, subfamily, weight: own } = FILES[cut];
      const font = readFileSync(path.join(root, file));
      const strings = names(font);
      expect(strings.get(6), cut).toBe(family);
      expect(strings.get(16), cut).toBe("Cormorant Garamond");
      expect(strings.get(17), cut).toBe(subfamily);
      // Its weight and its italic are the file's own: nothing fakes either.
      const os2 = table(font, "OS/2");
      expect(font.readUInt16BE(os2 + 4), cut).toBe(own);
      expect(font.readUInt16BE(os2 + 62) & 1, cut).toBe(1);
      // Asked for at its own weight, so the phone, which draws the family's cut nearest the weight asked for, draws this one.
      expect(weight, cut).toBe(own);
      // The file is named for the PostScript name it holds.
      expect(path.basename(file, ".ttf"), cut).toBe(family);
    }
  });

  it("is built into the iPhone app by expo-font's plugin, both cuts, and carries its licence", () => {
    const app = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
    const plugin = (app.expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === "expo-font") as [string, { fonts: string[] }];
    expect(plugin?.[1].fonts).toEqual([`./${FILES.medium.file}`, `./${FILES.semibold.file}`]);
    for (const { file } of Object.values(FILES)) expect(existsSync(path.join(root, file)), file).toBe(true);
    // The family's one licence covers both cuts.
    expect(readFileSync(path.join(root, "assets/fonts/CormorantGaramond-OFL.txt"), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
    for (const { file } of Object.values(FILES)) {
      expect(names(readFileSync(path.join(root, file))).get(0), file).toMatch(/Copyright 2015 The Cormorant Project Authors/);
    }
  });

  it("is loaded on the web, where there is no plugin, once, by the same names, and a failure is let go", () => {
    expect(module).toMatch(
      /if \(Platform\.OS === "web"\) \{\s*require\("expo-font"\)\s*\.loadAsync\(\{\s*\[CUTS\.medium\.family\]: require\("\.\.\/\.\.\/assets\/fonts\/CormorantGaramond-MediumItalic\.ttf"\),\s*\[CUTS\.semibold\.family\]: require\("\.\.\/\.\.\/assets\/fonts\/CormorantGaramond-SemiBoldItalic\.ttf"\),\s*\}\)\s*\.catch\(\(\) => \{\}\);\s*\}/,
    );
    // Nowhere else: the editorial card, which loaded the medium itself, now takes it from the module.
    const card = readFileSync(path.join(root, "src/components/feed/EditorialPostCard.tsx"), "utf8");
    expect(card).not.toMatch(/expo-font|\.ttf|"CormorantGaramond/);
    expect(card).toMatch(/^import \{ nameStyle \} from "@\/utils\/nameFace";$/m);
  });
});
