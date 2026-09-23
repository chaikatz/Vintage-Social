import React from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import { colors, spacing, type } from "@/theme";
import { ruleWidth } from "@/components/gate/rule";
import { isDemoMode } from "@/lib/env";

/** The mark, as it turns on vintagesocial.app — a still of the V. */
const MARK = require("../../assets/brand/mark-v.png");

/**
 * The front door — the same page as vintagesocial.app (public/home.html).
 *
 * The name small in the corner, the V as the centrepiece, and three ways
 * in as words alone, each signed with the short rule. Nothing else: no
 * feature list, no counting of members. The whole point of VINTAGE is
 * that not everyone is inside.
 *
 * The web page turns the V in three dimensions; here it stands still,
 * rendered from the same scene. Every measure below is the web page's:
 * the wordmark at 36%, the words at 11 and 12 points of the typewriter
 * face, the rule 26 points or as long as the word.
 */
export default function Landing() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();

  // The stage takes its measure from what a print was — about a third of
  // the page wide — so the V stands where the prints lay and the ways in
  // keep their place beneath it.
  const pw = Math.min(width * 0.31, 132);
  const markHeight = Math.round(pw * 1.95);
  const stage = markHeight + Math.round(pw * 0.6);
  // The page is divided the way the web page is: air above, the V a little
  // below the middle, the ways in the lower third. Flexible spacers carry
  // the proportions across tall and short phones.
  const short = height < 720;

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <View style={[styles.content, { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={[styles.brand, { top: insets.top + 22 }]} accessibilityRole="header">
          <Text style={styles.brandWord}>VINTAGE</Text>
          <View style={styles.brandRule} />
        </View>

        <View style={[styles.space, { flex: short ? 0.5 : 1.1 }]} />
        <View style={[styles.space, { flex: short ? 0.4 : 0.8 }]} />

        <View style={[styles.stage, { height: stage }]}>
          <Image
            source={MARK}
            style={{ height: markHeight, width: Math.round(markHeight * 0.905) }}
            contentFit="contain"
            transition={0}
            accessibilityLabel="The VINTAGE mark, a serif V"
          />
        </View>

        <View style={[styles.space, { flex: short ? 0.5 : 1 }]} />
        <View style={styles.actions}>
          <Way label="Apply for membership" onPress={() => router.push("/(gate)/apply")} />
          <Way label="I have an invitation" onPress={() => router.push("/(gate)/invite")} />
          <Way label="Sign in" onPress={() => router.push("/(gate)/sign-in")} signIn />
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

/** A way in: a line of capitals signed with the short rule. */
function Way({ label, onPress, signIn = false }: { label: string; onPress: () => void; signIn?: boolean }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.way, signIn && styles.waySignIn, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Text style={[styles.wayLabel, signIn && styles.wayLabelSignIn]}>{label}</Text>
      <View style={[styles.wayRule, { width: ruleWidth(label) }]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  content: { flex: 1, paddingHorizontal: 40 },

  // The landing page's wordmark at 36% — every measure scaled the same, the rule centred.
  brand: { position: "absolute", left: 24, alignItems: "center", zIndex: 2 },
  brandWord: { fontFamily: type.serif, fontSize: 15, lineHeight: 18, letterSpacing: 4, color: colors.ink },
  brandRule: { width: 9, height: 1, backgroundColor: colors.ink, opacity: 0.85, marginTop: 3 },

  space: { minHeight: 8 },
  stage: { alignItems: "center", justifyContent: "center" },

  actions: { alignItems: "center" },
  way: { height: 44, marginBottom: 10, paddingHorizontal: 10, alignItems: "center", justifyContent: "center" },
  waySignIn: { height: undefined, marginTop: 12, marginBottom: 0, paddingVertical: 4 },
  pressed: { opacity: 0.8 },
  wayLabel: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  wayLabelSignIn: { fontSize: 12, letterSpacing: 3 },
  wayRule: { height: 1, backgroundColor: colors.ink, marginTop: 7, opacity: 0.8 },

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
