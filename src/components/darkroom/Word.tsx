import React from "react";
import { Animated, Pressable, StyleSheet, View, type Insets, type StyleProp, type ViewStyle } from "react-native";
import { ruleWidth } from "@/components/gate/rule";
import { RoomText, Rule } from "./Type";

/**
 * A word you can press, the way VINTAGE sets every way in: tracked
 * capitals. Each page has exactly one primary word, and only it carries
 * the short rule signed beneath (`ruleWidth`, 7 below the letters); the
 * rest are smaller, softer and unruled. In the room the primary word is
 * almost always DEVELOP.
 *
 * `dim` is the 0.4 of a word that cannot be used just now, which always
 * comes with a reason for VoiceOver; `disabled` alone is a word that is
 * briefly inert (DEVELOP while a page is being dragged, or while it
 * develops) and keeps its full ink.
 */
export function Word({
  label,
  onPress,
  primary = false,
  ruled = primary,
  disabled = false,
  dim = false,
  busy,
  selected,
  accessibilityLabel,
  accessibilityHint,
  maxFontSizeMultiplier = 2.4,
  ruleScale,
  onLabelWidth,
  minHeight = 44,
  paddingHorizontal = 6,
  hitSlop,
  testID,
  style,
}: {
  label: string;
  onPress: () => void;
  /** The page's one ruled word. */
  primary?: boolean;
  /** The rule beneath; a primary word has it unless it is briefly put by (DEVELOPING… while it downloads). */
  ruled?: boolean;
  disabled?: boolean;
  dim?: boolean;
  busy?: boolean;
  selected?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  maxFontSizeMultiplier?: number;
  /** DEVELOP's rule draws out under the word as it develops. */
  ruleScale?: Animated.Value | Animated.AnimatedInterpolation<number>;
  /** The letters' own width, for a rule that draws out to it. */
  onLabelWidth?: (width: number) => void;
  minHeight?: number;
  paddingHorizontal?: number;
  hitSlop?: Insets | number;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const tracking = primary ? 3 : 2.2;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || dim}
      hitSlop={hitSlop}
      testID={testID}
      style={({ pressed }) => [
        styles.base,
        { minHeight, paddingHorizontal },
        pressed && styles.pressed,
        dim && styles.dim,
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || dim, selected, busy }}
    >
      <RoomText
        kind={primary ? "wordPrimary" : "word"}
        maxFontSizeMultiplier={maxFontSizeMultiplier}
        style={styles.label}
        onLayout={onLabelWidth ? (e) => onLabelWidth(Math.max(0, e.nativeEvent.layout.width - tracking)) : undefined}
      >
        {label}
      </RoomText>
      {primary ? (
        // The slot stays when the rule is put by, so the word never moves.
        <View style={[styles.ruleSlot, !ruled && styles.hidden]}>
          <Rule width={ruleWidth(label)} scaleX={ruleScale} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: { alignItems: "center", justifyContent: "center" },
  label: { textAlign: "center" },
  ruleSlot: { marginTop: 7, alignItems: "center" },
  pressed: { opacity: 0.75 },
  dim: { opacity: 0.4 },
  hidden: { opacity: 0 },
});
