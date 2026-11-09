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
import { Wordmark } from "@/components/Wordmark";
import { colors, spacing, type } from "@/theme";
import {
  validateEmail,
  validatePassword,
  validateUsername,
} from "@/utils/validation";
import { checkUsernameAvailable, fetchInviteOwner, joinWithInvite } from "@/api/membership";
import { errorMessage } from "@/utils/errorMessage";
import { describeSlugProblem, slugFromInput } from "@/utils/inviteLink";
import { useSession } from "@/providers/SessionProvider";
import { backFromDoor, invitationCarried } from "@/components/gate/door";
import { useDoorClosesBehind } from "@/components/gate/useDoor";

// A page at the door that breaks breaks only itself, not the whole app.
// There is no header and no tab bar here, so the way back is on the page
// (src/navigation/Recover.tsx): to the page before, or to Home, whose
// guard sends anyone not yet let in to the door or the waiting room.
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

/** How long the typing pauses before the code typed so far is asked about. */
const TYPING_PAUSE_MS = 350;

/**
 * The invitation.
 *
 * Set the way the front door is: the name small in the corner, the V as
 * the centrepiece, the words beneath it, fields ruled onto the page, and
 * the one way in as a line of capitals signed with the short rule. No
 * frame, no fill — the same page the landing is printed on, cream or
 * black as the phone is set, so an invitation and the door are one thing.
 */
export default function Invite() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refreshProfile } = useSession();
  // A tapped invitation arrives with its suffix already in the route, so
  // the field is filled in and the page can say who sent it before anyone
  // types anything. Pasted or typed by hand still works.
  const params = useLocalSearchParams<{ slug?: string }>();
  const [arrivedWith] = useState(params.slug ?? "");
  const [code, setCode] = useState(arrivedWith);
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
  // Whether Accept has been pressed here (see invitationCarried).
  const [tried, setTried] = useState(false);
  // Signed in, the card goes in: after a join whose account was made but
  // whose invitation was refused, to the waiting room that takes the code;
  // for a member who opened a link, to the app; for someone waiting who
  // opened one, to the waiting room with the invitation (see door.ts).
  const goIn = useDoorClosesBehind(busy, invitationCarried(arrivedWith, tried));

  // Ask who is behind the link as soon as there is one worth asking about.
  // This is the whole emotional payload of an invitation, and it should not
  // wait until after the form is filled in.
  useEffect(() => {
    const slug = slugFromInput(code);
    // Whatever was said of the code before is not said of this one.
    setInviter(null);
    setClosed(false);
    setUnknown(false);
    // Nothing to ask about: an empty field, which is how "I have an
    // invitation" opens this page (asked about "", the database answers that
    // nobody owns it, and the page opened on "That invitation isn’t one we
    // know"), or a code the database would refuse anyway.
    if (!slug || describeSlugProblem(slug)) return;
    let live = true;
    // A code that came with the link is asked about at once; one being
    // typed, once the typing pauses, so a half-typed code is not called
    // unknown at every letter and the database is not asked at every one.
    const ask = setTimeout(
      () => {
        fetchInviteOwner(slug)
          .then((owner) => {
            if (!live) return;
            setInviter(owner.inviter);
            setClosed(Boolean(owner.inviter) && !owner.open);
            setUnknown(owner.inviter === null);
          })
          .catch(() => undefined);
      },
      code === arrivedWith ? 0 : TYPING_PAUSE_MS,
    );
    return () => {
      live = false;
      clearTimeout(ask);
    };
  }, [code, arrivedWith]);

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

    setTried(true);
    setBusy(true);
    try {
      // With the email and password typed beside it: a try whose account
      // was made but whose answer never came back (no session was kept)
      // finds the name is its own account's, and carries on with it.
      const available = await checkUsernameAvailable(username, { email, password });
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
      // Read after the invitation was taken up. The read made as the new
      // member was signed in can have left before it, and says "applied".
      await refreshProfile({ fresh: true });
      await goIn();
    } catch (err) {
      // joinWithInvite's own sentence ("… Your account has been created;
      // enter a valid invitation to join.") comes through as it is.
      showAlert("Couldn’t join", errorMessage(err, "Check your connection and try again."));
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
            <Pressable hitSlop={14} onPress={() => backFromDoor(router)} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}>
              <Feather name="chevron-left" size={22} color={colors.ink as unknown as string} />
            </Pressable>
            <Wordmark tagline="Members only" />
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

          {/* As on the application: what is agreed to is said before the account is made (App Review Guideline 1.2). */}
          <Text style={styles.agree}>
            By accepting you agree to the{" "}
            <Text style={styles.agreeLink} onPress={() => router.push("/legal/terms")} accessibilityRole="link">
              Terms of Use
            </Text>{" "}
            and{" "}
            <Text style={styles.agreeLink} onPress={() => router.push("/legal/privacy")} accessibilityRole="link">
              Privacy Policy
            </Text>
            .
          </Text>

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
  // The application's footnote and its links, to the point.
  agree: {
    fontFamily: type.serif,
    fontSize: 12,
    lineHeight: 19,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  agreeLink: { textDecorationLine: "underline", color: colors.ink },

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
