import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Redirect } from "expo-router";
import { useSession } from "@/providers/SessionProvider";
import { colors, type } from "@/theme";

/**
 * The gatekeeper. Everyone lands here; where they go depends on membership:
 * signed out → landing, approved → the app, everyone else → pending.
 */
export default function Index() {
  const { session, profile, profileLoaded } = useSession();

  if (session === undefined || (session && !profileLoaded)) {
    return (
      <View style={styles.splash}>
        <Text style={type.wordmark}>VINTAGE</Text>
        <ActivityIndicator style={styles.spinner} color={colors.inkSoft} />
      </View>
    );
  }

  if (!session) return <Redirect href="/(gate)/landing" />;
  if (profile?.status === "approved") return <Redirect href="/(tabs)" />;
  return <Redirect href="/(gate)/pending" />;
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paper,
  },
  spinner: { marginTop: 24 },
});
