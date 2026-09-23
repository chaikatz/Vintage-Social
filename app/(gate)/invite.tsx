import React, { useEffect, useState } from "react";
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
import { useLocalSearchParams, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { GateField } from "@/components/gate/GateField";
import { GateButton } from "@/components/gate/GateButton";
import { MarkStage } from "@/components/MarkStage";
import { colors, spacing, type } from "@/theme";
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/utils/validation";
import { checkUsernameAvailable, fetchInviteOwner, joinWithInvite } from "@/api/membership";
import { describeSlugProblem, slugFromInput } from "@/utils/inviteLink";
import { useSession } from "@/providers/SessionProvider";

/**
 * The invitation.
 *
 * Set the way the front door is: the name small in the corner, the V as
 * the centrepiece, the words beneath it, fields ruled onto the page, and
 * the one way in as a line of capitals signed with the short rule. No
 * frame, no fill — the same cream page the landing is printed on, so an
 * invitation and the door are one thing.
 */
export default function Invite() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshProfile } = useSession();
  // A tapped invitation arrives with its suffix already in the route, so
  // the field is filled in and the page can say who sent it before anyone
  // types anything. Pasted or typed by hand still works.
  const params = useLocalSearchParams<{ slug?: string }>();
  const [code, setCode] = useState(params.slug ?? "");
  const [inviter, setInviter] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  // A well-formed code that nobody owns: a typo, or a link since replaced.
  const [unknown, setUnknown] = useState(false);
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [busy, setBusy] = useState(false);

  // Ask who is behind the link as soon as there is one worth asking about.
  // This is the whole emotional payload of an invitation, and it should not
  // wait until after the form is filled in.
  useEffect(() => {
    const slug = slugFromInput(code);
    if (describeSlugProblem(slug)) {
      setInviter(null);
      setClosed(false);
      setUnknown(false);
      return;
    }
    let live = true;
    fetchInviteOwner(slug)
      .then((owner) => {
        if (!live) return;
        setInviter(owner.inviter);
        setClosed(Boolean(owner.inviter) && !owner.open);
        setUnknown(owner.inviter === null);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [code]);

  const submit = async () => {
    const next: Record<string, string | null> = {
      code: describeSlugProblem(slugFromInput(code)) ?? (code.trim() ? null : "Enter your invitation."),
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
        code: slugFromInput(code),
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
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xxl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* The name, small, in the corner — back to the door is one tap left of it. */}
          <View style={styles.head}>
            <Pressable hitSlop={14} onPress={() => router.back()} accessibilityLabel="Back" style={styles.back}>
              <Feather name="chevron-left" size={22} color={colors.ink as unknown as string} />
            </Pressable>
            <View style={styles.brand}>
              <Text style={styles.brandWord}>VINTAGE</Text>
              <View style={styles.brandRule} />
            </View>
          </View>

          <MarkStage height={200} fill={1.15} style={styles.mark} />

          <Text style={styles.eyebrow}>By invitation</Text>
          <Text style={styles.blurb}>
            {inviter
              ? closed
                ? `${inviter} invited you, but every invitation they were given has since been taken up.`
                : `${inviter} invited you to VINTAGE. Fill this in and you are a member — no queue, no review.`
              : unknown
                ? "That invitation isn’t one we know. Check the code against what you were sent — the member may also have replaced their link."
                : "A member has put your name forward. Enter the invitation they sent and you are in — no queue, no review."}
          </Text>

          <View style={styles.form}>
            <GateField
              label="Invitation"
              value={code}
              onChangeText={setCode}
              error={errors.code}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="the link or its ending"
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
          </View>

          <GateButton title="Accept the invitation" variant="quiet" onPress={submit} loading={busy} style={styles.accept} />

          <Text style={styles.foot}>Members only · Est. 2026</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  scroll: { flexGrow: 1, paddingHorizontal: 40 },

  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginLeft: -spacing.xl },
  back: { paddingVertical: spacing.xs },
  // The landing page's wordmark at 36% — every measure scaled the same.
  brand: { alignItems: "center" },
  brandWord: { fontFamily: type.serif, fontSize: 15, lineHeight: 18, letterSpacing: 4, color: colors.ink },
  brandRule: { width: 9, height: 1, backgroundColor: colors.ink, opacity: 0.85, marginTop: 3 },

  mark: { marginTop: spacing.xxl },

  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.inkFaint,
    textAlign: "center",
    marginTop: spacing.xl,
  },
  blurb: {
    fontFamily: type.serif,
    fontSize: 15,
    lineHeight: 23,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: spacing.md,
    marginBottom: spacing.xl,
  },
  form: {},
  accept: { alignSelf: "center", marginTop: spacing.sm },

  foot: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.5,
    textTransform: "uppercase",
    color: colors.inkFaint,
    textAlign: "center",
    marginTop: spacing.xxl,
  },
});
