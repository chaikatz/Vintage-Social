import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { gestureHold, holdTabSwipe, shouldHoldTabSwipe, tabSwipeHolds } from "@/utils/tabSwipe";

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

/**
 * A pinch on a feed photograph holds the pager while the fingers are
 * down. A card can leave the screen with the fingers still down: the
 * list read again, the post deleted or its author blocked, the screen
 * closed. Its hold must go with it, or the tabs never swipe again.
 */
describe("a pinch's hold on the tab pager", () => {
  it("is one hold however often it is taken, and let go once", () => {
    const before = tabSwipeHolds();
    const hold = gestureHold();
    hold.take();
    hold.take();
    expect(tabSwipeHolds()).toBe(before + 1);
    hold.release();
    hold.release();
    expect(tabSwipeHolds()).toBe(before);
    // Taken again for the next pinch.
    hold.take();
    expect(tabSwipeHolds()).toBe(before + 1);
    hold.release();
    expect(tabSwipeHolds()).toBe(before);
  });

  it("let go by the card as it leaves, even mid-pinch, and harmless if the fingers lift after", () => {
    const before = tabSwipeHolds();
    const hold = gestureHold();
    hold.take(); // the pinch begins
    hold.release(); // the card unmounts
    expect(tabSwipeHolds()).toBe(before);
    hold.release(); // the responder's release, if it still arrives
    expect(tabSwipeHolds()).toBe(before);
  });

  it("is released by PostMedia when it unmounts, and by the pinch's end", () => {
    const media = readFileSync(path.resolve(import.meta.dirname, "..", "src/components/PostMedia.tsx"), "utf8");
    expect(media).toMatch(/const \[swipeHold\] = React\.useState\(gestureHold\);/);
    // The cleanup of an effect that runs once: the unmount.
    expect(media).toMatch(/React\.useEffect\(\(\) => \(\) => swipeHold\.release\(\), \[swipeHold\]\);/);
    expect(media.match(/swipeHold\.take\(\);/g)).toHaveLength(1);
    expect(media).toMatch(/onPanResponderRelease: \(\) => \{\s*swipeHold\.release\(\);/);
    expect(media).toMatch(/onPanResponderTerminate: \(\) => \{\s*swipeHold\.release\(\);/);
    // Nothing takes the pager outside the one hold.
    expect(media).not.toMatch(/holdTabSwipe\(/);
    // Before the clip's early return, so the hooks run on every draw.
    expect(media.indexOf("React.useState(gestureHold)")).toBeLessThan(media.search(/\n  if \(isVideo\) \{\s*return \(/));
  });
});
