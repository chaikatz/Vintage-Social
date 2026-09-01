import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { GateButton } from "@/components/gate/GateButton";
import { colors, spacing, type } from "@/theme";
import { isDemoMode } from "@/lib/env";

/** A misty river, sunk almost to nothing — texture, not content. */
const GROUND = require("../../assets/brand/gate.jpg");

/**
 * The front door.
 *
 * One photograph, drowned in brown until only the mist of it is left, a
 * vignette to weight the corners, and the wordmark struck in gold over the
 * top. The whole point of VINTAGE is that not everyone is inside, so this
 * screen has to read as a closed door rather than a sign-up funnel: no
 * screenshots of the app, no feature list, no counting of members.
 */
export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />

      <Image source={GROUND} style={StyleSheet.absoluteFill} contentFit="cover" />
      <View style={[StyleSheet.absoluteFill, styles.wash]} pointerEvents="none" />
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="g" cx="50%" cy="42%" r="78%">
            <Stop offset="0.25" stopColor={colors.cardDeep} stopOpacity={0.55} />
            <Stop offset="1" stopColor="#17120D" stopOpacity={0.97} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#g)" />
      </Svg>

      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
        <View style={styles.center}>
          <Text style={styles.wordmark}>Vintage</Text>
          <View style={styles.rule} />
          <Text style={styles.tagline}>Membership required</Text>
          <Text style={styles.blurb}>
            A quiet place for photographs, kept small on purpose. No feeds you
            didn’t ask for, no numbers to chase.
          </Text>
        </View>

        <View style={styles.actions}>
          <GateButton
            title="Apply for membership"
            variant="solid"
            onPress={() => router.push("/(gate)/apply")}
          />
          <GateButton
            title="I have a nomination"
            onPress={() => router.push("/(gate)/invite")}
            style={styles.gap}
          />
          <GateButton
            title="Sign in"
            variant="quiet"
            onPress={() => router.push("/(gate)/sign-in")}
            style={styles.gap}
          />

          <View style={styles.footRule} />
          <Text style={styles.foot}>Members only · Est. 2026</Text>
          {isDemoMode() ? (
            <Text style={styles.demoNote}>Review build · demo data · any sign-in works</Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cardDeep },
  // The photograph is barely there: a multiply wash sinks it into the stock
  // so it reads as grain in the paper rather than a picture on a poster.
  wash: { backgroundColor: colors.card, opacity: 0.76 },

  content: { flex: 1, paddingHorizontal: spacing.xl + spacing.xs },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  wordmark: {
    fontFamily: type.script,
    fontSize: 68,
    lineHeight: 96,
    color: colors.gold,
    textAlign: "center",
  },
  rule: {
    height: 1,
    width: 62,
    backgroundColor: colors.goldSoft,
    opacity: 0.6,
    marginTop: spacing.sm,
  },
  tagline: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 3.4,
    textTransform: "uppercase",
    color: colors.goldSoft,
    marginTop: spacing.lg,
  },
  blurb: {
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 23,
    color: colors.goldSoft,
    opacity: 0.85,
    textAlign: "center",
    marginTop: spacing.lg,
    maxWidth: 292,
  },

  actions: { paddingBottom: spacing.lg },
  gap: { marginTop: spacing.md },
  footRule: {
    height: 1,
    width: 30,
    alignSelf: "center",
    backgroundColor: colors.goldSoft,
    opacity: 0.35,
    marginTop: spacing.xl,
  },
  foot: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: colors.goldSoft,
    opacity: 0.7,
    textAlign: "center",
    marginTop: spacing.md,
  },
  demoNote: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.4,
    color: colors.goldSoft,
    opacity: 0.45,
    textAlign: "center",
    marginTop: spacing.sm,
  },
});
