import React, { forwardRef } from "react";
import { Animated, Text, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from "react-native";
import { useLook } from "./look";
import { roles, room, RULE_OPACITY, toneColor, type Role, type Tone } from "./room";

/**
 * The room's two marks: a line of type in one of its roles, and the short
 * rule signed beneath a word. Both answer Increase Contrast and Bold Text
 * from the room's `Look`, so no caller has to.
 */

interface RoomTextProps extends Omit<TextProps, "style"> {
  /** The type role (`roles` in room.ts). */
  kind: Role;
  /** Another ink than the role's own. */
  tone?: Tone;
  style?: StyleProp<TextStyle>;
}

const BOLD: TextStyle = { fontWeight: "700" };

export const RoomText = forwardRef<Text, RoomTextProps>(function RoomText(props, ref) {
  const { kind, tone, style, ...rest } = props;
  const look = useLook();
  const r = roles[kind];
  return (
    <Text
      ref={ref}
      {...rest}
      style={[r.style, { color: toneColor(tone ?? r.tone, look.contrast) }, look.bold && BOLD, style]}
    />
  );
});

/**
 * The short rule: 1 pt of ink, `width` long. Never read aloud. `scaleX`
 * draws it out from its centre, as DEVELOP's does while a print develops.
 */
export function Rule({
  width,
  scaleX,
  color = room.ink,
  style,
}: {
  width: number;
  scaleX?: Animated.Value | Animated.AnimatedInterpolation<number>;
  color?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const look = useLook();
  return (
    <Animated.View
      accessible={false}
      importantForAccessibility="no"
      pointerEvents="none"
      style={[
        { width, height: 1, backgroundColor: color, opacity: look.contrast ? 1 : RULE_OPACITY },
        scaleX ? { transform: [{ scaleX }] } : null,
        style,
      ]}
    />
  );
}
