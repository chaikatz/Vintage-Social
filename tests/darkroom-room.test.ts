import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The theme reads the platform for its faces and its dynamic colours; the room reads only its plain strings,
// and the appearance, to know which print's.
const phone = vi.hoisted(() => ({ os: "ios", scheme: "light" as "light" | "dark" | null }));
vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return phone.os;
    },
    select: (o: Record<string, unknown>) => o.ios ?? o.default,
  },
  DynamicColorIOS: (o: { dark: string }) => o.dark,
  useColorScheme: () => phone.scheme,
}));

// What a visit reads besides the library: the phone's own stores, faked in memory.
vi.mock("@/darkroom/develop", () => ({ stillInLibrary: async () => null }));
vi.mock("@/darkroom/history", () => ({
  developedRecently: () => false,
  localDay: () => "2026-10-22",
  seenWithin: () => false,
}));
vi.mock("@/darkroom/session", () => ({ keepChapter: () => undefined, recallChapter: () => null }));
vi.mock("@/darkroom/setAside", () => ({ isSetAside: () => false, setAsidePrints: () => [] }));

/**
 * The room: the rules it decides by that need no screen — where a plate
 * sits and how big it is, every word it says, which way in it opens on,
 * what leaves a chapter as the member turns past it, how a chapter ends —
 * and the dealer that keeps a batch from being lost when the room has
 * moved on. The screen itself is walked in the browser
 * (`e2e/darkroom-test.mjs`).
 */

import {
  bladeDepth,
  captionHeight,
  captionWidth,
  feedCrops,
  groupTop,
  plateBox,
  ratioOf,
  SIGNATURE_RULE,
  SIGNATURE_SHARE,
  signatureGap,
  stageFrame,
  underPlate,
} from "@/components/darkroom/geometry";
import { exportLayout, PRINT_WIDTH } from "@/utils/exportLayout";
import {
  actionNamed,
  captionWords,
  chapterAnnouncement,
  chapterName,
  CONTENTS_BY_YEAR,
  CONTENTS_HINT,
  CONTENTS_INVITE,
  CONTENTS_ORDER,
  CONTENTS_WAYS_IN,
  dayFolio,
  deniedPage,
  emptyPage,
  endPage,
  firstVisitPage,
  monthsOf,
  nextYearWord,
  photographs,
  placeholderWords,
  prunedNote,
  settingsPath,
  shelfSaid,
  spokenActions,
  stageActions,
  stageValue,
  stateWords,
  titleCardWords,
  type DevelopState,
  type EmptyWhy,
  type Ending,
  type StateContext,
} from "@/components/darkroom/words";
import {
  choiceOf,
  dayComplete,
  dayStateOf,
  DEFAULT_DAY_MINIMUM,
  dropOnSettle,
  endingOf,
  opensOnThisDay,
  pageAmong,
  placeIndex,
  startIndex,
  type Chapter,
} from "@/components/darkroom/chapter";
import { appendNew, Dealer, type Reader } from "@/components/darkroom/dealer";
import { contrastRatio, roles, rooms, toneColor, useScheme, type Room, type Scheme } from "@/components/darkroom/room";
import { Visit } from "@/components/darkroom/visit";
import { dark, light } from "@/theme";
import type { LibrarySource, Print } from "@/darkroom/types";

const NOW = new Date(2026, 9, 22, 12, 0).getTime(); // 22 October 2026, noon

function print(id: string, at: number, width = 3000, height = 4000): Print {
  return { id, uri: `ph://${id}`, width, height, takenAt: at, subtypes: [] };
}

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime();

// ---------------------------------------------------------------------------

describe("the room's page", () => {
  const prints: [Scheme, typeof light | typeof dark][] = [
    ["light", light],
    ["dark", dark],
  ];

  /** WCAG 2's contrast ratio, worked out here rather than trusted from the room. */
  function ratio(a: string, b: string): number {
    const lum = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      const [r, g, bl] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    };
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  }

  it("is the app's own page in either print, with the well a step off it and the sheet raised", () => {
    expect(rooms.light.page).toBe(light.paper);
    expect(rooms.dark.page).toBe(dark.paper);
    expect(rooms.light.well).toBe(light.paperSunken);
    expect(rooms.dark.well).toBe(dark.paperRaised);
    for (const [scheme, p] of prints) {
      expect(rooms[scheme].sheet, scheme).toBe(p.paperRaised);
      expect(rooms[scheme].ink, scheme).toBe(p.ink);
      expect(rooms[scheme].line, scheme).toBe(p.border);
      expect(rooms[scheme].lineStrong, scheme).toBe(p.borderStrong);
    }
  });

  it("sets every ink at AA or better on every ground it is set on, in both prints, Increase Contrast or not", () => {
    for (const [scheme] of prints) {
      const r: Room = rooms[scheme];
      for (const contrast of [false, true]) {
        for (const tone of ["ink", "soft", "faint"] as const) {
          for (const ground of [r.page, r.well, r.sheet]) {
            expect(ratio(toneColor(r, tone, contrast), ground), `${scheme} ${tone} on ${ground}`).toBeGreaterThanOrEqual(4.5);
          }
        }
        for (const ground of [r.page, r.sheet]) {
          expect(ratio(toneColor(r, "accent", contrast), ground), `${scheme} accent on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 5);
    expect(contrastRatio(light.inkFaint, light.paper)).toBeCloseTo(ratio(light.inkFaint, light.paper), 5);
  });

  it("takes each ink and the accent from the theme, a step stronger only where the theme's would not read", () => {
    for (const [scheme, p] of prints) {
      const r = rooms[scheme];
      const grounds = [r.page, r.well, r.sheet];
      const reads = (ink: string, on: string[]) => on.every((g) => ratio(ink, g) >= 4.5);
      expect(r.soft, scheme).toBe(reads(p.inkSoft, grounds) ? p.inkSoft : p.ink);
      expect(r.faint, scheme).toBe(reads(p.inkFaint, grounds) ? p.inkFaint : r.soft);
      expect(r.accent, scheme).toBe(reads(p.accent, [r.page, r.sheet]) ? p.accent : p.ink);
    }
    // The light print's faint ink is too pale for the room's small capitals on paper: they are set soft there.
    expect(ratio(light.inkFaint, light.paper)).toBeLessThan(4.5);
    expect(rooms.light.faint).toBe(light.inkSoft);
    // Its accent, burnt sienna, reads on paper: the room's marks are the theme's own.
    expect(rooms.light.accent).toBe(light.accent);
  });

  it("follows the appearance on the iPhone, and keeps to the light print elsewhere, as the theme does", () => {
    try {
      phone.os = "ios";
      phone.scheme = "dark";
      expect(useScheme()).toBe("dark");
      phone.scheme = "light";
      expect(useScheme()).toBe("light");
      phone.scheme = null;
      expect(useScheme()).toBe("light");
      phone.os = "web";
      phone.scheme = "dark";
      expect(useScheme()).toBe("light");
    } finally {
      phone.os = "ios";
      phone.scheme = "light";
    }
  });

  it("pairs every tracked role with its trailing space taken back", () => {
    for (const [name, role] of Object.entries(roles)) {
      const s = role.style as { letterSpacing?: number; marginRight?: number };
      if (s.letterSpacing && s.letterSpacing >= 0.6) expect(s.marginRight, name).toBe(-s.letterSpacing);
    }
  });

  it("sets faint type soft under Increase Contrast in either print, and nothing else changes ink", () => {
    for (const [scheme] of prints) {
      const r = rooms[scheme];
      expect(toneColor(r, "faint", false), scheme).toBe(r.faint);
      expect(toneColor(r, "faint", true), scheme).toBe(r.soft);
      expect(toneColor(r, "accent", true), scheme).toBe(r.accent);
      expect(toneColor(r, "ink", true), scheme).toBe(r.ink);
      expect(toneColor(r, "soft", true), scheme).toBe(r.soft);
    }
  });
});

describe("geometry", () => {
  it("gives the reference phone and the SE their stages", () => {
    expect(stageFrame(852, { top: 59, bottom: 34 })).toEqual({ top: 103, height: 659 });
    expect(stageFrame(667, { top: 20, bottom: 0 })).toEqual({ top: 64, height: 531 });
  });

  it("measures the caption from the signature line as 50 at the default size, capped by line", () => {
    expect(captionHeight(1, 1)).toBe(50);
    expect(captionHeight(1, 2)).toBe(70);
    // Line 1 stops at 1.5, line 2 at 2.0.
    expect(captionHeight(3, 1)).toBe(10 + 21 + 6 + 40);
    expect(captionHeight(3, 2)).toBe(10 + 21 + 6 + 80);
    expect(captionHeight(Number.NaN, 1)).toBe(50);
  });

  it("leaves the print's own paper between the photograph and the signature line", () => {
    // The exported print: its rule sits a sixteenth of its picture's width under the picture.
    const print = exportLayout(1, "print", PRINT_WIDTH);
    expect(SIGNATURE_SHARE).toBe((print.rule.y - (print.photo.y + print.photo.height)) / print.photo.width);
    expect(SIGNATURE_SHARE).toBeCloseTo(1 / 16, 6);
    // The line is the print's rule at the plate's size: 1 pt, as the print's 1.08 at 540 comes to.
    expect(SIGNATURE_RULE).toBe(Math.max(1, Math.floor((print.rule.height / print.photo.width) * 361)));
    // 361 pt on the reference phone: 22⅔ pt, on its third of a point.
    expect(signatureGap(361, 3)).toBeCloseTo(22.67, 2);
    // Under a plate narrower than its 240 pt label, the label's.
    expect(underPlate(187, 50, 3)).toBe(15 + 1 + 50);
    expect(underPlate(361, 50, 3)).toBeCloseTo(22.67 + 1 + 50, 2);
  });

  it("fits the plate to its own shape on the reference phone, with its label under it", () => {
    const at = (r: number) => plateBox(r, 393, 659, 50, 3);
    expect(at(3 / 4).width).toBe(361);
    expect(at(3 / 4).height).toBeCloseTo(481.33, 1);
    expect(at(4 / 3).width).toBe(361);
    expect(Math.round(at(4 / 3).height)).toBe(271);
    expect(Math.round(at(3).height)).toBe(120);
    // A tall print fills the stage less the room above and below, its paper, line and caption included.
    for (const r of [9 / 16, 1 / 3]) {
      const box = at(r);
      expect(box.height + underPlate(box.width, 50, 3), String(r)).toBeCloseTo(659 - 12 - 20, 0);
    }
    expect(Math.round(at(9 / 16).width)).toBe(313);
    expect(at(9 / 16).height).toBeCloseTo(556.33, 1);
    expect(at(1 / 3).width).toBe(187);
  });

  it("keeps an SE's plate to 343 × 445", () => {
    const box = plateBox(0.5, 375, 531, 50, 2);
    expect(box.height).toBeLessThanOrEqual(445);
    expect(box.height + underPlate(box.width, 50, 2)).toBeLessThanOrEqual(531 - 12 - 20);
    expect(plateBox(10, 375, 531, 50, 2).width).toBe(343);
  });

  it("rounds to the screen's own pixels", () => {
    const box = plateBox(4 / 3, 393, 659, 50, 3);
    expect(Math.abs(box.height * 3 - Math.round(box.height * 3))).toBeLessThan(1e-9);
    const gap = signatureGap(box.width, 3);
    expect(Math.abs(gap * 3 - Math.round(gap * 3))).toBeLessThan(1e-9);
  });

  it("hangs the group a little above centre, never under 8", () => {
    expect(groupTop(659, 481, 74)).toBe((659 - 481 - 74) / 2 - 12);
    expect(groupTop(659, 650, 74)).toBe(8);
  });

  it("keeps a caption and its line to the plate's edges, and at least 240 wide", () => {
    expect(captionWidth(361)).toBe(361);
    expect(captionWidth(120)).toBe(240);
  });

  it("treats a print of unknown size as square", () => {
    expect(ratioOf({ width: 0, height: 0 })).toBe(1);
    expect(ratioOf({ width: 4000, height: 3000 })).toBeCloseTo(4 / 3);
  });

  it("closes the blades only over what the feed will crop", () => {
    expect(feedCrops(0.75)).toBe(true);
    expect(feedCrops(0.8)).toBe(false);
    expect(feedCrops(1.91)).toBe(false);
    expect(feedCrops(2)).toBe(true);
    const tall = bladeDepth({ width: 322, height: 573 }, 9 / 16);
    expect(tall?.axis).toBe("vertical");
    expect(tall?.depth).toBeCloseTo((573 - 322 / 0.8) / 2);
    const wide = bladeDepth({ width: 361, height: 120 }, 3);
    expect(wide?.axis).toBe("horizontal");
    expect(wide?.depth).toBeCloseTo((361 - 120 * 1.91) / 2);
    expect(bladeDepth({ width: 361, height: 451 }, 0.8)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("the develop states (§6.3)", () => {
  const ctx = (over: Partial<StateContext> = {}): StateContext => ({ setAside: false, shelfChapter: false, limited: false, ...over });

  it("is DEVELOP and SET ASIDE at rest; PUT BACK on the shelf", () => {
    const w = stateWords({ kind: "idle" }, ctx());
    expect([w.line1, w.line2, w.right?.label, w.bottom.label, w.bottom.ruled]).toEqual([null, null, "Set aside", "Develop", true]);
    expect(stateWords({ kind: "idle" }, ctx({ shelfChapter: true, setAside: true })).right?.label).toBe("Put back");
    // Put back on the shelf, it offers to undo until the page turns.
    expect(stateWords({ kind: "idle" }, ctx({ shelfChapter: true, setAside: false })).right?.label).toBe("Set aside");
  });

  it("draws the rule first, then says DEVELOPING… and drops the caption word", () => {
    const early = stateWords({ kind: "working", slow: false }, ctx());
    expect(early.right).toEqual({ label: "Set aside", act: "toggle", inert: true });
    expect(early.bottom).toMatchObject({ label: "Develop", act: "none", busy: true, dim: false });
    const late = stateWords({ kind: "working", slow: true }, ctx());
    expect(late.right).toBeNull();
    expect(late.bottom.label).toBe("Developing…");
    expect(late.announce).toBe("Developing");
  });

  it("asks before iCloud, and says when it will use mobile data", () => {
    const wifi = stateWords({ kind: "inCloud", network: "wifi" }, ctx());
    expect([wifi.line1, wifi.line2, wifi.right?.label, wifi.bottom.label]).toEqual([
      "Kept in iCloud",
      "Developing it will download it.",
      "Not now",
      "Download and develop",
    ]);
    expect(stateWords({ kind: "inCloud", network: "cellular" }, ctx()).line2).toBe("Developing it will use mobile data.");
  });

  it("brings it down with a rule in place of the line, and STOP", () => {
    const w = stateWords({ kind: "downloading", progress: 0.3 }, ctx());
    expect(w.line1).toBe("Bringing it down from iCloud");
    expect(w.progress).toBe(true);
    expect(w.right?.label).toBe("Stop");
    expect(w.bottom).toMatchObject({ label: "Developing…", dim: true, act: "none" });
  });

  it("dims DEVELOP offline, with the reason VoiceOver reads", () => {
    const w = stateWords({ kind: "offline" }, ctx());
    expect(w.line2).toBe("This iPhone is offline. Set it aside for later.");
    expect(w.bottom).toMatchObject({ dim: true, disabled: true, reason: "Kept in iCloud; this iPhone is offline." });
    expect(w.right?.label).toBe("Set aside");
  });

  it("offers TRY AGAIN when iCloud did not send it, or the file would not open", () => {
    const cloud = stateWords({ kind: "cloudFailed" }, ctx());
    expect([cloud.line1, cloud.line2, cloud.bottom.label, cloud.bottom.act]).toEqual([
      "iCloud didn’t send it",
      "Try again when the connection is better.",
      "Try again",
      "retryCloud",
    ]);
    const local = stateWords({ kind: "unreadable" }, ctx());
    expect([local.line1, local.line2, local.bottom.act]).toEqual(["This one wouldn’t open", "Try again, or set it aside.", "retryLocal"]);
  });

  it("says a missing print is gone, or no longer shared, with REMOVE only for the shelf", () => {
    const full = stateWords({ kind: "missing" }, ctx({ setAside: true }));
    expect([full.line1, full.line2, full.right?.label]).toEqual(["No longer in your library", "It may have been deleted.", "Remove"]);
    expect(full.bottom).toMatchObject({ dim: true, disabled: true });
    const limited = stateWords({ kind: "missing" }, ctx({ limited: true }));
    expect(limited.line1).toBe("No longer available");
    expect(limited.line2).toBe("It may have been deleted, or it’s no longer shared with VINTAGE.");
    expect(limited.right).toBeNull();
    expect(limited.bottom).toMatchObject({ label: "Share more", act: "shareMore", ruled: true });
  });

  it("leaves the caption to the plate when the image said it is gone", () => {
    const w = stateWords({ kind: "gone" }, ctx());
    expect([w.line1, w.line2, w.announce]).toEqual([null, null, null]);
    expect(w.bottom.disabled).toBe(true);
  });

  it("says the placeholders of §9.4", () => {
    expect(placeholderWords("missing", false)).toEqual({ line1: "No longer in your library", line2: "It may have been deleted." });
    expect(placeholderWords("offline", false)).toEqual({ line1: "In iCloud", line2: "It will appear when this iPhone is online." });
    expect(placeholderWords("other", true)).toEqual({ line1: "Couldn’t show this one", line2: "Try it again later." });
  });
});

describe("a print's caption", () => {
  const base = {
    takenAt: day(2019, 9, 22),
    now: NOW,
    mode: "on-this-day" as const,
    reach: "day" as const,
    postedAt: null,
    state: { kind: "idle" } as DevelopState,
    setAside: false,
    shelfChapter: false,
    limited: false,
    shelfFull: false,
  };

  it("hangs the date and how long ago under the plate, with SET ASIDE at the right", () => {
    const c = captionWords(base);
    expect(c.label).toBe("OCTOBER 22, 2019");
    expect(c.line).toBe("Seven years ago today");
    expect(c.word).toEqual({ label: "Set aside", on: false, inert: false, hint: "Keeps it on this iPhone to come back to. Nothing is posted." });
    expect(c.hold).toBe(false);
  });

  it("dots a print set aside, everywhere but the shelf", () => {
    expect(captionWords({ ...base, setAside: true }).word).toMatchObject({ on: true, hint: "Double-tap to put it back." });
    expect(captionWords({ ...base, mode: "set-aside", setAside: true, shelfChapter: true }).word).toMatchObject({ label: "Put back", on: false });
  });

  it("says the shelf is full for its moment, and holds the plate still", () => {
    const c = captionWords({ ...base, shelfFull: true });
    expect(c.line).toBe("The shelf is full. Put one back first.");
    expect(c.hold).toBe(true);
  });

  it("says when a print was posted, on a second line", () => {
    const c = captionWords({ ...base, postedAt: new Date(2026, 4, 3).getTime() });
    expect(c.line).toBe("Seven years ago today · posted in May 2026");
    expect(c.long).toBe(true);
  });

  it("puts a develop state's words in the caption's place", () => {
    const c = captionWords({ ...base, state: { kind: "inCloud", network: "wifi" } });
    expect([c.label, c.line, c.word?.label, c.hold]).toEqual(["Kept in iCloud", "Developing it will download it.", "Not now", true]);
  });

  it("gives VoiceOver the stage's four actions", () => {
    expect(stageActions(day(2014, 7, 1), false).map((a) => a.label)).toEqual(["Develop", "Set aside", "More from 2014", "Contents"]);
    expect(stageActions(day(2014, 7, 1), true)[1].label).toBe("Put back");
  });

  const ctx: StateContext = { setAside: false, shelfChapter: false, limited: false };
  const actionsIn = (state: DevelopState, setAside = false) => {
    const words = stateWords(state, { ...ctx, setAside });
    const busy = state.kind === "working" || state.kind === "downloading";
    return stageActions(day(2014, 7, 1), setAside, { words, stated: state.kind !== "idle", busy });
  };

  it("hands iOS the actions by their words, which is what VoiceOver says on the new architecture", () => {
    const actions = actionsIn({ kind: "idle" }, true);
    // No "increment", "decrement" or "setAside": swiping up and down reaches the adjustable stage unlisted.
    expect(spokenActions(actions)).toEqual([
      { name: "Develop", label: "Develop" },
      { name: "Put back", label: "Put back" },
      { name: "More from 2014", label: "More from 2014" },
      { name: "Contents", label: "Contents" },
    ]);
    expect(actionNamed(actions, "Put back")).toBe("toggle");
    expect(actionNamed(actions, "More from 2014")).toBe("more");
    expect(actionNamed(actions, "contents")).toBe("contents");
    expect(actionNamed(actions, "increment")).toBeNull();
  });

  it("offers STOP under VoiceOver while downloading, and only what does something", () => {
    const down = actionsIn({ kind: "downloading", progress: 0.4 });
    // Pages and Contents are held, the caption thread too: STOP is the way out (§6.3).
    expect(down.map((a) => [a.name, a.label])).toEqual([["stop", "Stop"]]);
    const cloud = actionsIn({ kind: "inCloud", network: "cellular" });
    expect(cloud.map((a) => a.label)).toEqual(["Download and develop", "Not now", "Contents"]);
    const gone = actionsIn({ kind: "missing" }, true);
    expect(gone.map((a) => a.label)).toEqual(["Remove", "Contents"]);
    // With nothing in front of the member, only Contents.
    expect(stageActions(null, false).map((a) => a.label)).toEqual(["Contents"]);
  });

  it("says the mobile-data line before a download, in the announcement and in the stage's value", () => {
    const cellular = stateWords({ kind: "inCloud", network: "cellular" }, ctx);
    expect(cellular.announce).toBe("Kept in iCloud. Developing it will use mobile data.");
    expect(stageValue(day(2019, 9, 22), "Seven years ago today", false, null, cellular)).toBe(
      "October 22, 2019. Seven years ago today. Kept in iCloud. Developing it will use mobile data.",
    );
    const down = stateWords({ kind: "downloading", progress: null }, ctx);
    expect(stageValue(day(2019, 9, 22), "Seven years ago today", false, null, down)).toBe(
      "October 22, 2019. Seven years ago today. Bringing it down from iCloud.",
    );
  });

  it("says the shelf's refusal at the cap aloud, as it says set aside and put back", () => {
    expect(shelfSaid("full")).toBe("The shelf is full. Put one back first.");
    expect(shelfSaid("on")).toBe("Set aside");
    expect(shelfSaid("off")).toBe("Put back");
  });
});

describe("the word pages", () => {
  it("offers exactly one word on the first visit", () => {
    const asking = firstVisitPage("undetermined");
    expect(asking.words).toEqual([{ label: "Continue", act: "continue", hint: "Asks to see your photo library." }]);
    expect(firstVisitPage("granted").words.map((w) => w.label)).toEqual(["Enter"]);
    expect(asking.title).toBe("One photograph at a time.");
    expect(asking.threshold).toBe(true);
    expect(JSON.stringify(asking)).not.toMatch(/Not now/i);
  });

  it("gives the Settings path the phone in hand uses", () => {
    expect(settingsPath(18)).toBe("Settings › Apps › VINTAGE › Photos › Full Access");
    expect(settingsPath(17)).toBe("Settings › VINTAGE › Photos › Full Access");
    expect(deniedPage(18).words.map((w) => w.label)).toEqual(["Open Settings", "Choose one photograph"]);
  });

  it("words every empty state, with the picker always on offer", () => {
    const whys: EmptyWhy[] = ["library", "selection", "few", "tooNew", "day", "shelf", "failed", "exhausted"];
    for (const why of whys) {
      const p = emptyPage(why, { now: NOW, limited: false });
      expect(p.words.some((w) => w.act === "library" || w.act === "pickOne"), why).toBe(true);
    }
    expect(emptyPage("day", { now: NOW, limited: false }).title).toBe("Nothing from October 22.");
    expect(emptyPage("tooNew", { now: NOW, limited: false }).words[0]).toEqual({ label: "Look through 2026", act: "lookThroughYear", year: 2026 });
    expect(emptyPage("tooNew", { now: NOW, limited: true }).words.map((w) => w.act)).toContain("shareMore");
    expect(emptyPage("selection", { now: NOW, limited: true }).words.map((w) => w.label)).toEqual([
      "Choose photographs",
      "Allow full access in Settings",
      "Choose from your library",
    ]);
  });

  it("ends On this day by how far it reached", () => {
    const ctx = { now: NOW, limited: false, years: null };
    expect(endPage({ kind: "day", reach: "day" }, ctx).title).toBe("That is everything from this day.");
    expect(endPage({ kind: "day", reach: "week" }, ctx).title).toBe("That is everything from this week, in other years.");
    expect(endPage({ kind: "day", reach: "season" }, ctx).title).toBe("That is everything from this time of year.");
    expect(endPage({ kind: "day", reach: "day" }, ctx).eyebrow).toBe("October 22");
    expect(endPage({ kind: "day", reach: "day" }, ctx).body).toBe("There will be another tomorrow.");
  });

  it("ends a year with MORE FROM, the next year or the one before, and FROM JANUARY", () => {
    const years = [2014, 2016, 2019].map((year) => ({ year, count: 10 }));
    const mid = endPage({ kind: "year", year: 2016, smaller: true, fromMonth: 7, shown: 12 }, { now: NOW, limited: false, years });
    expect(mid.title).toBe("The end of 2016.");
    expect(mid.body).toBe("The Memory Room showed you some of this year, not all of it.");
    expect(mid.words.map((w) => w.label)).toEqual(["More from 2016", "On to 2019", "From January", "Choose from your library"]);
    const newest = endPage({ kind: "year", year: 2019, smaller: false, fromMonth: 0, shown: 5 }, { now: NOW, limited: false, years });
    expect(newest.body).toBeUndefined();
    expect(newest.words.map((w) => w.label)).toEqual(["More from 2019", "Back to 2016", "Choose from your library"]);
    expect(nextYearWord(2016, null)).toBeNull();
  });

  it("ends a roll, an exhausted Surprise and the shelf", () => {
    const ctx = { now: NOW, limited: true, years: null };
    expect(endPage({ kind: "roll" }, ctx).words.map((w) => w.label)).toEqual([
      "Another roll",
      "Choose a year",
      "Choose from your library",
      "Share more photographs",
    ]);
    expect(endPage({ kind: "exhausted" }, ctx).title).toBe("You’ve seen everything the Memory Room can find for now.");
    expect(endPage({ kind: "shelf" }, { ...ctx, limited: false }).words.map((w) => w.label)).toEqual(["Surprise me", "Choose from your library"]);
  });

  it("never counts what the member did", () => {
    const endings: Ending[] = [{ kind: "roll" }, { kind: "exhausted" }, { kind: "shelf" }, { kind: "day", reach: "day" }];
    for (const e of endings) {
      const text = JSON.stringify(endPage(e, { now: NOW, limited: false, years: null }));
      expect(text).not.toMatch(/\b(twenty-four|\d+ (photographs|prints)|streak|tomorrow, come)/i);
    }
  });
});

describe("the room's other words", () => {
  it("names chapters, cards and announcements", () => {
    expect(chapterName("on-this-day", null)).toBe("On this day");
    expect(chapterName("year", 2016)).toBe("2016");
    expect(chapterAnnouncement("on-this-day", null, NOW)).toBe("On this day, October 22");
    expect(chapterAnnouncement("set-aside", null, NOW)).toBe("Set aside");
    expect(titleCardWords("year", 2016, 7, NOW)).toEqual({ eyebrow: "By year · from August", title: "2016", year: true });
    expect(titleCardWords("year", 2016, 0, NOW)?.eyebrow).toBe("By year");
    expect(titleCardWords("surprise", null, 0, NOW)).toEqual({ eyebrow: "Surprise me", title: "Any year", year: false });
    expect(titleCardWords("set-aside", null, 0, NOW)).toBeNull();
  });

  it("gives VoiceOver the date and the line, and the optional parts only when true", () => {
    const at = day(2019, 9, 22);
    expect(stageValue(at, "Seven years ago today", true, new Date(2026, 4, 3).getTime())).toBe(
      "October 22, 2019. Seven years ago today. Set aside. Posted in May 2026.",
    );
    expect(stageValue(at, "Seven years ago today", false, null)).toBe("October 22, 2019. Seven years ago today.");
  });

  it("sets the Contents folios", () => {
    expect(dayFolio("unknown", NOW)).toBe("OCT 22");
    expect(dayFolio("day", NOW)).toBe("OCT 22");
    expect(dayFolio("week", NOW)).toBe("This week");
    expect(dayFolio("season", NOW)).toBe("Around this time");
    expect(dayFolio("none", NOW)).toBe("Nothing today");
    expect(photographs(1)).toBe("1 photograph");
    expect(photographs(1204)).toBe("1,204 photographs");
  });

  it("says under CONTENTS what is in it, and heads each part of the sheet as an index does", () => {
    expect(CONTENTS_INVITE).toBe("Every way in is here: this day, a roll, any year.");
    // VoiceOver hears the same from CONTENTS itself.
    expect(CONTENTS_HINT).toBe("Choose a way in, a year or a month.");
    expect([CONTENTS_WAYS_IN, CONTENTS_BY_YEAR, CONTENTS_ORDER]).toEqual(["Ways in", "By year", "Oldest first"]);
    expect(monthsOf(2016)).toBe("The months of 2016");
    // The year's heading is the chapter's own name for a year, as its title card says it.
    expect(CONTENTS_BY_YEAR).toBe(chapterName("year", null));
    expect(titleCardWords("year", 2016, 0, NOW)?.eyebrow).toBe(CONTENTS_BY_YEAR);
  });

  it("says the pruning once, in words", () => {
    expect(prunedNote(0)).toBeNull();
    expect(prunedNote(1)).toBe("One you set aside is no longer in your library.");
    expect(prunedNote(2)).toBe("Two you set aside are no longer in your library.");
  });

  it("is set with typographer’s marks and never an exclamation", () => {
    const source = readFileSync(path.resolve(__dirname, "../src/components/darkroom/words.ts"), "utf8");
    const strings = source.match(/"[^"\n]*"|`[^`\n]*`/g) ?? [];
    for (const s of strings) {
      expect(s, s).not.toMatch(/!/);
      expect(s, s).not.toMatch(/\.\.\./);
      expect(s, s).not.toMatch(/[A-Za-z]'[A-Za-z]/);
    }
  });
});

// ---------------------------------------------------------------------------

describe("chapters", () => {
  const moments = (n: number) => Array.from({ length: n }, (_, i) => print(`d${i}`, day(2010 + i, 9, 22)));

  it("opens On this day when the day itself holds three, and it was not finished today", () => {
    expect(opensOnThisDay({ reach: "day", prints: moments(DEFAULT_DAY_MINIMUM) }, null, "2026-10-22")).toBe(true);
    expect(opensOnThisDay({ reach: "day", prints: moments(2) }, null, "2026-10-22")).toBe(false);
    expect(opensOnThisDay({ reach: "week", prints: moments(6) }, null, "2026-10-22")).toBe(false);
    expect(opensOnThisDay({ reach: "day", prints: moments(6) }, "2026-10-22", "2026-10-22")).toBe(false);
    expect(opensOnThisDay({ reach: "day", prints: moments(6) }, "2026-10-21", "2026-10-22")).toBe(true);
    expect(opensOnThisDay(null, null, "2026-10-22")).toBe(false);
  });

  it("knows when the day alone was asked, and what Contents may say", () => {
    expect(dayComplete({ reach: "day", prints: moments(2) })).toBe(false);
    expect(dayComplete({ reach: "week", prints: moments(2) })).toBe(true);
    expect(dayStateOf({ reach: "day", prints: moments(1) })).toBe("unknown");
    expect(dayStateOf({ reach: "season", prints: [] })).toBe("none");
    expect(dayStateOf({ reach: "week", prints: moments(4) })).toBe("week");
    expect(dayStateOf(null)).toBe("unknown");
  });

  it("opens at a given print, or at a year's first", () => {
    const list = [print("a", day(2012, 9, 22)), print("b", day(2015, 9, 22)), print("c", day(2015, 9, 23))];
    expect(startIndex(list, { startId: "c" })).toBe(2);
    expect(startIndex(list, { startYear: 2015 })).toBe(1);
    expect(startIndex(list, { startId: "gone", startYear: 2030 })).toBe(0);
  });

  it("takes out a print put back once the member has turned from it, and keeps the place", () => {
    const list = ["a", "b", "c", "d"].map((id, i) => print(id, day(2015, 0, i + 1)));
    const gone = new Set(["b"]);
    // Still in front: it stays, so tapping again undoes it.
    expect(dropOnSettle(list, 1, (p) => gone.has(p.id)).prints).toHaveLength(4);
    // Turned past: it goes, and the index follows the print it stood on.
    const past = dropOnSettle(list, 2, (p) => gone.has(p.id));
    expect(past.prints.map((p) => p.id)).toEqual(["a", "c", "d"]);
    expect(past.index).toBe(1);
    expect(past.rebased).toBe(true);
    // Ahead of the member: nothing before moves, so no rebase.
    const ahead = dropOnSettle(list, 0, (p) => p.id === "d");
    expect(ahead).toMatchObject({ index: 0, rebased: false });
    expect(ahead.prints.map((p) => p.id)).toEqual(["a", "b", "c"]);
    // On the end page, everything that left goes, and the end page stays the end.
    const end = dropOnSettle(list, 4, (p) => gone.has(p.id));
    expect(end.index).toBe(3);
  });

  it("finds the place's print again, or holds the index in range", () => {
    const list = ["a", "b", "c"].map((id, i) => print(id, day(2015, 0, i + 1)));
    expect(placeIndex(list, { deck: [list[2], list[1]], index: 1 })).toBe(1);
    expect(placeIndex(list, { deck: [print("x", 0)], index: 7 })).toBe(3);
  });

  it("comes back to the end page of a kept chapter, not twenty prints before it", () => {
    // A roll of 24 read to its end: the deck kept prints 4–23, and the end page as index 20.
    const roll = Array.from({ length: 24 }, (_, i) => print(`r${i}`, day(2010 + (i % 12), i % 12, 1)));
    const deck = roll.slice(4);
    expect(placeIndex(roll, { deck, index: deck.length })).toBe(24);
    // An 87-print year left on its end page.
    const year = Array.from({ length: 87 }, (_, i) => print(`y${i}`, day(2016, Math.floor(i / 8), (i % 8) + 1)));
    expect(placeIndex(year, { deck: year.slice(67), index: 20 })).toBe(87);
    // The deck itself, restored from disk, is still its own end page.
    expect(placeIndex(deck, { deck, index: deck.length })).toBe(deck.length);
  });

  it("finds a restored deck's page among the whole day, so the prints before it come back", () => {
    const whole = Array.from({ length: 40 }, (_, i) => print(`d${i}`, day(1990 + i, 9, 22)));
    const deck = whole.slice(10);
    expect(pageAmong(whole, deck, 20)).toBe(30);
    expect(pageAmong(whole, deck, deck.length)).toBe(40);
    expect(pageAmong(whole, [print("elsewhere", 0)], 0)).toBeNull();
  });

  describe("a choice in Contents", () => {
    const year2016 = (months: number[]) => months.map((m, i) => print(`m${i}`, day(2016, m, 1 + (i % 20))));
    const opened = (month: number, prints: Print[], index: number) => ({
      showing: true,
      where: { mode: "year" as const, year: 2016, month },
      chapter: { prints, index },
    });

    it("leaves the chapter already open, or its year line, as it is", () => {
      expect(choiceOf({ showing: true, where: { mode: "surprise", year: null, month: 0 }, chapter: null }, "surprise", null, null)).toBeNull();
      expect(choiceOf(opened(0, year2016([0, 1]), 0), "year", 2016, null)).toBeNull();
    });

    it("turns back to the month the chapter opened at, from its first print, when the member has read on", () => {
      const prints = year2016([0, 0, 2, 5, 5]);
      // Opened at January, now in June: JAN is not a dead tap.
      expect(choiceOf(opened(0, prints, 3), "year", 2016, 0)).toEqual({ mode: "year", year: 2016, month: 0, jump: true, startId: "m0" });
      // Opened at August by the caption thread, read on to October: AUG goes back to August.
      const august = year2016([7, 7, 9]);
      expect(choiceOf(opened(7, august, 2), "year", 2016, 7)).toMatchObject({ month: 7, jump: true, startId: "m0" });
      // On the end page too.
      expect(choiceOf(opened(0, prints, prints.length), "year", 2016, 0)).toMatchObject({ startId: "m0" });
    });

    it("does nothing for the month already in view", () => {
      expect(choiceOf(opened(0, year2016([0, 0, 2]), 1), "year", 2016, 0)).toBeNull();
    });

    it("opens another month of the year as a jump, to its own kept position (§4.3)", () => {
      expect(choiceOf(opened(0, year2016([0, 5]), 1), "year", 2016, 7)).toEqual({ mode: "year", year: 2016, month: 7, jump: true });
      expect(choiceOf(opened(0, year2016([0]), 0), "year", 2019, null)).toEqual({ mode: "year", year: 2019, month: 0, jump: false });
    });
  });

  it("ends each chapter on its own page", () => {
    const base: Chapter = {
      key: "on-this-day",
      mode: "on-this-day",
      year: null,
      month: 0,
      prints: [],
      index: 0,
      more: false,
      reach: "week",
      failed: false,
      generation: 1,
      rebase: 0,
    };
    expect(endingOf(base, null)).toEqual({ kind: "day", reach: "week" });
    expect(endingOf({ ...base, mode: "set-aside" }, null)).toEqual({ kind: "shelf" });
    expect(endingOf({ ...base, failed: true }, null)).toEqual({ kind: "readFailed" });
    const roll = new Dealer("surprise", { next: async () => [], done: true, ending: "exhausted" }, { orphan: () => undefined });
    expect(endingOf({ ...base, mode: "surprise" }, roll)).toEqual({ kind: "exhausted" });
    const edit = new Dealer("year:2016:7", { next: async () => [], done: true, size: 87, yearCount: 1204 }, { orphan: () => undefined });
    expect(endingOf({ ...base, mode: "year", year: 2016, month: 7, prints: [print("a", 0)] }, edit)).toEqual({
      kind: "year",
      year: 2016,
      smaller: true,
      fromMonth: 7,
      shown: 1,
    });
  });
});

// ---------------------------------------------------------------------------

/** A reader that deals from a list, `step` at a time, with a hand on when each batch lands. */
function fakeReader(all: Print[], opts: { gate?: () => Promise<void>; fail?: boolean } = {}) {
  let at = 0;
  const calls: number[] = [];
  const reader: Reader = {
    async next(count: number) {
      calls.push(count);
      if (opts.gate) await opts.gate();
      if (opts.fail) throw new Error("The library did not answer");
      const out = all.slice(at, at + count);
      at += out.length;
      return out;
    },
    get done() {
      return at >= all.length;
    },
  };
  return { reader, calls };
}

describe("the dealer", () => {
  const prints = Array.from({ length: 10 }, (_, i) => print(`p${i}`, day(2016, 0, i + 1)));

  it("hands a batch to the room showing the chapter", async () => {
    const { reader } = fakeReader(prints);
    const orphan = vi.fn();
    const d = new Dealer("year:2016:0", reader, { orphan });
    const got: string[][] = [];
    d.listener = (batch, more) => got.push([...batch.map((p) => p.id), String(more)]);
    await d.read(4);
    expect(got).toEqual([["p0", "p1", "p2", "p3", "true"]]);
    expect(orphan).not.toHaveBeenCalled();
  });

  it("keeps a batch that lands after the room has gone, for the chapter's kept position", async () => {
    let release = () => undefined as void;
    const gate = () => new Promise<void>((r) => (release = r));
    const { reader } = fakeReader(prints, { gate });
    const orphan = vi.fn();
    const d = new Dealer("year:2016:0", reader, { orphan });
    d.listener = vi.fn();
    const reading = d.read(4);
    // The room leaves while the batch is in flight.
    d.release();
    release();
    await reading;
    expect(orphan).toHaveBeenCalledTimes(1);
    expect(orphan.mock.calls[0][1].map((p: Print) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(orphan.mock.calls[0][2]).toBe(true);
  });

  it("asks the reader once however many rooms ask, and the next room gets the batch", async () => {
    let release = () => undefined as void;
    const gate = () => new Promise<void>((r) => (release = r));
    const { reader, calls } = fakeReader(prints, { gate });
    const d = new Dealer("surprise", reader, { orphan: vi.fn() });
    const first = d.read(3);
    const second = d.read(3);
    expect(calls).toEqual([3]);
    // A new room takes the chapter up while the read is in flight.
    const seen = vi.fn();
    d.listener = seen;
    release();
    await Promise.all([first, second]);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0][0]).toHaveLength(3);
  });

  it("is done when the reader is", async () => {
    const { reader } = fakeReader(prints.slice(0, 2));
    const d = new Dealer("year:2016:0", reader, { orphan: vi.fn() });
    const seen = vi.fn();
    d.listener = seen;
    await d.read(12);
    expect(seen.mock.calls[0][1]).toBe(false);
    expect(d.more).toBe(false);
  });

  it("says a read failed rather than waiting for ever", async () => {
    const { reader } = fakeReader(prints, { fail: true });
    const d = new Dealer("year:2016:0", reader, { orphan: vi.fn() });
    const seen = vi.fn();
    d.listener = seen;
    await d.read(4);
    expect(seen).toHaveBeenCalledWith([], false, true);
    expect(d.failed).toBe(true);
  });

  it("waits for a reader still being built, and ends if it cannot be", async () => {
    const { reader } = fakeReader(prints);
    const built = new Dealer("surprise", Promise.resolve(reader), { orphan: vi.fn() });
    expect(built.more).toBe(true);
    const seen = vi.fn();
    built.listener = seen;
    await built.read(2);
    expect(seen.mock.calls[0][0]).toHaveLength(2);

    const never = new Dealer("surprise", Promise.reject(new Error("no months")), { orphan: vi.fn() });
    const told = vi.fn();
    never.listener = told;
    await never.read(2);
    expect(told).toHaveBeenCalledWith([], false, true);
    expect(never.more).toBe(false);
  });

  it("keeps out what a restored deck already holds, and deals on at once", async () => {
    const { reader } = fakeReader(prints);
    const last = prints[3].takenAt;
    const d = new Dealer("year:2016:0", reader, { orphan: vi.fn(), accept: (p) => p.takenAt > last });
    const seen: string[][] = [];
    d.listener = (batch) => seen.push(batch.map((p) => p.id));
    await d.read(4);
    // The first four were the deck's; the dealer asks again without being asked.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(seen[0]).toEqual([]);
    expect(seen.flat()).toEqual(["p4", "p5", "p6", "p7"]);
  });

  describe("a roll with nowhere yet to draw from", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("asks again a few times, then ends rather than leaving a waiting page", async () => {
      const reader: Reader = { next: async () => [], done: false };
      const d = new Dealer("surprise", reader, { orphan: vi.fn() });
      const seen = vi.fn();
      d.listener = seen;
      await d.read(3);
      expect(d.more).toBe(true);
      await vi.advanceTimersByTimeAsync(1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(d.more).toBe(false);
      expect(seen.mock.calls.at(-1)?.[1]).toBe(false);
      // The year index arrives: it may deal again.
      const withYears: Reader = { ...reader, setYears: () => undefined };
      const e = new Dealer("surprise", withYears, { orphan: vi.fn() });
      e.listener = vi.fn();
      await e.read(3);
      await vi.advanceTimersByTimeAsync(3000);
      e.setYears([{ year: 2016, count: 40 }]);
      expect(e.more).toBe(true);
      e.release();
    });
  });

  it("tells a roll still being built the year index that arrived meanwhile", async () => {
    const told = vi.fn();
    let build = (_: Reader) => undefined as void;
    const building = new Promise<Reader>((r) => (build = r));
    const d = new Dealer("surprise", building, { orphan: vi.fn() });
    const years = [{ year: 2016, count: 40 }];
    d.setYears(years);
    expect(d.hasYears).toBe(true);
    build({ next: async () => [], done: false, setYears: told });
    await d.read(3);
    expect(told).toHaveBeenCalledWith(years);
    d.release();
  });

  it("is not started over when given the same year index again", async () => {
    const told = vi.fn();
    const d = new Dealer("surprise", { next: async () => [], done: false, setYears: told }, { orphan: vi.fn() });
    const years = [{ year: 2016, count: 40 }];
    d.setYears(years);
    d.setYears(years);
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("appends only what is new", () => {
    const a = [prints[0], prints[1]];
    expect(appendNew(a, [prints[1], prints[2]]).map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
    expect(appendNew(a, [prints[0]])).toBe(a);
  });
});

describe("a visit", () => {
  /** A library of ten photographs a year since 2015, none of them on this day; it counts how often it is asked its oldest date. */
  function library() {
    const asked = { oldest: 0 };
    const source: LibrarySource = {
      count: async (_, subtype) => (subtype ? 0 : 10),
      page: async () => ({ prints: [], hasNextPage: false }),
      oldest: async () => {
        asked.oldest += 1;
        return day(2015, 0, 1);
      },
    };
    return { source, asked };
  }

  it("asks the library its oldest date once, however many readers want it, and again after a change", async () => {
    const { source, asked } = library();
    const visit = new Visit(source);
    visit.libraryChanged(true);
    const first = await visit.oldest();
    await visit.askDayOnly(Date.now());
    await visit.askDay();
    await visit.years(true);
    visit.surprise(first);
    expect(asked.oldest).toBe(1);
    visit.libraryChanged(false);
    await visit.years(true);
    expect(asked.oldest).toBe(2);
  });

  it("gives the year index to a roll begun cold, even when another room counted it", async () => {
    const { source } = library();
    const room = new Visit(source);
    room.libraryChanged(true);
    const told = vi.fn();
    const d = room.surpriseDealer("surprise", { next: async () => [], done: false, setYears: told });
    expect(d.hasYears).toBe(false);
    // Another room's visit counts the years; this one then finds them fresh.
    await new Visit(source).years(true);
    const years = await room.years();
    expect(told).toHaveBeenCalledWith(years);
    expect(d.hasYears).toBe(true);
  });

  it("tells a roll kept from an earlier room the years this room reads", async () => {
    const { source } = library();
    const earlier = new Visit(source);
    earlier.libraryChanged(true);
    const told = vi.fn();
    const kept = earlier.surpriseDealer("surprise", { next: async () => [], done: false, setYears: told });
    const room = new Visit(source);
    room.adopt(kept, null);
    expect(kept.hasYears).toBe(false);
    const years = await room.years(true);
    expect(told).toHaveBeenLastCalledWith(years);
  });
});

// ---------------------------------------------------------------------------

describe("the room's own rules, in its source", () => {
  const roots = ["app/darkroom.tsx", "src/darkroom/useDarkroom.ts", "src/components/darkroom"].map((p) => path.resolve(__dirname, "..", p));
  const files: string[] = [];
  for (const root of roots) {
    if (root.endsWith(".ts") || root.endsWith(".tsx")) files.push(root);
    else for (const f of readdirSync(root)) if (/\.tsx?$/.test(f)) files.push(path.join(root, f));
  }
  const read = (f: string) => readFileSync(f, "utf8");

  it("never reads the appearance's dynamic colours, or the components that do", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/\bcolors\.[a-zA-Z]/);
      expect(src, f).not.toMatch(/components\/(GateButton|Button|EmptyState|Bone|Screen)\b/);
    }
  });

  it("takes every colour from the print the app is showing, through the room's Look", () => {
    for (const f of files) {
      const src = read(f);
      const name = path.basename(f);
      // No colour of its own, and no print fixed in place.
      expect(src, name).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(/);
      if (name !== "room.ts") expect(src, name).not.toMatch(/\b(dark|light)\.[a-zA-Z]+/);
      // The two prints are chosen in one place, by the appearance.
      if (!["room.ts", "look.ts", "darkroom.tsx"].includes(name)) expect(src, name).not.toMatch(/\brooms(\.|\[)|import \{[^}]*\brooms\b/);
    }
    const screen = read(files.find((f) => f.endsWith("app/darkroom.tsx"))!);
    expect(screen).toMatch(/const scheme = useScheme\(\);/);
    expect(screen).toMatch(/room: rooms\[scheme\]/);
    expect(screen).toMatch(/\[scheme, contrast, bold, reduceMotion, screenReader\]/);
    expect(screen).toMatch(/style=\{\[styles\.root, \{ backgroundColor: look\.room\.page \}\]\}/);
  });

  it("makes CONTENTS plainly a control: an open book and the word in a ruled tab, a 44 pt press", () => {
    const head = read(files.find((f) => f.endsWith("RunningHead.tsx"))!);
    const control = head.slice(head.indexOf('testID="darkroom-contents"') - 700, head.indexOf("darkroom-contents-invite"));
    expect(control).toMatch(/accessibilityLabel="Contents"/);
    expect(control).toMatch(/accessibilityHint=\{held \? undefined : CONTENTS_HINT\}/);
    expect(control).toMatch(/<Feather name="book-open" size=\{14\} color=\{room\.ink\} accessible=\{false\} \/>/);
    expect(control).toMatch(/<RoomText kind="tab"[^>]*>\s*Contents\s*<\/RoomText>/);
    expect(head).toMatch(/contents: \{ minHeight: 44, minWidth: 44,/);
    expect(head).toMatch(/tab: \{[^}]*minHeight: 30,[^}]*borderWidth: 1,/);
    // Ruled in the accent until Contents is first opened; then the firm line, the soft ink under Increase Contrast.
    expect(head).toMatch(/const edge = invite \? room\.accent : contrast \? room\.soft : room\.lineFirm;/);
    expect(head).toMatch(/style=\{\[styles\.tab, \{ borderColor: edge \}\]\}/);
    expect(roles.tab.tone).toBe("ink");
    expect(roles.tab.style.fontSize).toBeGreaterThan(roles.head.style.fontSize);
  });

  it("says under CONTENTS what is in it until Contents is first opened, and remembers that on the phone", () => {
    const head = read(files.find((f) => f.endsWith("RunningHead.tsx"))!);
    const invite = head.slice(head.indexOf("{contents && invite ? ("), head.indexOf("const styles"));
    expect(invite).toMatch(/onPress=\{onContents\}/);
    expect(invite).toMatch(/\{CONTENTS_INVITE\}/);
    // For the eye: VoiceOver hears it from CONTENTS's hint.
    expect(invite).toMatch(/accessible=\{false\}\s+accessibilityElementsHidden\s+importantForAccessibility="no-hide-descendants"/);
    const screen = read(files.find((f) => f.endsWith("app/darkroom.tsx"))!);
    expect(screen).toMatch(/const \[found, setFound\] = useState\(contentsFound\);/);
    expect(screen).toMatch(/invite=\{!found\}/);
    // Every way into the sheet goes through showContents, which marks it found once it opens.
    expect(screen).toMatch(
      /const showContents = \(months = false\) => \{\s*if \(develop\.busy\) return;\s*sheet\.show\(months\);\s*if \(!found\) \{\s*markContentsFound\(\);\s*setFound\(true\);/,
    );
    expect(screen.match(/sheet\.show\(/g)).toHaveLength(1);
  });

  it("reads the sheet as a guided index, and marks where you are", () => {
    const sheet = read(files.find((f) => f.endsWith("Contents.tsx"))!);
    expect(sheet).toMatch(/<Section title=\{CONTENTS_WAYS_IN\} first/);
    expect(sheet).toMatch(/<Section title=\{CONTENTS_BY_YEAR\} aside=\{CONTENTS_ORDER\}/);
    expect(sheet).toMatch(/\{monthsOf\(y\.year\)\}/);
    // Each heading is a heading to VoiceOver.
    const section = sheet.slice(sheet.indexOf("function Section("), sheet.indexOf("function Line("));
    expect(section).toMatch(/accessibilityRole="header"/);
    expect(sheet.match(/accessibilityRole="header"/g)?.length).toBeGreaterThanOrEqual(3);
    // Where you are: the ribbon, the title in the accent, the folio soft, and selected to VoiceOver.
    const line = sheet.slice(sheet.indexOf("function Line("), sheet.indexOf("function Month("));
    expect(line).toMatch(/backgroundColor: current \? room\.accent : "transparent"/);
    expect(line).toMatch(/tone=\{disabled \? "faint" : current \? "accent" : "ink"\}/);
    expect(line).toMatch(/tone=\{current \? "soft" : undefined\}/);
    expect(line).toMatch(/accessibilityState=\{\{ selected: current, disabled \}\}/);
    expect(sheet).toMatch(/ribbon: \{ width: 3, height: 22,/);
    const month = sheet.slice(sheet.indexOf("function Month("), sheet.indexOf("const styles"));
    expect(month).toMatch(/tone=\{empty \? "faint" : inView \? "accent" : "soft"\}/);
    expect(month).toMatch(/accessibilityState=\{\{ disabled: empty, selected: inView \}\}/);
  });

  it("leaves the status bar to the app, which follows the appearance as the room does", () => {
    for (const f of files) expect(read(f), path.basename(f)).not.toMatch(/expo-status-bar|setStatusBarStyle|StatusBar\b/);
    expect(read(path.resolve(__dirname, "../app/_layout.tsx"))).toMatch(/<StatusBar style="auto" \/>/);
  });

  it("raises no alert and gives no failure haptic", () => {
    for (const f of files) {
      const src = read(f);
      expect(src, f).not.toMatch(/showAlert|Alert\.alert/);
      expect(src, f).not.toMatch(/notificationAsync/);
    }
  });

  it("reads no location, metadata, moments or albums, never prefetches a photograph, logs or sends", () => {
    const forbidden = [
      /\.location\b/,
      /exif/i,
      /getMomentsAsync/,
      /getAlbums?Async/,
      /\bfetch\(/,
      /supabase/i,
      /Image\.prefetch/,
      /console\./,
      /getAssetInfoAsync/,
      /pairedVideoAsset/,
      /\bafter\s*:/,
    ];
    for (const f of files) {
      const src = read(f);
      for (const rule of forbidden) expect({ file: path.basename(f), hit: rule.test(src) }).toEqual({ file: path.basename(f), hit: false });
    }
  });

  it("keeps the proof out of the image cache", () => {
    const page = read(path.resolve(__dirname, "../src/components/darkroom/PrintPage.tsx"));
    expect(page).toMatch(/cachePolicy="none"/);
    expect(page).toMatch(/cachePolicy="memory"/);
    expect(page).not.toMatch(/memory-disk|cachePolicy="disk"/);
  });
});
