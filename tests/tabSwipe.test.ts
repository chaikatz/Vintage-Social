import { describe, expect, it } from "vitest";
import { holdTabSwipe, shouldHoldTabSwipe, tabSwipeHolds } from "@/utils/tabSwipe";

/**
 * When the tabs may be swiped. A pinch on the timeline is kept from the
 * pager natively; what is decided here is the one-finger case — a
 * magnified line is dragged, an unmagnified one swipes the tabs.
 */
describe("holding the tab pager", () => {
  it("holds while the line is pinched or left magnified, on the screen in view", () => {
    expect(shouldHoldTabSwipe({ focused: true, pinching: true, magnified: false })).toBe(true);
    expect(shouldHoldTabSwipe({ focused: true, pinching: false, magnified: true })).toBe(true);
  });

  it("lets go at actual size or shrunk, and on a screen that is not in view", () => {
    expect(shouldHoldTabSwipe({ focused: true, pinching: false, magnified: false })).toBe(false);
    expect(shouldHoldTabSwipe({ focused: false, pinching: true, magnified: true })).toBe(false);
  });

  it("counts holds, and releasing one twice releases it once", () => {
    const before = tabSwipeHolds();
    const a = holdTabSwipe();
    const b = holdTabSwipe();
    expect(tabSwipeHolds()).toBe(before + 2);
    a();
    a();
    expect(tabSwipeHolds()).toBe(before + 1);
    b();
    expect(tabSwipeHolds()).toBe(before);
  });
});
