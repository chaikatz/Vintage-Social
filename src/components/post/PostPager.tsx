import React, { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import PagerView from "react-native-pager-view";
import { pageOffset, pagePosition } from "@/post/pages";

/**
 * The Post tab's two pages, Recent and the Memory Room's door, as the
 * iPhone pages: react-native-pager-view, a UIPageViewController whose
 * scroll view pages by UIKit's own rule (the nearer page on release, or
 * the next on a flick) and locks to one direction, so the roll inside
 * Recent scrolls up and down without ever turning the page. The tab pager
 * around it is held still while the Post tab is in front
 * (`holdTabSwipe`), so the two never take the same drag.
 *
 * Its scroll drives `pagePosition` and `pageOffset` on the native thread,
 * for the header's two inks; it says only when it comes to rest
 * (`onPageSelected`) and whether a finger is on it (`onScrollState`).
 * The browser's pager is `PostPager.web.tsx`, the same in every way it is
 * used.
 */

export interface PostPagerHandle {
  setPage(page: number): void;
  setPageWithoutAnimation(page: number): void;
}

export type PagerScrollState = "idle" | "dragging" | "settling";

const AnimatedPager = Animated.createAnimatedComponent(PagerView);

export const PostPager = forwardRef<
  PostPagerHandle,
  {
    children: React.ReactNode;
    scrollEnabled: boolean;
    onPageSelected: (page: number) => void;
    onScrollState: (state: PagerScrollState) => void;
  }
>(function PostPager({ children, scrollEnabled, onPageSelected, onScrollState }, ref) {
  const pager = useRef<PagerView>(null);
  useImperativeHandle(
    ref,
    () => ({
      setPage: (page) => pager.current?.setPage(page),
      setPageWithoutAnimation: (page) => {
        pager.current?.setPageWithoutAnimation(page);
        pagePosition.setValue(page);
        pageOffset.setValue(0);
      },
    }),
    [],
  );
  const onPageScroll = useMemo(
    () => Animated.event([{ nativeEvent: { position: pagePosition, offset: pageOffset } }], { useNativeDriver: true }),
    [],
  );
  return (
    <AnimatedPager
      ref={pager}
      testID="post-pager"
      style={styles.pager}
      initialPage={0}
      scrollEnabled={scrollEnabled}
      overdrag={false}
      keyboardDismissMode="none"
      onPageScroll={onPageScroll}
      onPageSelected={(e: { nativeEvent: { position: number } }) => onPageSelected(e.nativeEvent.position)}
      onPageScrollStateChanged={(e: { nativeEvent: { pageScrollState: PagerScrollState } }) => onScrollState(e.nativeEvent.pageScrollState)}
    >
      {children}
    </AnimatedPager>
  );
});

const styles = StyleSheet.create({
  pager: { flex: 1 },
});
