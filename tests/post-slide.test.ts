import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  claimsSlide,
  createRoomDoor,
  FLICK_SHARE,
  FLICK_SPEED,
  holdWhileInFront,
  ROOM_COVERED_MS,
  SLIDE_LOCK,
  SLIDE_SHARE,
  SLIDE_SLOP,
  slideOpens,
  slideProgress,
  type RoomDoorIO,
} from "@/post/slide";
import { tabSwipeHolds } from "@/utils/tabSwipe";

// The shared page state builds an Animated value; the test needs only the store and the asks.
vi.mock("react-native", () => {
  class Value {
    v: number;
    constructor(v: number) {
      this.v = v;
    }
    setValue(v: number) {
      this.v = v;
    }
  }
  return { Animated: { Value, add: (a: Value, b: Value) => ({ a, b }) } };
});

/**
 * The slide from Recent to the Memory Room, without a phone: when a drag
 * is the slide at all, when letting it go opens the room, the room pushed
 * once and only while the tab is in front, Recent put back once the room
 * covers the tab, the tabs' pager held still while the tab is in front,
 * and the header's taps handed to the tab.
 */

const root = path.resolve(import.meta.dirname, "..");
const code = (f: string) =>
  readFileSync(path.join(root, f), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("a drag on Recent", () => {
  it("is the slide only once it has gone 12 points to the left, and plainly sideways", () => {
    expect(SLIDE_SLOP).toBe(12);
    expect(SLIDE_LOCK).toBe(1.5);
    expect(claimsSlide({ dx: -12, dy: 0 })).toBe(true);
    expect(claimsSlide({ dx: -40, dy: 20 })).toBe(true);
    // A nudge, a tap's wobble.
    expect(claimsSlide({ dx: -11, dy: 0 })).toBe(false);
    expect(claimsSlide({ dx: -3, dy: 2 })).toBe(false);
    // A scroll of the roll, and a diagonal drift.
    expect(claimsSlide({ dx: -4, dy: -120 })).toBe(false);
    expect(claimsSlide({ dx: -40, dy: 40 })).toBe(false);
    expect(claimsSlide({ dx: -30, dy: 21 })).toBe(false);
    // To the right: nothing (the tabs are a tap away).
    expect(claimsSlide({ dx: 80, dy: 0 })).toBe(false);
    expect(claimsSlide({ dx: Number.NaN, dy: 0 })).toBe(false);
  });

  it("carries the page with it, from Recent (0) to the door (1), never past either", () => {
    expect(slideProgress(0, 390)).toBe(0);
    expect(slideProgress(-195, 390)).toBe(0.5);
    expect(slideProgress(-500, 390)).toBe(1);
    expect(slideProgress(40, 390)).toBe(0);
    expect(slideProgress(-100, 0)).toBe(0);
  });
});

describe("letting the slide go", () => {
  const W = 390;
  it("opens the room past half the width, however slowly", () => {
    expect(SLIDE_SHARE).toBe(0.5);
    expect(slideOpens({ dx: -195, vx: 0, width: W })).toBe(true);
    expect(slideOpens({ dx: -300, vx: 0.2, width: W })).toBe(true);
    expect(slideOpens({ dx: -194, vx: 0, width: W })).toBe(false);
  });

  it("opens it on a clear flick only once the flick has carried the page a fifth of the way", () => {
    expect(FLICK_SPEED).toBe(0.6);
    expect(FLICK_SHARE).toBe(0.2);
    expect(slideOpens({ dx: -0.2 * W, vx: -0.6, width: W })).toBe(true);
    expect(slideOpens({ dx: -120, vx: -1.5, width: W })).toBe(true);
    // A quick nudge: fast, but short.
    expect(slideOpens({ dx: -60, vx: -2, width: W })).toBe(false);
    // Far enough for a flick, but not quick: a slow drag let go short of half.
    expect(slideOpens({ dx: -150, vx: -0.3, width: W })).toBe(false);
    // Flung back to the right at the end.
    expect(slideOpens({ dx: -150, vx: 0.9, width: W })).toBe(false);
  });

  it("is the browser pager's rule, and the iPhone's pager is UIKit's own", () => {
    const web = code("src/components/post/PostPager.web.tsx");
    expect(web).toMatch(/claimsSlide\(\{ dx, dy \}\)/);
    expect(web).toMatch(/slideOpens\(\{ dx: g\.dx, vx: g\.vx, width: width\.current \}\) \? 1 : 0/);
    // Only from Recent, only while the page may move.
    expect(web).toMatch(/enabled\.current && page\.current === 0 && claimsSlide/);
    // In the capture phase, so a cell that took the press gives the drag up.
    expect(web).toMatch(/onMoveShouldSetPanResponderCapture: \(_, g\) => wants\(g\.dx, g\.dy\)/);
    expect(web).toMatch(/onPanResponderTerminationRequest: \(\) => false/);
    const native = code("src/components/post/PostPager.tsx");
    expect(native).toMatch(/import PagerView from "react-native-pager-view";/);
    expect(native).toMatch(/overdrag=\{false\}/);
    expect(native).toMatch(/useNativeDriver: true/);
    expect(native).not.toMatch(/PanResponder/);
  });
});

/** A door with its pushes, resets and timers counted. */
function door(front = true) {
  const state = { front, pushes: 0, resets: 0, timers: [] as { run: () => void; ms: number; live: boolean }[] };
  const io: RoomDoorIO = {
    isFront: () => state.front,
    push: () => {
      state.pushes += 1;
    },
    reset: () => {
      state.resets += 1;
    },
    later: (run, ms) => {
      const t = { run, ms, live: true };
      state.timers.push(t);
      return () => {
        t.live = false;
      };
    },
  };
  const d = createRoomDoor(io);
  const fire = () => state.timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.run()));
  return { d, state, fire };
}

describe("the room's door", () => {
  it("pushes the room once when the pager comes to rest on it, with the tab in front", () => {
    const { d, state } = door();
    d.settled();
    expect(state.pushes).toBe(1);
    expect(d.phase()).toBe("opening");
    // A flick that settles twice, a tap on MEMORY ROOM as the page comes in: nothing more.
    d.settled();
    d.settled();
    expect(state.pushes).toBe(1);
  });

  it("never pushes the room while the tab is not in front: the pager goes back to Recent", () => {
    const { d, state } = door(false);
    d.settled();
    expect(state.pushes).toBe(0);
    expect(state.resets).toBe(1);
    expect(d.phase()).toBe("closed");
  });

  it("puts Recent back without a push once the room covers the tab, so the way back lands on it", () => {
    const { d, state } = door();
    d.settled();
    state.front = false; // the room is in front
    d.covered();
    expect(state.resets).toBe(1);
    expect(d.phase()).toBe("covered");
    // Covered again (another screen over the tabs): nothing.
    d.covered();
    expect(state.resets).toBe(1);
    // Back from the room: the door may open again, once.
    state.front = true;
    d.focused();
    expect(d.phase()).toBe("closed");
    d.settled();
    expect(state.pushes).toBe(2);
  });

  it("puts Recent back after a while even when the stack never says the room covers the tab", () => {
    const { d, state, fire } = door();
    d.settled();
    expect(state.timers[0].ms).toBe(ROOM_COVERED_MS);
    expect(ROOM_COVERED_MS).toBeGreaterThan(360);
    state.front = false;
    fire();
    expect(state.resets).toBe(1);
    expect(d.phase()).toBe("covered");
  });

  it("opens again after a push that never took the tab away", () => {
    const { d, state, fire } = door();
    d.settled();
    fire(); // still in front: the room never came
    expect(state.resets).toBe(1);
    expect(d.phase()).toBe("closed");
    d.settled();
    expect(state.pushes).toBe(2);
  });

  it("stops waiting, and puts Recent back, when the tab is in front again before the room covered it", () => {
    const { d, state } = door();
    d.settled();
    d.focused();
    expect(state.resets).toBe(1);
    expect(state.timers[0].live).toBe(false);
    expect(d.phase()).toBe("closed");
  });

  it("is what the tab uses: the push, the reset, the stack's word that the tabs are covered, and the tab in front again", () => {
    const tab = code("app/(tabs)/create.tsx");
    expect(tab).toMatch(/isFront: \(\) => front\.current && AppState\.currentState === "active"/);
    expect(tab).toMatch(/push: \(\) => routerRef\.current\.push\("\/darkroom"\)/);
    expect(tab).toMatch(/reset: \(\) => pager\.current\?\.setPageWithoutAnimation\(0\)/);
    expect(tab).toMatch(/if \(page === 1\) door\.settled\(\);/);
    expect(tab).toMatch(/listen\("transitionEnd", \(e\) => \{\s*if \(e\.data\?\.closing\) door\.covered\(\);/);
    expect(tab).toMatch(/front\.current = true;\s*const release = holdWhileInFront\(room\);\s*door\.focused\(\);\s*toRecent\(\);/);
    // Back from the background with the pager left on the door: Recent.
    expect(tab).toMatch(/state === "active" && door\.phase\(\) === "closed"\) toRecent\(\);/);
  });
});

describe("the tabs' pager while the Post tab is in front", () => {
  afterEach(() => {
    expect(tabSwipeHolds()).toBe(0);
  });

  it("is held still, and let go once as the tab leaves", () => {
    const release = holdWhileInFront(true);
    expect(tabSwipeHolds()).toBe(1);
    release();
    release();
    expect(tabSwipeHolds()).toBe(0);
  });

  it("swipes as it always has where there is no room to slide to", () => {
    const release = holdWhileInFront(false);
    expect(tabSwipeHolds()).toBe(0);
    release();
    expect(tabSwipeHolds()).toBe(0);
  });

  it("is held from the tab's focus and let go in its cleanup, and the pager follows the hold", () => {
    const tab = code("app/(tabs)/create.tsx");
    const focus = tab.slice(tab.indexOf("useFocusEffect("), tab.indexOf("}, [door, room, toRecent]),"));
    expect(focus).toMatch(/const release = holdWhileInFront\(room\);/);
    expect(focus).toMatch(/return \(\) => \{\s*front\.current = false;\s*printStop\.current\?\.abort\(\);\s*release\(\);\s*\};/);
    const layout = code("app/(tabs)/_layout.tsx");
    expect(layout).toMatch(/const swipeEnabled = useTabSwipeEnabled\(\);/);
    expect(layout).toMatch(/swipeEnabled,/);
  });
});

describe("the header's taps", () => {
  it("reach the tab listening, and nothing waits when no tab is", async () => {
    const pages = await import("@/post/pages");
    const heard: number[] = [];
    const stop = pages.onPageAsked((p) => heard.push(p));
    pages.askPage(1);
    pages.askPage(0);
    stop();
    pages.askPage(1);
    expect(heard).toEqual([1, 0]);
  });

  it("say which page the pager rests on, for VoiceOver", async () => {
    const pages = await import("@/post/pages");
    expect(pages.postPage()).toBe(0);
    pages.setPostPage(1);
    expect(pages.postPage()).toBe(1);
    pages.setPostPage(7);
    expect(pages.postPage()).toBe(0);
  });

  it("slide only from rest, in front, with nothing opening and the room not on its way; a cut under Reduce Motion", () => {
    const tab = code("app/(tabs)/create.tsx");
    const asked = tab.slice(tab.indexOf("onPageAsked((page) =>"), tab.indexOf("const post = useCallback"));
    expect(asked).toMatch(/if \(!front\.current \|\| opening\.current \|\| scrollState\.current !== "idle" \|\| door\.phase\(\) !== "closed"\) return;/);
    expect(asked).toMatch(/if \(reduceMotionRef\.current\) pager\.current\?\.setPageWithoutAnimation\(page\);\s*else pager\.current\?\.setPage\(page\);/);
  });
});
