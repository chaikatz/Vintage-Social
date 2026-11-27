import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { panelWords, type PanelAct, type PanelKind } from "@/post/panels";
import type { Box } from "@/post/roll";
import { colors, spacing, type } from "@/theme";

/**
 * The frame with no photograph in it: the same 4:5 box the selected
 * photograph stands in, at least as tall, so nothing on the page moves
 * when one arrives. In the page's paper style, as the camera tile is: the
 * paper, ruled in the strong line. In it, a few words and at most one bar
 * to tap — CONTINUE (which is when iOS asks), SHARE MORE, TRY AGAIN, or,
 * refused or where there is no library, CHOOSE A PHOTOGRAPH — in the
 * shutter's ink, the page's one primary button; and, refused, the way to
 * Settings under it. While the roll is read the frame is a well, the
 * roll's own sunken paper, with a small spinner only after 400 ms; and
 * before the tab has ever been in front, a well.
 */

const TYPE_CAP = 2.4;
const BAR_TYPE_CAP = 1.8;
/** The spinner waits this long, so a read that comes at once shows none. */
const SPINNER_AFTER_MS = 400;

export function MountPanel({
  kind,
  iosMajor,
  frame,
  narrow,
  busy,
  held,
  onAct,
  onOpenSettings,
}: {
  kind: PanelKind;
  iosMajor: number;
  frame: Box;
  narrow: boolean;
  /** The bar's own work is under way (CONTINUE waiting on iOS, the picker opening). */
  busy: boolean;
  held: boolean;
  onAct: (act: PanelAct) => void;
  onOpenSettings: () => void;
}) {
  const words = panelWords(kind, iosMajor);
  const box = { marginLeft: frame.left, width: frame.width, minHeight: frame.height };
  if (!words) return <Well box={box} spinner={kind === "loading"} />;
  return (
    <View testID="post-panel" style={[styles.panel, narrow && styles.panelNarrow, box]}>
      <Text style={styles.eyebrow} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        {words.eyebrow}
      </Text>
      <Text style={[styles.headline, narrow && styles.headlineNarrow]} accessibilityRole="header" lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
        {words.headline}
      </Text>
      <Text style={[styles.body, narrow && styles.bodyNarrow]} lineBreakStrategyIOS="push-out" maxFontSizeMultiplier={TYPE_CAP}>
        {words.body}
      </Text>
      {words.bar ? (
        <Pressable
          testID="post-panel-bar"
          onPress={() => onAct(words.bar!.act)}
          disabled={held || busy}
          style={({ pressed }) => [styles.bar, narrow && styles.barNarrow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={words.bar.label}
          accessibilityHint={words.bar.hint}
          accessibilityState={{ busy, disabled: held || busy }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.onShutter} />
          ) : (
            <>
              <Text style={styles.barWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
                {words.bar.label}
              </Text>
              <Feather name="arrow-right" size={16} color={colors.onShutter} style={styles.arrow} />
            </>
          )}
        </Pressable>
      ) : null}
      {words.path ? (
        <Text style={styles.path} maxFontSizeMultiplier={BAR_TYPE_CAP}>
          {words.path}
        </Text>
      ) : null}
      {words.quiet ? (
        <Pressable
          testID="post-panel-quiet"
          onPress={onOpenSettings}
          disabled={held}
          hitSlop={6}
          style={({ pressed }) => [styles.quiet, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel={words.quiet.label}
          accessibilityHint={words.quiet.hint}
        >
          <Text style={styles.quietWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
            {words.quiet.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The frame and nothing in it: the roll's sunken paper; a spinner only once the read has taken a moment. */
function Well({ box, spinner }: { box: { marginLeft: number; width: number; minHeight: number }; spinner: boolean }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!spinner) return;
    const timer = setTimeout(() => setLate(true), SPINNER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [spinner]);
  return (
    <View testID="post-panel" style={[styles.well, box]}>
      {spinner && late ? <ActivityIndicator size="small" color={colors.inkSoft} /> : null}
    </View>
  );
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  panel: {
    backgroundColor: colors.paper,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.lg,
    justifyContent: "center",
  },
  panelNarrow: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  well: { backgroundColor: colors.paperSunken, alignItems: "center", justifyContent: "center" },
  eyebrow: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.inkSoft },
  headline: { fontFamily: type.serif, fontSize: 24, lineHeight: 29, color: colors.ink, marginTop: 10 },
  headlineNarrow: { fontSize: 20, lineHeight: 25, marginTop: 8 },
  body: { fontSize: 14, lineHeight: 20, color: colors.inkSoft, marginTop: spacing.sm },
  bodyNarrow: { fontSize: 13, lineHeight: 18, marginTop: 6 },
  bar: {
    marginTop: 18,
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: 36,
    backgroundColor: colors.shutter,
    alignItems: "center",
    justifyContent: "center",
  },
  barNarrow: { minHeight: 44, marginTop: 14, paddingHorizontal: 32 },
  barWord: { fontFamily: type.mono, fontSize: 11, letterSpacing: 2.2, ...caps, color: colors.onShutter, textAlign: "center" },
  arrow: { position: "absolute", right: 14 },
  path: { fontFamily: type.mono, fontSize: 9.5, lineHeight: 13, letterSpacing: 1, color: colors.inkSoft, marginTop: spacing.md },
  quiet: { marginTop: 6, minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  quietWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2, ...caps, color: colors.ink, textDecorationLine: "underline" },
  pressed: { opacity: 0.75 },
});
