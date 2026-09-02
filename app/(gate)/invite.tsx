import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { showAlert } from "@/utils/alert";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { EngravedCard } from "@/components/EngravedCard";
import { GateField } from "@/components/gate/GateField";
import { GateButton } from "@/components/gate/GateButton";
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

/**
 * The invitation.
 *
 * Everywhere else in VINTAGE the chrome recedes and the photographs carry
 * the screen. Here there is no photograph yet — only the card someone sent
 * you — so this one screen is allowed to be the object itself: printed
 * brown stock, a struck gold rule with mitred corners, a script hand. It
 * should feel like something that arrived, not a form that loaded.
 */
export default function Invite() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
    <View style={styles.root}>
      <StatusBar style="light" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xxl },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <EngravedCard style={styles.card}>
            <View style={styles.cardInner}>
              <Text style={styles.eyebrow}>By invitation</Text>
              <Text style={styles.wordmark}>Vintage</Text>
              <View style={styles.rule} />
              <Text style={styles.blurb}>
                A member has put your name forward. Enter the code they sent and you are in —
                no queue, no review.
              </Text>

              <GateField
                label="Invitation code"
                value={code}
                onChangeText={(t) => setCode(normalizeInviteCode(t))}
                error={errors.code}
                autoCapitalize="characters"
                autoCorrect={false}
                placeholder="ABCD-1234"
                mono
              />
              <GateField
                label="Name"
                value={fullName}
                onChangeText={setFullName}
                error={errors.fullName}
                autoCapitalize="words"
              />
              <GateField
                label="Username"
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
                keyboardType="email-address"
              />
              <GateField
                label="Password"
                value={password}
                onChangeText={setPassword}
                error={errors.password}
                secureTextEntry
              />

              <GateButton title="Accept the invitation" onPress={submit} loading={busy} />

              <View style={styles.footRule} />
              <Text style={styles.foot}>Members only · Est. 2026</Text>
            </View>
          </EngravedCard>
        </ScrollView>
      </KeyboardAvoidingView>
      <Pressable
        style={[styles.back, { top: insets.top + spacing.sm }]}
        hitSlop={14}
        onPress={() => router.back()}
        accessibilityLabel="Back"
      >
        <Feather name="chevron-left" size={22} color={colors.goldSoft} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.cardDeep },
  // flexGrow lets the card stretch to the full height of a short screen
  // instead of floating in the top half of it.
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md },
  card: { flex: 1 },
  back: { position: "absolute", left: spacing.md + spacing.sm },
  cardInner: { paddingHorizontal: spacing.xl + spacing.sm, paddingVertical: spacing.xxl },

  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.goldSoft,
    textAlign: "center",
  },
  wordmark: {
    fontFamily: type.script,
    fontSize: 58,
    lineHeight: 82,
    color: colors.gold,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  rule: {
    height: 1,
    width: 54,
    alignSelf: "center",
    backgroundColor: colors.goldSoft,
    opacity: 0.6,
    marginTop: spacing.xs,
  },
  blurb: {
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 22,
    color: colors.goldSoft,
    textAlign: "center",
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },

  footRule: {
    height: 1,
    width: 34,
    alignSelf: "center",
    backgroundColor: colors.goldSoft,
    opacity: 0.4,
    marginTop: spacing.xxl,
  },
  foot: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: colors.goldSoft,
    opacity: 0.8,
    textAlign: "center",
    marginTop: spacing.md,
  },
});
