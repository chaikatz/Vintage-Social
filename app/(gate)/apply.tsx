import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { colors, radii, spacing, type } from "@/theme";
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/utils/validation";
import { checkUsernameAvailable, submitApplication } from "@/api/membership";

export default function Apply() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [socialHandle, setSocialHandle] = useState("");
  const [city, setCity] = useState("");
  const [inviter, setInviter] = useState("");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) setAvatarUri(result.assets[0].uri);
  };

  const submit = async () => {
    const next: Record<string, string | null> = {
      email: validateEmail(email),
      password: validatePassword(password),
      username: validateUsername(username),
      fullName: fullName.trim() ? null : "Please tell us your name.",
      reason: reason.trim().length >= 20 ? null : "A sentence or two, at least.",
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
      await submitApplication({
        email,
        password,
        fullName,
        desiredUsername: username,
        avatarUri,
        socialHandle,
        city,
        inviter,
        reason,
      });
      router.replace("/(gate)/pending");
    } catch (err) {
      showAlert("Application failed", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <Text style={styles.intro}>
        VINTAGE is members-only. Tell us a little about yourself and an admin
        will review your application.
      </Text>

      <Pressable style={styles.avatarPicker} onPress={pickAvatar}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]}>
            <Text style={styles.avatarHint}>Add{"\n"}photo</Text>
          </View>
        )}
        <Text style={styles.avatarLabel}>Profile photograph</Text>
      </Pressable>

      <TextField label="Name" value={fullName} onChangeText={setFullName} error={errors.fullName} autoComplete="name" />
      <TextField
        label="Desired username"
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
        autoComplete="email"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
      />
      <TextField
        label="Instagram or social handle"
        value={socialHandle}
        onChangeText={setSocialHandle}
        autoCapitalize="none"
        hint="So we can see your photographs."
      />
      <TextField label="City" value={city} onChangeText={setCity} />
      <TextField
        label="Who invited you? (optional)"
        value={inviter}
        onChangeText={setInviter}
        autoCapitalize="none"
      />
      <TextField
        label="Why do you want to join VINTAGE?"
        value={reason}
        onChangeText={setReason}
        error={errors.reason}
        multiline
      />

      <Button title="Submit application" onPress={submit} loading={busy} />
      <Text style={styles.footnote}>
        Applications are reviewed by people, not machines.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  intro: { ...type.body, marginTop: spacing.lg, marginBottom: spacing.xl, color: colors.inkSoft },
  avatarPicker: { alignItems: "center", marginBottom: spacing.xl },
  avatar: { width: 84, height: 84, borderRadius: radii.round, backgroundColor: colors.paperSunken },
  avatarEmpty: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarHint: { ...type.caption, textAlign: "center", color: colors.inkFaint },
  avatarLabel: { ...type.label, marginTop: spacing.sm },
  footnote: { ...type.caption, textAlign: "center", marginTop: spacing.lg, color: colors.inkFaint },
});
