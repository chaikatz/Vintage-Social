import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Editorial (Preview): the members' names in Cormorant Garamond Medium
 * Italic, the owner's choice (24 November).
 *
 * The iPhone finds a font built into the app by its PostScript name, and a
 * name it cannot find falls back to the system font without a word, so the
 * name the card asks for is read here from the font file itself. The file
 * is built in by expo-font's plugin in app.json (UIAppFonts), and travels
 * with its licence.
 */

const root = path.resolve(import.meta.dirname, "..");
const FILE = "assets/fonts/CormorantGaramond-MediumItalic.ttf";

/** The name table's Windows-platform strings, by name id. */
function names(font: Buffer): Map<number, string> {
  const tables = font.readUInt16BE(4);
  let at = -1;
  for (let i = 0; i < tables; i++) {
    const record = 12 + 16 * i;
    if (font.toString("latin1", record, record + 4) === "name") at = font.readUInt32BE(record + 8);
  }
  if (at < 0) throw new Error("no name table");
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

describe("the editorial card's name face", () => {
  const card = readFileSync(path.join(root, "src/components/feed/EditorialPostCard.tsx"), "utf8");
  const face = card.match(/const NAME_FACE = "([^"]+)";/)?.[1];

  it("is the font file's own PostScript name, so the phone finds it", () => {
    expect(face).toBe("CormorantGaramond-MediumItalic");
    const font = readFileSync(path.join(root, FILE));
    const table = names(font);
    expect(table.get(6)).toBe(face);
    expect(table.get(16)).toBe("Cormorant Garamond");
    expect(table.get(17)).toBe("Medium Italic");
    // Weight 500 and italic in the file itself, so nothing is set over it.
    const tables = font.readUInt16BE(4);
    let os2 = -1;
    for (let i = 0; i < tables; i++) if (font.toString("latin1", 12 + 16 * i, 16 + 16 * i) === "OS/2") os2 = font.readUInt32BE(12 + 16 * i + 8);
    expect(font.readUInt16BE(os2 + 4)).toBe(500);
    expect(font.readUInt16BE(os2 + 62) & 1).toBe(1);
  });

  it("is built into the iPhone app by expo-font's plugin, and carries its licence", () => {
    const app = JSON.parse(readFileSync(path.join(root, "app.json"), "utf8"));
    const plugin = (app.expo.plugins as unknown[]).find((p) => Array.isArray(p) && p[0] === "expo-font") as [string, { fonts: string[] }];
    expect(plugin?.[1].fonts).toEqual([`./${FILE}`]);
    expect(existsSync(path.join(root, "assets/fonts/CormorantGaramond-OFL.txt"))).toBe(true);
    expect(readFileSync(path.join(root, "assets/fonts/CormorantGaramond-OFL.txt"), "utf8")).toMatch(/SIL Open Font License, Version 1\.1/);
  });

  it("is the face of every name on the card, and only of the names", () => {
    expect(card.match(/fontFamily: NAME_FACE/g)).toHaveLength(2);
    expect(card).toMatch(/\n {2}username: \{ flexShrink: 1, fontFamily: NAME_FACE, fontSize: 14, color: colors\.nameInk \},/);
    expect(card).toMatch(/\n {2}author: \{ fontFamily: NAME_FACE, fontSize: 14, color: colors\.nameInk \},/);
    // Neither a weight nor a style over the face: it is the medium italic itself.
    for (const name of ["username", "author"]) {
      expect(card.match(new RegExp(`\\n {2}${name}: \\{[^\\n]*\\},`))?.[0], name).not.toMatch(/fontWeight|fontStyle/);
    }
    // On the web, where there is no plugin, it is loaded once, by the same name, and a failure is let go.
    expect(card).toMatch(
      /if \(Platform\.OS === "web"\) \{\s*require\("expo-font"\)\s*\.loadAsync\(\{ \[NAME_FACE\]: require\("\.\.\/\.\.\/\.\.\/assets\/fonts\/CormorantGaramond-MediumItalic\.ttf"\) \}\)\s*\.catch\(\(\) => \{\}\);\s*\}/,
    );
  });
});
