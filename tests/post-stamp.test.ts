import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startsStamped, stampDate, stampedParams, STAMP_ON } from "@/post/stamp";
import { captureDateFromEpoch } from "@/utils/exif";
import { dateStampText } from "@/utils/time";
import type { PickedParams } from "@/utils/pickForCompose";

/**
 * VINTAGE's date stamp on the Post tab's photograph, as its post will carry
 * it: when it shows, what it says, that it is the posts' own stamp in the
 * posts' own corner, and that the editor starts stamped for a photograph
 * shown stamped.
 */

const root = path.resolve(import.meta.dirname, "..");
const code = (f: string) =>
  readFileSync(path.join(root, f), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const params = (takenAt: string): PickedParams => ({ uri: "file:///p.jpg", mediaType: "photo", width: "1200", height: "1500", duration: "0", takenAt });

describe("the stamp on the photograph", () => {
  it("reads the photograph's own capture date, as the editor will", () => {
    const t = new Date(2026, 10, 25, 9, 14).getTime();
    expect(stampDate({ takenAt: t })).toBe(captureDateFromEpoch(t));
    expect(dateStampText(stampDate({ takenAt: t })!)).toBe("11 25 ’26");
  });

  it("is left off where the photograph has no capture date worth stamping", () => {
    // A clock never set, a date from before photographs, one far ahead of the phone's clock.
    expect(stampDate({ takenAt: 0 })).toBeNull();
    expect(stampDate({ takenAt: 3_600_000 })).toBeNull();
    expect(stampDate({ takenAt: new Date(1850, 0, 1).getTime() })).toBeNull();
    expect(stampDate({ takenAt: Date.now() + 3 * 86_400_000 })).toBeNull();
    expect(stampDate({ takenAt: Number.NaN })).toBeNull();
  });

  it("is the posts' own DateStamp, in the photograph's corner, drawn only when there is a date", () => {
    const hero = code("src/components/post/RollHero.tsx");
    expect(hero).toMatch(/import \{ DateStamp \} from "@\/components\/DateStamp";/);
    expect(hero).toMatch(/const stamp = stampDate\(print\);/);
    expect(hero).toMatch(/\{stamp \? <DateStamp iso=\{stamp\} \/> : null\}/);
    // Inside the photograph's own box (its rect), as a post draws it inside its media.
    const photo = hero.slice(hero.indexOf('testID="post-hero-photo"'), hero.indexOf("</Pressable>"));
    expect(photo).toMatch(/style=\{\[styles\.photo, rect\]\}/);
    expect(photo).toMatch(/<DateStamp/);
    const stamp = code("src/components/DateStamp.tsx");
    expect(stamp).toMatch(/wrap: \{ position: "absolute", right: 14, bottom: 12 \}/);
    expect(code("src/components/PostMedia.tsx")).toMatch(/<DateStamp iso=\{post\.taken_at \?\? post\.created_at\} \/>/);
  });
});

describe("the editor, opened from the photograph", () => {
  it("starts stamped where there is a date to stamp, and as it always has where there is not", () => {
    expect(stampedParams(params("2026-11-25T09:14:00.000Z"))).toEqual({ ...params("2026-11-25T09:14:00.000Z"), stamp: STAMP_ON });
    expect(stampedParams(params(""))).toEqual(params(""));
    expect(startsStamped("on", "2026-11-25T09:14:00.000Z")).toBe(true);
    expect(startsStamped("on", "")).toBe(false);
    expect(startsStamped(undefined, "2026-11-25T09:14:00.000Z")).toBe(false);
    expect(startsStamped("yes", "2026-11-25T09:14:00.000Z")).toBe(false);
  });

  it("is told so only for a photograph of the roll, never for the picker's or the camera's", () => {
    const tab = code("app/(tabs)/create.tsx");
    expect(tab).toMatch(/router\.push\(\{ pathname: "\/compose", params: way === "print" \? stampedParams\(params\) : params \}\)/);
  });

  it("only sets where the stamp starts: the switch and the films keep their say", () => {
    const compose = code("app/compose.tsx");
    expect(compose).toMatch(/useState\(\(\) => startsStamped\(params\.stamp, params\.takenAt\) \|\| dateStampStartsOn\(FILTERS\[0\]\.id\)\)/);
    expect(compose).toMatch(/setStampOn\(dateStampStartsOn\(id\)\);/);
    expect(compose).toMatch(/onValueChange=\{setStampOn\}/);
    expect(compose.match(/startsStamped\(/g)).toHaveLength(1);
  });
});
