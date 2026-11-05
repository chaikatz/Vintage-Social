import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The print a photograph leaves VINTAGE as is a fixed object: every word
 * on it sits in a box exportLayout measured, at a size that matches the
 * film's natively drawn label. The phone's text size must not reach it.
 */
const src = readFileSync(path.resolve(import.meta.dirname, "../src/components/ExportCard.tsx"), "utf8");

describe("the export print's words", () => {
  const texts = src.match(/<Text\b[^>]*?(?:\/>|>)/gs) ?? [];

  it("are all drawn at the print's own size, never the phone's text size", () => {
    // The stamp, the wordmark, the tagline, the place, the byline and the credit.
    expect(texts.length).toBe(6);
    for (const t of texts) expect(t).toMatch(/allowFontScaling=\{false\}/);
  });
});
