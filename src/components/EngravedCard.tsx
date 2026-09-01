import React from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import Svg, { Polygon } from "react-native-svg";
import { colors } from "@/theme";

/**
 * The double rule with cut corners that frames a printed invitation.
 *
 * Drawn rather than styled: a border-radius rounds a corner, and this needs
 * it mitred — the corner of a card that was cut, not moulded. Two polygons
 * at different insets give the engraved double line.
 */
export function EngravedCard({
  children,
  style,
  cut = 34,
}: {
  children?: React.ReactNode;
  /** Length of the mitre along each edge, in points. */
  cut?: number;
  style?: ViewStyle;
}) {
  const [size, setSize] = React.useState({ width: 0, height: 0 });

  return (
    <View
      style={[styles.card, style]}
      onLayout={(e) => setSize(e.nativeEvent.layout)}
    >
      {size.width > 0 ? (
        <Svg
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
          width={size.width}
          height={size.height}
        >
          <Polygon
            points={octagon(size.width, size.height, 14, cut)}
            fill="none"
            stroke={colors.gold}
            strokeWidth={1}
          />
          <Polygon
            points={octagon(size.width, size.height, 20, cut - 6)}
            fill="none"
            stroke={colors.gold}
            strokeWidth={0.75}
            opacity={0.75}
          />
        </Svg>
      ) : null}
      {children}
    </View>
  );
}

/** A rectangle inset by `pad` with each corner mitred by `cut`. */
function octagon(width: number, height: number, pad: number, cut: number): string {
  const l = pad;
  const t = pad;
  const r = width - pad;
  const b = height - pad;
  // Never let the mitres meet in the middle of a short edge.
  const c = Math.max(0, Math.min(cut, (r - l) / 2 - 1, (b - t) / 2 - 1));
  return [
    [l + c, t],
    [r - c, t],
    [r, t + c],
    [r, b - c],
    [r - c, b],
    [l + c, b],
    [l, b - c],
    [l, t + c],
  ]
    .map(([x, y]) => `${x},${y}`)
    .join(" ");
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, overflow: "hidden" },
});
