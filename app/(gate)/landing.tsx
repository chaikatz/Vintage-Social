import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";

export default function Landing() {
  const router = useRouter();
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.center}>
        <Text style={styles.wordmark}>VINTAGE</Text>
        <View style={styles.rule} />
        <Text style={styles.tagline}>Membership required.</Text>
        <Text style={styles.sub}>
          A quiet place for photographs, kept small on purpose.
        </Text>
      </View>
      <View style={styles.actions}>
        <Button title="Apply for membership" onPress={() => router.push("/(gate)/apply")} />
        <Button
          title="I have an invitation"
          variant="secondary"
          onPress={() => router.push("/(gate)/invite")}
          style={styles.gap}
        />
        <Button
          title="Already a member? Sign in"
          variant="quiet"
          onPress={() => router.push("/(gate)/sign-in")}
          style={styles.gap}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  wordmark: { ...type.wordmark },
  rule: {
    width: 56,
    height: 1,
    backgroundColor: colors.borderStrong,
    marginVertical: spacing.lg,
  },
  tagline: { fontFamily: type.serif, fontSize: 16, color: colors.ink, letterSpacing: 1 },
  sub: {
    ...type.caption,
    textAlign: "center",
    marginTop: spacing.md,
    maxWidth: 260,
  },
  actions: { paddingBottom: spacing.xl },
  gap: { marginTop: spacing.md },
});
