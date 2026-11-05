import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The editor as VoiceOver reads it: each film in the tray is a button
 * named for its film, with the chosen one said to be chosen, and the date
 * stamp row is one switch with its date, on or off. Before, the swatches
 * were unnamed and the stamp's Switch was hidden inside a row that said
 * nothing of its state.
 */
const src = readFileSync(path.resolve(import.meta.dirname, "../app/compose.tsx"), "utf8");

describe("the editor's controls", () => {
  it("names each film and says which is chosen", () => {
    const swatch = src.slice(src.indexOf("{FILTERS.map((f) => {"), src.indexOf("</ScrollView>", src.indexOf("{FILTERS.map((f) => {")));
    expect(swatch).toMatch(/onPress=\{\(\) => selectFilter\(f\.id\)\}\s*accessibilityRole="button"\s*accessibilityLabel=\{f\.name\}/);
    expect(swatch).toMatch(/accessibilityState=\{\{ selected \}\}/);
  });

  it("reads the date stamp row as one switch, with its date and its state", () => {
    expect(src).toMatch(
      /onPress=\{\(\) => setStampOn\(!stampOn\)\}\s*accessibilityRole="switch"\s*accessibilityLabel=\{`Date stamp, \$\{stampLabel\}`\}\s*accessibilityState=\{\{ checked: stampOn \}\}/,
    );
  });
});

describe("Who was there", () => {
  const picker = readFileSync(path.resolve(import.meta.dirname, "../src/components/TagPicker.tsx"), "utf8");

  it("reads each member as ticked or not, and full once ten are named", () => {
    expect(picker).toMatch(
      /onPress=\{\(\) => toggle\(item\)\}\s*accessibilityRole="checkbox"\s*accessibilityState=\{\{ checked: on, disabled: !on && selected\.length >= MAX_TAGS \}\}/,
    );
  });
});
