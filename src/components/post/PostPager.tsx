import React, { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { Animated, Easing, PanResponder, Platform, StyleSheet, View, type ViewStyle } from "react-native";
import { pageOffset, pagePosition } from "@/post/pages";
import { holdsSideways, SLIDE_SLOP, slideOpens, slideProgress } from "@/post/slide";

/**
 * The Post tab's two pages, Recent and the Memory Room's door, side by
 * side in a row, moved by the app's own slide rule (`src/post/slide.ts`)
 * on the iPhone and in the browser alike. A drag on Recent becomes the
 * slide only once it has gone 12 points to the left and plainly sideways;
 * the page then follows the finger, and on release it goes on to the door
 * past half the width or on a clear flick that has already carried it a
 * fifth of the way, and otherwise back. A drag as plainly to the right is
 * held too, and moves nothing. One finger only: two are never a slide.
 *
 * It used to be react-native-pager-view on the iPhone, a
 * UIPageViewController, whose paging turned the page on any quick flick
 * however short (and took a drag nearer the diagonal than this rule
 * does), so a nudge could open the room. Nothing here leaves the release
 * to UIKit.
 *
 * The roll inside Recent scrolls up and down natively: a vertical list's
 * own pan gives way to a drag more sideways than up or down, and only
 * then does this responder see it, in the capture phase, so a cell that
 * took the press gives the drag up and selects nothing. Once the roll is
 * scrolling, its list holds the touch and will not give it up (React
 * Native's ScrollView, once it has scrolled), so a scroll that turns
 * sideways under the finger stays a scroll. While the slide
 * moves, its work is one value set per touch move, on the JavaScript
 * thread; at rest it does nothing at all.
 *
 * It says when it comes to rest (`onPageSelected`), whether it is being
 * dragged (`onScrollState`), and how far it has gone, in `pageOffset`,
 * for the header's two inks.
 */

export interface PostPagerHandle {
  setPage(page: number): void;
  setPageWithoutAnimation(page: number): void;
}

export type PagerScrollState = "idle" | "dragging" | "settling";

/** The page goes on, or back, over this. */
const SETTLE_MS = 260;

const web = Platform.OS === "web";

export const PostPager = forwardRef<
  PostPagerHandle,
  {
    children: React.ReactNode;
    scrollEnabled: boolean;
    onPageSelected: (page: number) => void;
    onScrollState: (state: PagerScrollState) => void;
  }
>(function PostPager({ children, scrollEnabled, onPageSelected, onScrollState }, ref) {
  const width = useRef(0);
  const page = useRef(0);
  const x = useRef(new Animated.Value(0)).current;
  const enabled = useRef(scrollEnabled);
  enabled.current = scrollEnabled;
  const told = useRef({ onPageSelected, onScrollState });
  told.current = { onPageSelected, onScrollState };

  useEffect(() => {
    if (web) keepDragsForTheSlide();
  }, []);

  // The header's inks follow the row wherever it is, dragged or settling.
  useEffect(() => {
    const id = x.addListener(({ value }) => {
      pagePosition.setValue(0);
      pageOffset.setValue(slideProgress(value, width.current));
    });
    return () => x.removeListener(id);
  }, [x]);

  const settle = useRef((target: number, animated: boolean) => {
    const to = -target * width.current;
    const done = () => {
      page.current = target;
      pagePosition.setValue(0);
      pageOffset.setValue(target);
      told.current.onScrollState("idle");
      told.current.onPageSelected(target);
    };
    x.stopAnimation();
    if (!animated) {
      x.setValue(to);
      done();
      return;
    }
    told.current.onScrollState("settling");
    Animated.timing(x, { toValue: to, duration: SETTLE_MS, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start(({ finished }) => {
      if (finished) done();
    });
  }).current;

  useImperativeHandle(
    ref,
    () => ({
      setPage: (target) => settle(target, true),
      setPageWithoutAnimation: (target) => settle(target, false),
    }),
    [settle],
  );

  const responder = useMemo(() => {
    // Sideways either way, with one finger: to the left it is the slide; to the right the page stays, and nothing under it is tapped.
    const wants = (dx: number, dy: number, touches: number) =>
      enabled.current && page.current === 0 && !(touches > 1) && holdsSideways({ dx, dy });
    return PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,
      // In the capture phase, so a cell that took the press gives the drag up to the slide.
      onMoveShouldSetPanResponderCapture: (_, g) => wants(g.dx, g.dy, g.numberActiveTouches),
      onMoveShouldSetPanResponder: (_, g) => wants(g.dx, g.dy, g.numberActiveTouches),
      onPanResponderGrant: () => {
        x.stopAnimation();
        told.current.onScrollState("dragging");
      },
      onPanResponderMove: (_, g) => {
        // From where the slide began, so the page does not jump by the slop; never to the right of Recent.
        const w = width.current;
        x.setValue(Math.max(-w, Math.min(0, g.dx + SLIDE_SLOP)));
      },
      onPanResponderRelease: (_, g) => {
        if (web) swallowClick();
        settle(slideOpens({ dx: g.dx, vx: g.vx, width: width.current }) ? 1 : 0, true);
      },
      onPanResponderTerminate: () => {
        if (web) swallowClick();
        settle(page.current, true);
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [settle, x]);

  const pages = React.Children.toArray(children);
  return (
    <View
      testID="post-pager"
      style={[styles.pager, web && WEB_TOUCH]}
      onLayout={(e) => {
        width.current = e.nativeEvent.layout.width;
        x.setValue(-page.current * width.current);
      }}
      {...responder.panHandlers}
    >
      <Animated.View style={[styles.row, { transform: [{ translateX: x }] }]}>
        {pages.map((child, i) => (
          // Only Recent is read by VoiceOver: the door's page is never stopped on.
          <View key={i} style={styles.page} aria-hidden={i !== 0 ? true : undefined}>
            {child}
          </View>
        ))}
      </Animated.View>
    </View>
  );
});

/**
 * In the browser, a mouse dragged across the pager would otherwise pick up
 * the photograph under it (the browser's own image drag, which the
 * responder system takes as a cancel) or select the words it passes over.
 * Neither is anything a finger does on a phone, so inside the pager
 * neither happens.
 */
function keepDragsForTheSlide(): void {
  if (typeof document === "undefined" || document.getElementById(DRAG_STYLE)) return;
  const style = document.createElement("style");
  style.id = DRAG_STYLE;
  style.textContent =
    '[data-testid="post-pager"] { -webkit-user-select: none; user-select: none; }' +
    ' [data-testid="post-pager"] img { -webkit-user-drag: none; user-drag: none; }';
  document.head.appendChild(style);
}

const DRAG_STYLE = "post-pager-drag";

/**
 * In the browser, a mouse let go over the photograph it was pressed on
 * still clicks it, and a click is a tap to the browser's Pressable: the
 * slide would open the editor as well as the room. The click that ends a
 * slide is taken before the page sees it. A slide by a finger, or one
 * whose click never comes, leaves nothing waiting for the next tap: the
 * next press lets it go, and so does a moment.
 */
function swallowClick(): void {
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  const take = (e: Event) => {
    e.stopPropagation();
    e.preventDefault();
    done();
  };
  const done = () => {
    window.removeEventListener("click", take, true);
    window.removeEventListener("pointerdown", done, true);
    clearTimeout(timer);
  };
  window.addEventListener("click", take, true);
  window.addEventListener("pointerdown", done, true);
  const timer = setTimeout(done, CLICK_AFTER_MS);
}

/** The click that ends a slide comes with the mouse's release; one later than this is a tap of its own. */
const CLICK_AFTER_MS = 300;

/** The browser keeps the vertical pan for the roll and hands the sideways one to the slide. */
const WEB_TOUCH = { touchAction: "pan-y" } as unknown as ViewStyle;

const styles = StyleSheet.create({
  pager: { flex: 1, overflow: "hidden" },
  row: { flex: 1, flexDirection: "row", width: "200%" },
  page: { width: "50%", height: "100%" },
});
