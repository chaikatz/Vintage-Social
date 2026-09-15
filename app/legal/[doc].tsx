import React from "react";
import { StyleSheet, Text } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Screen } from "@/components/Screen";
import { colors, spacing, type } from "@/theme";
import { LEGAL_TITLES, LEGAL_UPDATED, legalText, type LegalDoc } from "@/legal/documents";

/**
 * The privacy policy and the terms, set in the app's own type. Always
 * reachable from Settings and from the door, whether or not the web copy
 * is configured.
 */
export default function Legal() {
  const { doc } = useLocalSearchParams<{ doc: string }>();
  const which: LegalDoc = doc === "terms" ? "terms" : "privacy";
  const paragraphs = legalText(which).split(/\n\n+/);

  return (
    <Screen scroll>
      <Stack.Screen options={{ title: LEGAL_TITLES[which] }} />
      <Text style={styles.updated}>Last updated {LEGAL_UPDATED}</Text>
      {paragraphs.map((p, i) =>
        p.startsWith("## ") ? (
          <Text key={i} style={styles.heading}>
            {p.slice(3)}
          </Text>
        ) : (
          <Text key={i} style={styles.body}>
            {p}
          </Text>
        ),
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  updated: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.inkFaint,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  heading: { ...type.title, fontSize: 17, marginTop: spacing.xl, marginBottom: spacing.sm },
  body: { fontFamily: type.serif, fontSize: 15, lineHeight: 24, color: colors.ink, marginBottom: spacing.md },
});
