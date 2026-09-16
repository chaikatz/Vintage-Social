import { describe, expect, it } from "vitest";
import {
  PRINT_WIDTH,
  STORY_WIDTH,
  exportByline,
  exportLabelText,
  exportLayout,
  memberCredit,
  placeLineCount,
  printRatio,
} from "@/utils/exportLayout";

describe("the shape of a print", () => {
  it("clamps the photograph the way the feed does", () => {
    expect(printRatio(1000, 1000)).toBe(1);
    expect(printRatio(900, 1600)).toBeCloseTo(0.8);
    expect(printRatio(4000, 1000)).toBeCloseTo(1.91);
    expect(printRatio(null, 100)).toBe(1);
  });

  it("wraps the photograph in paper with the label underneath", () => {
    const L = exportLayout(1, "print", PRINT_WIDTH);
    expect(L.width).toBe(PRINT_WIDTH);
    expect(L.photo.x).toBe(L.margin);
    expect(L.photo.y).toBe(L.margin);
    expect(L.photo.width).toBe(PRINT_WIDTH - 2 * L.margin);
    expect(L.photo.height).toBe(L.photo.width);
    // The rule sits below the picture, the words below the rule, the page ends after them.
    expect(L.rule.y).toBeGreaterThan(L.photo.y + L.photo.height);
    expect(L.wordmark.y).toBeGreaterThan(L.rule.y);
    expect(L.credit.y + L.credit.height).toBeLessThan(L.height - L.margin / 2);
    // Words on the left, words on the right, never overlapping; the right
    // block reads top to bottom: place, date, member.
    expect(L.wordmark.x + L.wordmark.width).toBeLessThanOrEqual(L.byline.x);
    expect(L.byline.x + L.byline.width).toBe(PRINT_WIDTH - L.margin);
    expect(L.place.y).toBeLessThan(L.byline.y);
    expect(L.byline.y).toBeLessThan(L.credit.y);
  });

  it("puts a story on a 9:16 page and keeps the print inside it", () => {
    const tall = exportLayout(0.8, "story", STORY_WIDTH);
    expect(tall.height).toBe(640);
    expect(tall.photo.y).toBeGreaterThanOrEqual(tall.margin);
    expect(tall.credit.y + tall.credit.height).toBeLessThanOrEqual(tall.height - tall.margin);
    // A wide film has room to spare and is centred, not pinned to the top.
    const wide = exportLayout(1.91, "story", STORY_WIDTH);
    expect(wide.photo.y).toBeGreaterThan(wide.margin * 3);
    expect(wide.photo.width).toBe(STORY_WIDTH - 2 * wide.margin);
  });

  it("scales with width so the still and the film match", () => {
    const small = exportLayout(1.5, "print", 540);
    const big = exportLayout(1.5, "print", 1620);
    expect(big.height / small.height).toBeCloseTo(3, 1);
    expect(big.wordmark.size / small.wordmark.size).toBeCloseTo(3, 1);
    expect(big.stamp.y / small.stamp.y).toBeCloseTo(3, 1);
  });

  it("keeps the stamp inside the photograph, bottom right", () => {
    const L = exportLayout(1, "print", PRINT_WIDTH);
    expect(L.stamp.x + L.stamp.width).toBeLessThan(L.photo.x + L.photo.width);
    expect(L.stamp.y + L.stamp.height).toBeLessThan(L.photo.y + L.photo.height);
    expect(L.stamp.y).toBeGreaterThan(L.photo.y + L.photo.height / 2);
  });
});

describe("the label's words", () => {
  const post = {
    location: "The Metropolitan Museum of Art",
    taken_at: "2026-09-15T14:00:00Z",
    created_at: "2026-09-16T09:00:00Z",
    author: { username: "chai" },
  };

  it("wraps a long place to two lines rather than cutting it off", () => {
    expect(placeLineCount("NYC")).toBe(1);
    expect(placeLineCount("The Metropolitan Museum of Art")).toBe(2);
    expect(placeLineCount("")).toBe(0);
    expect(placeLineCount(null)).toBe(0);
    const one = exportLayout(1, "print", PRINT_WIDTH, { placeLines: 1 });
    const two = exportLayout(1, "print", PRINT_WIDTH, { placeLines: 2 });
    expect(two.place.height).toBeGreaterThan(one.place.height);
    expect(two.height).toBeGreaterThanOrEqual(one.height);
    expect(two.place.size).toBeLessThan(one.place.size);
  });

  it("says where, when and whose, from the post's own fields", () => {
    const words = exportLabelText(post, 1);
    expect(words.place).toBe("THE METROPOLITAN MUSEUM OF ART");
    expect(words.placeLines).toBe(2);
    expect(words.date).toBe("SEPTEMBER 15, 2026");
    expect(words.credit).toBe("chai · FOUNDING MEMBER NO. 00001");
  });

  it("leaves out what is not there and never invents a number", () => {
    const words = exportLabelText({ ...post, location: "  ", taken_at: null }, null);
    expect(words.place).toBeNull();
    expect(words.placeLines).toBe(0);
    expect(words.date).toBe("SEPTEMBER 16, 2026");
    expect(words.credit).toBe("chai");
    expect(JSON.stringify(words)).not.toMatch(/undefined|null ·|· $/);
    const none = exportLayout(1, "print", PRINT_WIDTH, { placeLines: 0 });
    expect(none.place.height).toBe(0);
  });

  it("keeps founding-member semantics and formats any length of number", () => {
    expect(memberCredit("chai", 27)).toBe("chai · FOUNDING MEMBER NO. 00027");
    expect(memberCredit("chai", 10_001)).toBe("chai · MEMBER NO. 10001");
    expect(memberCredit("a_very_long_username_indeed", 3)).toBe("a_very_long_username_indeed · FOUNDING MEMBER NO. 00003");
    expect(memberCredit("chai", null)).toBe("chai");
    expect(memberCredit("chai", 0)).toBe("chai");
  });
});

describe("the label's right-hand line", () => {
  it("is place and date, or the date alone", () => {
    expect(exportByline("NYC", "Jan 23, 2003")).toBe("NYC · Jan 23, 2003");
    expect(exportByline("  ", "Jan 23, 2003")).toBe("Jan 23, 2003");
    expect(exportByline(null, "Jan 23, 2003")).toBe("Jan 23, 2003");
  });
});
