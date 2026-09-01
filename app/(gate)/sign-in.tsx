import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { GateLayout, GateHeading } from "@/components/gate/GateLayout";
import { GateField } from "@/components/gate/GateField";
import { GateButton } from "@/components/gate/GateButton";
import { colors, spacing, type } from "@/theme";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import { demoSignIn } from "@/demo/store";
import { showAlert } from "@/utils/alert";

/** Coming back to a place you already belong to. Two lines and a key. */
export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      if (isDemoMode()) {
        demoSignIn(email);
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      router.replace("/");
    } catch (err) {
      showAlert("Sign in failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <GateLayout>
      <GateHeading eyebrow="Members" title="Vintage" script blurb="Welcome back." />

      {isDemoMode() ? (
        <Text style={styles.demoHint}>
          Review build — any email and password work. Use one containing “admin” for the admin
          dashboard.
        </Text>
      ) : null}

      <GateField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
      />
      <GateField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />

      <GateButton title="Sign in" variant="solid" onPress={submit} loading={busy} />

      <View style={styles.spacer} />

      <GateButton
        title="I have an invitation"
        variant="quiet"
        onPress={() => router.replace("/(gate)/invite")}
      />
      <GateButton
        title="Apply for membership"
        variant="quiet"
        onPress={() => router.replace("/(gate)/apply")}
      />
    </GateLayout>
  );
}

const styles = StyleSheet.create({
  spacer: { flex: 1, minHeight: spacing.xl },
  demoHint: {
    fontFamily: type.mono,
    fontSize: 10,
    lineHeight: 17,
    letterSpacing: 0.6,
    color: colors.goldSoft,
    opacity: 0.75,
    marginBottom: spacing.xl,
  },
});
