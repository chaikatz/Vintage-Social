import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { showAlert } from "@/utils/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { EngravedCard } from "@/components/EngravedCard";
import { colors, radii, spacing, type } from "@/theme";
import { fetchInviteLink, rotateInviteLink, setInviteSlug } from "@/api/membership";
import {
  SLUG_MAX,
  describeSlugProblem,
  inviteLinkIsWeb,
  inviteUrl,
  inviteUrlLabel,
} from "@/utils/inviteLink";

/**
 * Invitations.
 *
 * One link, kept for as long as the member wants it, shared with whoever
 * they like. The allowance is only spent when somebody actually joins
 * through it — sending costs nothing — which is the whole reason this is a
 * link and not a pile of one-shot codes. People hoarded the codes because
 * sending one cost you it whether or not anybody came.
 *
 * The card is the same printed object the recipient sees on the way in, so
 * a member knows what they are handing over.
 */
export default function Invitations() {
  const queryClient = useQueryClient();
  const link = useQuery({ queryKey: ["invite-link"], queryFn: fetchInviteLink });

  const [suffix, setSuffix] = useState("");
  const [copied, setCopied] = useState(false);

  // The field starts as whatever the link currently is, so editing it reads
  // as changing something rather than filling something in.
  useEffect(() => {
    if (link.data?.slug) setSuffix(link.data.slug);
  }, [link.data?.slug]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["invite-link"] });
  const fail = (err: unknown) =>
    showAlert("That didn't work", err instanceof Error ? err.message : String(err));

  const rename = useMutation({ mutationFn: setInviteSlug, onSuccess: refresh, onError: fail });
  const rotate = useMutation({ mutationFn: rotateInviteLink, onSuccess: refresh, onError: fail });

  if (link.isLoading || !link.data) {
    return (
      <Screen>
        <ActivityIndicator style={{ marginTop: spacing.xxl }} color={colors.inkFaint} />
      </Screen>
    );
  }

  const { slug, allowance, used } = link.data;
  const left = Math.max(0, allowance - used);
  const url = inviteUrl(slug);
  const problem = describeSlugProblem(suffix);
  const unchanged = suffix.trim().toLowerCase() === slug;

  const copy = async () => {
    await Clipboard.setStringAsync(url);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const send = () =>
    Share.share({
      message: `You're invited to VINTAGE.\n\n${url}`,
    });

  const confirmRotate = () =>
    showAlert(
      "Replace this link?",
      "The address you have already given out will stop working. Anyone who has " +
        "already joined stays yours.",
      [
        { text: "Keep it", style: "cancel" },
        { text: "Replace", style: "destructive", onPress: () => rotate.mutate() },
      ],
    );

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {/* What the other person receives, shown to the person sending it. */}
        <EngravedCard style={styles.card}>
          <Text style={styles.cardEyebrow}>By invitation</Text>
          <Text style={styles.cardWordmark}>Vintage</Text>
          <View style={styles.cardRule} />
          <Text style={styles.cardLink} numberOfLines={2}>
            {inviteUrlLabel(slug)}
          </Text>
        </EngravedCard>

        <View style={styles.actions}>
          <Pressable style={styles.primary} onPress={copy}>
            <Feather name={copied ? "check" : "copy"} size={14} color={colors.onShutter} />
            <Text style={styles.primaryText}>{copied ? "Copied" : "Copy link"}</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={send}>
            <Feather name="send" size={14} color={colors.ink} />
            <Text style={styles.secondaryText}>Send</Text>
          </Pressable>
        </View>

        {/* The count, said the way it actually behaves. */}
        <Text style={styles.allowance}>
          {used} of {allowance} used
        </Text>
        <Text style={styles.allowanceNote}>
          {left > 0
            ? "An invitation is spent when someone joins, not when you send it. Share the same link with as many people as you like."
            : "Every invitation you were given has been taken up."}
        </Text>

        {!inviteLinkIsWeb() ? (
          <Text style={styles.note}>
            This link opens VINTAGE for anyone who already has it. Once the invitation
            page is live it will work for people who don't.
          </Text>
        ) : null}

        <View style={styles.rule} />

        <Text style={styles.sectionLabel}>The address</Text>
        <TextInput
          value={suffix}
          onChangeText={(t) => setSuffix(t.replace(/[^A-Za-z0-9-]/g, "").toLowerCase().slice(0, SLUG_MAX))}
          style={styles.input}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="your-name-here"
          placeholderTextColor={colors.inkFaint}
        />
        <Text style={[styles.hint, problem && styles.hintBad]}>
          {problem ??
            "8 to 64 letters, numbers or hyphens. Changing it replaces the address you have given out; everyone who already joined stays yours."}
        </Text>
        <Pressable
          style={[styles.update, (Boolean(problem) || unchanged) && styles.updateOff]}
          disabled={Boolean(problem) || unchanged || rename.isPending}
          onPress={() => rename.mutate(suffix.trim().toLowerCase())}
        >
          <Text style={styles.updateText}>Update address</Text>
        </Pressable>

        <Pressable style={styles.revoke} onPress={confirmRotate} disabled={rotate.isPending}>
          <Text style={styles.revokeText}>Replace with a new link</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  card: {
    backgroundColor: colors.card,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
  },
  cardEyebrow: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.6,
    textTransform: "uppercase",
    color: colors.goldSoft,
  },
  cardWordmark: {
    fontFamily: type.script,
    fontSize: 40,
    color: colors.gold,
    marginTop: spacing.xs,
  },
  cardRule: {
    width: 46,
    height: 1,
    backgroundColor: colors.goldSoft,
    marginVertical: spacing.md,
    opacity: 0.7,
  },
  cardLink: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 0.6,
    color: colors.goldSoft,
    textAlign: "center",
  },

  actions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  primary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    backgroundColor: colors.shutter,
    paddingVertical: 13,
    borderRadius: radii.sm,
  },
  primaryText: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.onShutter,
  },
  secondary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: 13,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  secondaryText: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.ink,
  },

  allowance: { ...type.title, fontSize: 19, marginTop: spacing.xl },
  allowanceNote: { ...type.caption, marginTop: spacing.xs, lineHeight: 19 },
  note: { ...type.caption, color: colors.inkFaint, marginTop: spacing.md, lineHeight: 18 },

  rule: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xl },

  sectionLabel: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  input: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontFamily: type.mono,
    fontSize: 14,
    color: colors.ink,
    backgroundColor: colors.paperRaised,
  },
  hint: { ...type.caption, fontSize: 12, color: colors.inkFaint, marginTop: spacing.sm, lineHeight: 17 },
  hintBad: { color: colors.danger },
  update: {
    marginTop: spacing.md,
    paddingVertical: 11,
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.ink,
  },
  updateOff: { borderColor: colors.border },
  updateText: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.ink,
  },
  revoke: { marginTop: spacing.xl, alignItems: "center" },
  revokeText: { ...type.caption, color: colors.danger },
});
