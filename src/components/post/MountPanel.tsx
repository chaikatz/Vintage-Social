import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { panelWords, type PanelAct, type PanelKind } from "@/post/panels";
import { colors, spacing, type } from "@/theme";

/**
 * The mount with no photograph on it: the same dark box as the selected
 * photograph's, at least as tall, so nothing on the page moves when one
 * arrives. In it, a few words and at most one thing to tap — SHOW MY
 * PHOTOGRAPHS, SHARE MORE, TRY AGAIN, or, where there is no library,
 * CHOOSE A PHOTOGRAPH — or, refused, the way to Settings. While the roll
 * is read it is an empty box, with a small spinner only after 400 ms; and
 * before the tab has ever been in front, an empty box.
 */

const TYPE_CAP = 2.4;
const BAR_TYPE_CAP = 1.8;
/** The spinner waits this long, so a read that comes at once shows none. */
const SPINNER_AFTER_MS = 400;

export function MountPanel({
  kind,
  iosMajor,
  H,
  narrow,
  busy,
  held,
  onAct,
  onOpenSettings,
}: {
  kind: PanelKind;
  iosMajor: number;
  H: number;
  narrow: boolean;
  /** The bar's own work is under way (CONTINUE waiting on iOS, the picker opening). */
  busy: boolean;
  held: boolean;
  onAct: (act: PanelAct) => void;
  onOpenSettings: () => void;
}) {
  const words = panelWords(kind, iosMajor);
  if (!words) return <EmptyMount H={H} spinner={kind === "loading"} />;
  return (
    <View testID="post-panel" style={[styles.mount, { minHeight: H }]}>
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
            <ActivityIndicator size="small" color={colors.camera} />
          ) : (
            <>
              <Text style={styles.barWord} maxFontSizeMultiplier={BAR_TYPE_CAP}>
                {words.bar.label}
              </Text>
              <Feather name="arrow-right" size={18} color={colors.camera} style={styles.arrow} />
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

/** The mount and nothing on it; a spinner only once the read has taken a moment. */
function EmptyMount({ H, spinner }: { H: number; spinner: boolean }) {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!spinner) return;
    const timer = setTimeout(() => setLate(true), SPINNER_AFTER_MS);
    return () => clearTimeout(timer);
  }, [spinner]);
  return (
    <View testID="post-panel" style={[styles.mount, styles.empty, { minHeight: H }]}>
      {spinner && late ? <ActivityIndicator size="small" color={colors.onCamera} /> : null}
    </View>
  );
}

const caps = { textTransform: "uppercase" as const };

const styles = StyleSheet.create({
  mount: { backgroundColor: colors.camera, paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, justifyContent: "center" },
  empty: { alignItems: "center" },
  eyebrow: { fontFamily: type.mono, fontSize: 10, letterSpacing: 2.4, ...caps, color: colors.onCamera, opacity: 0.7 },
  headline: { fontFamily: type.serif, fontSize: 24, lineHeight: 29, color: colors.onCamera, marginTop: 10 },
  headlineNarrow: { fontSize: 20, lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 20, color: colors.onCamera, opacity: 0.78, marginTop: spacing.sm },
  bodyNarrow: { fontSize: 13, lineHeight: 18 },
  bar: {
    marginTop: 18,
    minHeight: 48,
    paddingVertical: spacing.sm,
    paddingHorizontal: 36,
    backgroundColor: colors.onCamera,
    alignItems: "center",
    justifyContent: "center",
  },
  barNarrow: { minHeight: 44 },
  barWord: { fontFamily: type.mono, fontSize: 11, letterSpacing: 2.2, ...caps, color: colors.camera, textAlign: "center" },
  arrow: { position: "absolute", right: 16 },
  path: { fontFamily: type.mono, fontSize: 9.5, letterSpacing: 1, color: colors.onCamera, opacity: 0.7, marginTop: spacing.md },
  quiet: { marginTop: 14, minHeight: 44, justifyContent: "center", alignSelf: "flex-start" },
  quietWord: { fontFamily: type.mono, fontSize: 10.5, letterSpacing: 2, ...caps, color: colors.onCamera, textDecorationLine: "underline" },
  pressed: { opacity: 0.75 },
});
