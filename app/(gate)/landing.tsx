import React from "react";
import { DynamicColorIOS, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { dateStampText } from "@/utils/time";
import { isDemoMode } from "@/lib/env";

/**
 * The front door.
 *
 * The wordmark, three prints on the table, and three ways in. The page is
 * the same cream as the rest of the app; the prints are paper — white
 * borders, a deeper bottom, a soft shadow, each leaning its own way with
 * the middle one on top — and every photograph carries its date in the
 * corner the way a post does. Nothing else: no feature list, no counting
 * of members. The whole point of VINTAGE is that not everyone is inside.
 *
 * The three photographs are real image assets (assets/landing); the
 * borders, stamps, buttons and words are drawn here so they stay crisp on
 * every screen and follow the appearance setting.
 */

const PRINTS = [
  // `inset` keeps a stamp clear of the print lying on top of it.
  { source: require("../../assets/landing/left.jpg"), taken: "2023-07-14", rotate: -10, dx: -0.28, dy: 0.05, z: 1, inset: 0.3 },
  { source: require("../../assets/landing/middle.jpg"), taken: "2022-10-03", rotate: 0.5, dx: 0, dy: -0.05, z: 3, inset: 0.06 },
  { source: require("../../assets/landing/right.jpg"), taken: "2023-07-14", rotate: 9, dx: 0.28, dy: 0.07, z: 2, inset: 0.06 },
] as const;

/** The dark of the primary button as printed on the reference; cream on the dark page. */
const BUTTON = Platform.OS === "ios" ? DynamicColorIOS({ light: "#3F3C35", dark: "#F3E6D3" }) : "#3F3C35";
const ON_BUTTON = Platform.OS === "ios" ? DynamicColorIOS({ light: "#F6F1E8", dark: "#3B2C27" }) : "#F6F1E8";

export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // A print is about a third of the page wide, a touch narrower on small
  // phones so three still fit with their overlap; everything on it scales
  // from that one number.
  const printWidth = Math.round(Math.min(width * 0.31, 132));
  const photoWidth = printWidth - Math.round(printWidth * 0.14);
  const photoHeight = Math.round(photoWidth * 1.22);
  const printHeight = photoHeight + Math.round(printWidth * 0.07) + Math.round(printWidth * 0.2);
  const stage = printHeight + Math.round(printWidth * 0.5);
  // The page is divided the way the reference is: air above the wordmark,
  // the prints a little below the middle, the buttons in the lower third.
  // Flexible spacers carry the proportions across tall and short phones.
  const short = height < 720;

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={[styles.space, { flex: short ? 0.5 : 1.1 }]} />
        <View style={styles.top}>
          <Text style={styles.wordmark} accessibilityRole="header">
            VINTAGE
          </Text>
          <View style={styles.rule} />
        </View>
        <View style={[styles.space, { flex: short ? 0.4 : 0.8 }]} />

        <View style={[styles.stage, { height: stage }]} accessibilityLabel="Three photographs">
          {PRINTS.map((p) => (
            <View
              key={p.taken + p.rotate}
              style={[
                styles.print,
                {
                  width: printWidth,
                  height: printHeight,
                  padding: Math.round(printWidth * 0.07),
                  paddingBottom: Math.round(printWidth * 0.2),
                  zIndex: p.z,
                  transform: [
                    { translateX: Math.round(p.dx * width) },
                    { translateY: Math.round(p.dy * stage) },
                    { rotate: `${p.rotate}deg` },
                  ],
                },
              ]}
            >
              <View style={[styles.photo, { width: photoWidth, height: photoHeight }]}>
                <Image source={p.source} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} />
                <Text style={[styles.stamp, { fontSize: Math.round(printWidth * 0.062), right: Math.round(photoWidth * p.inset) }]}>
                  {dateStampText(p.taken)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        <View style={[styles.space, { flex: short ? 0.5 : 1 }]} />
        <View style={styles.actions}>
          <Pressable
            style={({ pressed }) => [styles.button, styles.buttonSolid, pressed && styles.pressed]}
            onPress={() => router.push("/(gate)/apply")}
            accessibilityRole="button"
          >
            <Text style={[styles.buttonLabel, styles.buttonLabelSolid]}>Apply for membership</Text>
            <Feather name="arrow-right" size={18} color={ON_BUTTON as unknown as string} style={styles.arrow} />
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.button, styles.buttonOutline, pressed && styles.pressed]}
            onPress={() => router.push("/(gate)/invite")}
            accessibilityRole="button"
          >
            <Text style={styles.buttonLabel}>I have an invitation</Text>
            <Feather name="arrow-right" size={18} color={colors.ink as unknown as string} style={styles.arrow} />
          </Pressable>
          <Pressable style={styles.signIn} hitSlop={10} onPress={() => router.push("/(gate)/sign-in")} accessibilityRole="button">
            <Text style={styles.signInLabel}>Sign in</Text>
            <View style={styles.signInRule} />
          </Pressable>
        </View>

        <View style={[styles.space, { flex: short ? 0.3 : 0.6 }]} />
        <View style={styles.foot}>
          <Text style={styles.footText}>Members only · Est. 2026</Text>
          <View style={styles.legalRow}>
            <Pressable hitSlop={8} onPress={() => router.push("/legal/privacy")} accessibilityRole="link">
              <Text style={styles.footText}>Privacy</Text>
            </Pressable>
            <Text style={styles.footText}>·</Text>
            <Pressable hitSlop={8} onPress={() => router.push("/legal/terms")} accessibilityRole="link">
              <Text style={styles.footText}>Terms</Text>
            </Pressable>
          </View>
          {isDemoMode() ? <Text style={styles.demoNote}>Review build · demo data · any sign-in works</Text> : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, paddingHorizontal: 40 },

  space: { minHeight: 8 },
  top: { alignItems: "center" },
  wordmark: {
    fontFamily: type.serif,
    fontSize: 42,
    lineHeight: 50,
    letterSpacing: 11,
    color: colors.ink,
    textAlign: "center",
  },
  rule: { width: 24, height: 1, backgroundColor: colors.ink, marginTop: spacing.sm, opacity: 0.85 },

  stage: { alignItems: "center", justifyContent: "center" },
  print: {
    position: "absolute",
    backgroundColor: "#FBF9F4",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E4DED3",
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  photo: { overflow: "hidden", backgroundColor: "#D9D2C6" },
  stamp: {
    position: "absolute",
    right: 7,
    bottom: 5,
    fontFamily: type.mono,
    fontWeight: "600",
    letterSpacing: 1,
    color: colors.stamp,
    textShadowColor: colors.stampGlow,
    textShadowRadius: 3,
    textShadowOffset: { width: 0, height: 0 },
    opacity: 0.6,
  },

  actions: {},
  button: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  buttonSolid: { backgroundColor: BUTTON },
  buttonOutline: { borderWidth: 1, borderColor: colors.ink },
  pressed: { opacity: 0.8 },
  buttonLabel: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  buttonLabelSolid: { color: ON_BUTTON },
  arrow: { position: "absolute", right: 16 },

  signIn: { alignItems: "center", marginTop: spacing.md },
  signInLabel: {
    fontFamily: type.mono,
    fontSize: 12,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.ink,
  },
  signInRule: { width: 26, height: 1, backgroundColor: colors.ink, marginTop: 7, opacity: 0.8 },

  foot: { alignItems: "center", gap: 6 },
  footText: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  legalRow: { flexDirection: "row", gap: 8 },
  demoNote: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.inkFaint,
    opacity: 0.7,
    textAlign: "center",
    marginTop: 4,
  },
});
