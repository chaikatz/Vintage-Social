import React, { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { showAlert } from "@/utils/alert";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { colors, spacing, type } from "@/theme";
import {
  normalizeInviteCode,
  validateEmail,
  validateInviteCode,
  validatePassword,
  validateUsername,
} from "@/utils/validation";
import { checkUsernameAvailable, joinWithInvite } from "@/api/membership";
import { useSession } from "@/providers/SessionProvider";

export default function Invite() {
  const router = useRouter();
  const { refreshProfile } = useSession();
  const [code, setCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const next: Record<string, string | null> = {
      code: validateInviteCode(code),
      username: validateUsername(username),
      email: validateEmail(email),
      password: validatePassword(password),
      fullName: fullName.trim() ? null : "Please tell us your name.",
    };
    setErrors(next);
    if (Object.values(next).some(Boolean)) return;

    setBusy(true);
    try {
      const available = await checkUsernameAvailable(username);
      if (!available) {
        setErrors((e) => ({ ...e, username: "That username is taken." }));
        return;
      }
      await joinWithInvite({
        email,
        password,
        fullName,
        desiredUsername: username,
        code: normalizeInviteCode(code),
      });
      await refreshProfile();
      router.replace("/");
    } catch (err) {
      showAlert("Couldn’t join", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.intro}>
        An invitation from a member admits you straight away.
      </Text>
      <TextField
        label="Invitation code"
        value={code}
        onChangeText={(t) => setCode(normalizeInviteCode(t))}
        error={errors.code}
        autoCapitalize="characters"
        autoCorrect={false}
        placeholder="ABCD-1234"
      />
      <TextField label="Name" value={fullName} onChangeText={setFullName} error={errors.fullName} />
      <TextField
        label="Username"
        value={username}
        onChangeText={setUsername}
        error={errors.username}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TextField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        keyboardType="email-address"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
      />
      <Button title="Join VINTAGE" onPress={submit} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.body, marginTop: spacing.lg, marginBottom: spacing.xl, color: colors.inkSoft },
});
