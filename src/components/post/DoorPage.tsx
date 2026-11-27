import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, type } from "@/theme";

/**
 * The page the slide brings in to the right of Recent: the Memory Room's
 * own paper (the room is printed on the app's page, light or dark), with
 * its name as the room's first page sets it and the room's one line, and
 * nothing else — no photograph, no read of the library. It is only ever
 * seen on the way in: once the pager comes to rest on it the room is
 * pushed and fades in over it, and once the room covers the tab the pager
 * goes back to Recent.
 */

const BAR_TYPE_CAP = 1.8;
const TYPE_CAP = 2.4;

export function DoorPage() {
  return (
    <View testID="post-door-page" style={styles.page} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text style={styles.eyebrow} maxFontSizeMultiplier={BAR_TYPE_CAP}>
        The Memory Room
      </Text>
      <Text style={styles.line} maxFontSizeMultiplier={TYPE_CAP}>
        One photograph at a time.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.paper, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 },
  eyebrow: { fontFamily: type.mono, fontSize: 11, letterSpacing: 3, textTransform: "uppercase", color: colors.accent },
  line: { fontFamily: type.serif, fontSize: 22, lineHeight: 28, color: colors.ink, marginTop: 16, textAlign: "center" },
});
