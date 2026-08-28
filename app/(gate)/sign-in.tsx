import React, { useState } from "react";
import { Alert, StyleSheet, Text } from "react-native";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";
import { supabase } from "@/lib/supabase";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      router.replace("/");
    } catch (err) {
      Alert.alert("Sign in failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.intro}>Welcome back.</Text>
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="password"
      />
      <Button title="Sign in" onPress={submit} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.title, marginTop: spacing.lg, marginBottom: spacing.xl, color: colors.ink },
});
