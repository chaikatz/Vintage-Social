import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { GateLayout, GateHeading } from "@/components/gate/GateLayout";
import { GateField } from "@/components/gate/GateField";
import { GateButton } from "@/components/gate/GateButton";
import { colors, spacing, type } from "@/theme";
import { validateEmail, validatePassword, validateUsername } from "@/utils/validation";
import { checkUsernameAvailable, submitApplication } from "@/api/membership";

/**
 * The application.
 *
 * Written as a letter to a person, because that is what it is — an admin
 * reads every one of these by hand. The last field is the one that decides
 * it, so it is given room rather than squeezed in at the bottom.
 */
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
    <GateLayout>
      <GateHeading
        eyebrow="Apply"
        title="Vintage"
        script
        blurb="Tell us who you are and what you photograph. A member reads every application."
      />

      <Pressable style={styles.portrait} onPress={pickAvatar}>
        {avatarUri ? (
          <Image source={{ uri: avatarUri }} style={styles.portraitImage} contentFit="cover" />
        ) : (
          <View style={styles.portraitEmpty}>
            <Feather name="user" size={22} color={colors.goldSoft} />
          </View>
        )}
        <Text style={styles.portraitLabel}>
          {avatarUri ? "Change portrait" : "Add a portrait"}
        </Text>
      </Pressable>

      <GateField
        label="Name"
        value={fullName}
        onChangeText={setFullName}
        error={errors.fullName}
        autoCapitalize="words"
        autoComplete="name"
      />
      <GateField
        label="Desired username"
        value={username}
        onChangeText={setUsername}
        error={errors.username}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <GateField
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={errors.email}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
      />
      <GateField
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        secureTextEntry
      />
      <GateField
        label="Where your photographs live"
        value={socialHandle}
        onChangeText={setSocialHandle}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="@handle, or a link"
        hint="So we can see your work."
      />
      <GateField label="City" value={city} onChangeText={setCity} autoCapitalize="words" />
      <GateField
        label="Who sent you"
        value={inviter}
        onChangeText={setInviter}
        autoCapitalize="none"
        placeholder="Optional"
      />

      <View style={styles.divider} />

      <GateField
        label="Why do you want to join VINTAGE?"
        value={reason}
        onChangeText={setReason}
        error={errors.reason}
        multiline
        placeholder="A sentence or two, in your own words."
      />

      <GateButton title="Submit application" variant="solid" onPress={submit} loading={busy} />

      <Text style={styles.footnote}>
        Applications are read by people, not machines. Nothing here is scored, ranked, or decided
        automatically.
      </Text>
    </GateLayout>
  );
}

const styles = StyleSheet.create({
  portrait: { alignItems: "center", marginBottom: spacing.xl },
  portraitImage: { width: 82, height: 82, borderRadius: 41 },
  portraitEmpty: {
    width: 82,
    height: 82,
    borderRadius: 41,
    borderWidth: 1,
    borderColor: colors.goldSoft,
    opacity: 0.85,
    alignItems: "center",
    justifyContent: "center",
  },
  portraitLabel: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.goldSoft,
    marginTop: spacing.sm + 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.goldSoft,
    opacity: 0.22,
    marginBottom: spacing.xl,
  },
  footnote: {
    fontFamily: type.serif,
    fontSize: 12,
    lineHeight: 19,
    color: colors.goldSoft,
    opacity: 0.7,
    textAlign: "center",
    marginTop: spacing.lg,
  },
});
