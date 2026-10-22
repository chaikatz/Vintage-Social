import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  asksAgain,
  CAPTION_GAP,
  captionHeight,
  DATE_REACH,
  groupTop,
  plateBox,
  plateTrouble,
  TOUCH_TARGET,
  troubleOffline,
  WORD_REACH,
} from "@/components/darkroom/geometry";
import type { PlateTrouble } from "@/components/darkroom/words";

/**
 * The plate's rules that need no screen: when a photograph that will not
 * draw is asked for again (§9.4), how far the caption's two presses reach
 * (§11.6), and the zoom view's settings that keep a print still in its
 * box (§3.4, §5.4). The plate itself is walked in the browser
 * (`e2e/darkroom-test.mjs`).
 */

const read = (file: string) => readFileSync(path.resolve(__dirname, "..", file), "utf8");

type Rule = (trouble: PlateTrouble | null, wasOnline: boolean, online: boolean) => boolean;

/**
 * One plate, as PrintPage runs it: the photograph is asked for, a failure
 * is recorded with its cause, and the network effect decides whether to
 * ask again. `answer` is what the library says each time it is asked:
 * null when the photograph draws, or expo-image's error text.
 */
class Plate {
  trouble: PlateTrouble | null = null;
  asked = 0;
  private wasOnline: boolean;

  constructor(
    private answer: (online: boolean) => string | null,
    private online: boolean,
    private rule: Rule = asksAgain,
  ) {
    this.wasOnline = online;
    this.ask();
  }

  network(online: boolean) {
    this.online = online;
    this.effect();
  }

  private ask() {
    this.asked++;
    if (this.asked > 50) throw new Error("the plate asks for its photograph forever");
    const error = this.answer(this.online);
    this.trouble = error == null ? null : plateTrouble(error, this.online);
    this.effect();
  }

  private effect() {
    const recast = troubleOffline(this.trouble, this.wasOnline, this.online);
    const again = this.rule(this.trouble, this.wasOnline, this.online);
    this.wasOnline = this.online;
    if (recast !== this.trouble) {
      this.trouble = recast;
      return;
    }
    if (again) this.ask();
  }
}

const NOT_FOUND = "Asset with ID 4A7C/L0/001 not found";
const FAILED = "The operation couldn’t be completed";

describe("a plate that cannot draw its photograph (§9.4)", () => {
  it("records why when it fails: gone, offline, or anything else", () => {
    expect(plateTrouble(NOT_FOUND, true)).toBe("missing");
    expect(plateTrouble(NOT_FOUND, false)).toBe("missing");
    expect(plateTrouble("NOT FOUND", true)).toBe("missing");
    expect(plateTrouble(FAILED, true)).toBe("other");
    expect(plateTrouble(FAILED, false)).toBe("offline");
    expect(plateTrouble(undefined, true)).toBe("other");
    expect(plateTrouble(undefined, false)).toBe("offline");
  });

  it("asks again only on the way back online, and never for one gone from the library", () => {
    expect(asksAgain(null, false, true)).toBe(false);
    expect(asksAgain("missing", false, true)).toBe(false);
    expect(asksAgain("offline", false, false)).toBe(false);
    expect(asksAgain("offline", false, true)).toBe(true);
    // A failure reported after the connection came back is still asked for again.
    expect(asksAgain("offline", true, true)).toBe(true);
    expect(asksAgain("other", true, true)).toBe(false);
    expect(asksAgain("other", true, false)).toBe(false);
    expect(asksAgain("other", false, true)).toBe(true);
  });

  it("settles on COULDN’T SHOW THIS ONE when it fails while online", () => {
    const plate = new Plate(() => FAILED, true);
    expect(plate.trouble).toBe("other");
    expect(plate.asked).toBe(1);
  });

  it("would have asked forever under the rule it replaces", () => {
    const old: Rule = (trouble, _wasOnline, online) => online && trouble === "other";
    expect(() => new Plate(() => FAILED, true, old)).toThrow(/forever/);
  });

  it("says IN ICLOUD once the phone goes offline, even after failing while it seemed online", () => {
    // NetInfo had not answered yet (online assumed), or the failure came first.
    const plate = new Plate((online) => (online ? FAILED : FAILED), true);
    expect(plate.trouble).toBe("other");
    plate.network(false);
    expect(plate.trouble).toBe("offline");
    expect(plate.asked).toBe(1);
    plate.network(true);
    expect(plate.asked).toBe(2);
    expect(plate.trouble).toBe("other");
    expect(troubleOffline("missing", true, false)).toBe("missing");
    expect(troubleOffline("other", false, false)).toBe("other");
  });

  it("says IN ICLOUD while offline, and asks once when the phone is back", () => {
    const plate = new Plate((online) => (online ? null : FAILED), false);
    expect(plate.trouble).toBe("offline");
    plate.network(false);
    expect(plate.asked).toBe(1);
    plate.network(true);
    expect(plate.trouble).toBeNull();
    expect(plate.asked).toBe(2);
  });

  it("asks once per return online for one that keeps failing, and then settles", () => {
    const plate = new Plate(() => FAILED, false);
    expect(plate.trouble).toBe("offline");
    plate.network(true);
    expect(plate.trouble).toBe("other");
    expect(plate.asked).toBe(2);
    plate.network(true);
    expect(plate.asked).toBe(2);
    plate.network(false);
    expect(plate.asked).toBe(2);
    plate.network(true);
    expect(plate.trouble).toBe("other");
    expect(plate.asked).toBe(3);
  });

  it("leaves a print gone from the library to the library", () => {
    const plate = new Plate(() => NOT_FOUND, true);
    plate.network(false);
    plate.network(true);
    expect(plate.trouble).toBe("missing");
    expect(plate.asked).toBe(1);
  });

  it("decides in the plate, from the cause it recorded", () => {
    const page = read("src/components/darkroom/PrintPage.tsx");
    expect(page).toMatch(/plateTrouble\(e\?\.error, online\)/);
    expect(page).toMatch(/asksAgain\(trouble, wasOnline\.current, online\)/);
    expect(page).not.toMatch(/online && trouble === "other"/);
  });
});

describe("the caption's presses (§11.6)", () => {
  // Line 1 is 14 pt at the default size. SET ASIDE is 10 pt Courier New
  // with no line height of its own, about 1.13 em: 11.3 pt at the default
  // size and 9.3 at the smallest Dynamic Type size (0.823).
  const LINE_1 = 14;
  const WORD = 10 * 1.13;
  const SMALLEST = 0.823;

  it("makes the date 44 tall, from the plate's edge down over the line", () => {
    expect(DATE_REACH.top + LINE_1 + DATE_REACH.bottom).toBe(TOUCH_TARGET);
    expect(DATE_REACH.top).toBeLessThanOrEqual(CAPTION_GAP);
    expect(DATE_REACH.bottom).toBeLessThanOrEqual(6 + 20);
  });

  it("makes SET ASIDE 44 tall at every type size, without its minimum height moving a letter", () => {
    expect(WORD_REACH.top + WORD * SMALLEST + WORD_REACH.bottom).toBeGreaterThanOrEqual(TOUCH_TARGET);
    expect(TOUCH_TARGET - WORD_REACH.top - WORD_REACH.bottom).toBeLessThanOrEqual(WORD * SMALLEST);
  });

  it("keeps SET ASIDE off the plate beside the date", () => {
    for (const scale of [SMALLEST, 1, 1.5]) {
      const row = Math.max(LINE_1, Math.round(LINE_1 * scale));
      expect(CAPTION_GAP + (row - WORD * scale) / 2 - WORD_REACH.top).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps SET ASIDE's reach on the stage when it has a row of its own under the caption", () => {
    for (const stage of [531, 659]) {
      for (const ratio of [1 / 3, 9 / 16, 3 / 4, 1, 4 / 3, 3]) {
        for (const caption of [captionHeight(1, 1) + 17, captionHeight(1, 2) + 17, captionHeight(2, 2) + 25]) {
          const plate = plateBox(ratio, 393, stage, caption, 3);
          const below = stage - groupTop(stage, plate.height, caption) - plate.height - caption;
          expect(below).toBeGreaterThanOrEqual(WORD_REACH.bottom);
        }
      }
    }
  });

  it("takes each reach back with a margin, and lets a touch through the line and the rule", () => {
    const caption = read("src/components/darkroom/Caption.tsx");
    expect(caption).not.toMatch(/hitSlop=\{\{\s*top/);
    expect(caption).toMatch(/paddingTop: DATE_REACH\.top,[\s\S]*?marginTop: -DATE_REACH\.top,/);
    expect(caption).toMatch(/paddingBottom: DATE_REACH\.bottom,[\s\S]*?marginBottom: -DATE_REACH\.bottom,/);
    expect(caption).toMatch(/paddingTop: WORD_REACH\.top,[\s\S]*?marginTop: -WORD_REACH\.top,/);
    expect(caption).toMatch(/paddingBottom: WORD_REACH\.bottom,[\s\S]*?marginBottom: -WORD_REACH\.bottom,/);
    expect(caption).toMatch(/ownRow: \{[^}]*marginTop: 6 - WORD_REACH\.top/);
    const line = caption.match(/<RoomText\s+kind="line"[^>]*>/)?.[0] ?? "";
    expect(line).toMatch(/pointerEvents="none"/);
    expect(caption).toMatch(/<View style=\{styles\.progressSlot\}[^>]*pointerEvents="none"/);
  });
});

describe("the plate's zoom (§3.4, §5.4)", () => {
  const page = read("src/components/darkroom/PrintPage.tsx");
  const zoom = page.slice(page.indexOf("function Zoom("), page.indexOf("function actualSize("));

  it("does not move under a drag at actual size, and still bounces a pinch", () => {
    expect(zoom).toMatch(/alwaysBounceVertical=\{false\}/);
    expect(zoom).toMatch(/alwaysBounceHorizontal=\{false\}/);
    expect(zoom).toMatch(/\n\s+bouncesZoom\n/);
  });

  it("goes back to actual size without animating, and again as it leaves the screen", () => {
    expect(page).toMatch(/scrollResponderZoomTo\(\{[^}]*animated: false \}, false\)/);
    expect(zoom).toMatch(/useLayoutEffect\(\(\) => \{[\s\S]*?return \(\) => actualSize\(view, latestBox\.current\);[\s\S]*?\}, \[\]\);/);
  });
});
