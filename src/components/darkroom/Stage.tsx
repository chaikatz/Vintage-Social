import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import {
  AccessibilityInfo,
  Animated,
  FlatList,
  Platform,
  StyleSheet,
  View,
  findNodeHandle,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import { keepScrollToOneFinger } from "@/utils/pagerTouches";
import type { Print } from "@/darkroom/types";
import { actionNamed, spokenActions, STAGE_HINT, STAGE_LABEL, type StageAction } from "./words";

/** One page of the pager: a print, or the page after the last of them. */
type Item = { kind: "print"; print: Print } | { kind: "tail" };

/** The browser has no momentum events: a scroll that has been still this long has settled. */
const WEB_SETTLE_MS = 140;

/** VoiceOver's focus onto a view. The browser has no native tags to find, and no VoiceOver to tell. */
function focusOn(view: unknown): void {
  if (Platform.OS === "web" || view == null) return;
  try {
    const tag = findNodeHandle(view as never);
    if (tag != null) AccessibilityInfo.setAccessibilityFocus(tag);
  } catch {
    // Not mounted any more: there is nothing to focus.
  }
}

export interface StageHandle {
  /** To a page at once, never scrolling visibly across the ones between. */
  goTo(index: number): void;
  /** VoiceOver's focus onto the stage, after a chapter change. */
  focus(): void;
}

/**
 * The page turner: a horizontal list that fills the stage, one page per
 * screen width, every swipe exactly one page. The prints are followed by
 * one more page — the end page, or the title card while the next batch
 * is dealt — so a chapter ends where it ends, and swiping right from it
 * returns to the prints. Sequences only ever grow at the end, so nothing
 * already passed moves; when a print that left the chapter is taken out
 * behind the member, the list is put back on the same page (`rebase`).
 *
 * The scroll position drives `scrollX` on the native driver, which is
 * what DEVELOP fades by. The settled page is read when the scroll comes to
 * rest. A pinch never turns the page: the list's own pan is kept to one
 * finger (`keepScrollToOneFinger`), the same fix the tab pager has.
 *
 * VoiceOver sees one element over the whole stage (§11.1): adjustable,
 * labelled "Photograph", its value the date and the line. Swiping up or
 * down turns the page; the pages themselves are hidden from it. On the
 * end page the element steps aside and the end page's title takes the
 * focus, so its words can be reached. Over a trailing page still waiting
 * on the next batch it stays, and the focus with it.
 */
export const Stage = React.forwardRef<StageHandle, {
  prints: readonly Print[];
  /** A new chapter: the list is mounted afresh at `index`. */
  generation: number;
  index: number;
  rebase: number;
  width: number;
  height: number;
  scrollX: Animated.Value;
  scrollEnabled: boolean;
  renderPrint: (print: Print, index: number) => React.ReactElement;
  renderTail: () => React.ReactElement;
  onSettle: (index: number) => void;
  onDragging: (dragging: boolean) => void;
  accessibility: {
    /** False on the end page, where its own words are read. */
    single: boolean;
    value: string;
    actions: StageAction[];
    onAction: (name: StageAction["name"]) => void;
    onIncrement: () => void;
    onDecrement: () => void;
  };
  /** The end page's title, for VoiceOver's focus when the end page arrives. */
  tailTitle: React.RefObject<unknown>;
}>(function Stage(props, ref) {
  const { prints, generation, index, rebase, width, height, scrollX, onSettle, onDragging } = props;
  const list = useRef<FlatList<Item>>(null);
  const wrapper = useRef<View>(null);
  const items = useMemo<Item[]>(() => [...prints.map((print) => ({ kind: "print" as const, print })), { kind: "tail" as const }], [prints]);
  const toldFor = useRef<number | null>(null);
  const settledAt = useRef(index);
  settledAt.current = index;

  const page = useCallback((x: number) => Math.max(0, Math.min(items.length - 1, Math.round(x / Math.max(1, width)))), [items.length, width]);

  React.useImperativeHandle(ref, () => ({
    goTo(to: number) {
      const i = Math.max(0, Math.min(items.length - 1, to));
      list.current?.scrollToIndex({ index: i, animated: false });
      onSettle(i);
    },
    focus() {
      focusOn(wrapper.current);
    },
  }), [items.length, width, onSettle]);

  // Prints behind the member were taken out: back onto the same page, at once.
  useLayoutEffect(() => {
    if (rebase === 0) return;
    list.current?.scrollToIndex({ index: Math.min(settledAt.current, items.length - 1), animated: false });
    scrollX.setValue(settledAt.current * width);
    // Only when prints were taken out.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rebase]);

  // A new chapter starts where it starts.
  useLayoutEffect(() => {
    scrollX.setValue(index * width);
    // Only when the list is new.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation]);

  // The end page arrives: VoiceOver's focus goes to its title. A trailing
  // page still waiting on the next batch is not an end page: the stage
  // stays the one element over it, so the focus is not lost.
  const atTail = index >= prints.length;
  const single = props.accessibility.single;
  const atEnd = atTail && !single;
  useEffect(() => {
    if (!atEnd) return;
    const t = setTimeout(() => focusOn(props.tailTitle.current), 120);
    return () => clearTimeout(t);
  }, [atEnd, props.tailTitle]);

  // Back on a print from the trailing page — the batch the member outran
  // has landed, or they stepped back from the end — the focus comes back
  // to the stage, and VoiceOver reads the print.
  const wasAtTail = useRef(atTail);
  useEffect(() => {
    const was = wasAtTail.current;
    wasAtTail.current = atTail;
    if (!was || atTail || !single) return;
    const t = setTimeout(() => focusOn(wrapper.current), 120);
    return () => clearTimeout(t);
  }, [atTail, single]);

  const webTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (webTimer.current) clearTimeout(webTimer.current);
  }, []);
  const onScroll = useMemo(
    () =>
      Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
        useNativeDriver: true,
        // The browser demo has no momentum events; a scroll that has gone
        // still has settled. On the phone nothing runs in JS per frame.
        listener:
          Platform.OS === "web"
            ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
                const x = e.nativeEvent.contentOffset.x;
                if (webTimer.current) clearTimeout(webTimer.current);
                webTimer.current = setTimeout(() => onSettle(page(x)), WEB_SETTLE_MS);
              }
            : undefined,
      }),
    [scrollX, onSettle, page],
  );

  const onEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // Let go exactly on a page, there is no momentum to wait for.
    const x = e.nativeEvent.contentOffset.x;
    if (Math.abs(x - page(x) * width) < 0.5) {
      onSettle(page(x));
      onDragging(false);
    }
  };

  const a11y = props.accessibility;
  return (
    <View
      ref={wrapper}
      style={styles.stage}
      accessible={a11y.single}
      accessibilityRole={a11y.single ? "adjustable" : undefined}
      accessibilityLabel={a11y.single ? STAGE_LABEL : undefined}
      accessibilityValue={a11y.single ? { text: a11y.value } : undefined}
      accessibilityHint={a11y.single ? STAGE_HINT : undefined}
      // Listed by their words, which is what VoiceOver says; increment and
      // decrement reach the adjustable stage without being listed, and
      // listed they would be read out as "increment" and "decrement".
      accessibilityActions={a11y.single ? spokenActions(a11y.actions) : undefined}
      onAccessibilityAction={(e: AccessibilityActionEvent) => {
        const said = e.nativeEvent.actionName;
        if (said === "increment") return a11y.onIncrement();
        if (said === "decrement") return a11y.onDecrement();
        const name = actionNamed(a11y.actions, said);
        if (name) a11y.onAction(name);
      }}
      testID="darkroom-stage"
      nativeID="darkroom-stage"
    >
      <Animated.FlatList
        key={generation}
        ref={list}
        data={items}
        horizontal
        pagingEnabled
        disableIntervalMomentum
        decelerationRate="fast"
        bounces={false}
        directionalLockEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={props.scrollEnabled}
        keyExtractor={(item) => (item.kind === "print" ? item.print.id : "tail")}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialScrollIndex={Math.min(index, items.length - 1)}
        initialNumToRender={1}
        maxToRenderPerBatch={1}
        windowSize={3}
        removeClippedSubviews
        onScroll={onScroll}
        scrollEventThrottle={16}
        onScrollBeginDrag={() => onDragging(true)}
        onScrollEndDrag={onEndDrag}
        onMomentumScrollEnd={(e) => {
          onSettle(page(e.nativeEvent.contentOffset.x));
          onDragging(false);
        }}
        onScrollToIndexFailed={() => undefined}
        onLayout={() => {
          // Each new list is a new native scroll view, told once.
          if (toldFor.current === generation) return;
          toldFor.current = generation;
          void keepScrollToOneFinger(list.current);
        }}
        testID="darkroom-pager"
        renderItem={({ item, index: i }) => (
          <View
            style={{ width, height }}
            // Prints are read through the stage's own value; only the end page speaks for itself.
            accessibilityElementsHidden={item.kind === "print" || a11y.single}
            importantForAccessibility={item.kind === "print" || a11y.single ? "no-hide-descendants" : "auto"}
          >
            {item.kind === "print" ? props.renderPrint(item.print, i) : props.renderTail()}
          </View>
        )}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  stage: { flex: 1 },
});
