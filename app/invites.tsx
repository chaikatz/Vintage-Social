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
  SLUG_MIN,
  describeSlugProblem,
  inviteLinkIsWeb,
  inviteUrl,
  inviteUrlLabel,
} from "@/utils/inviteLink";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";

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
  // Most members never change the address. The editor stays folded so the
  // screen is the card, the button and the count — nothing to read first.
  const [editing, setEditing] = useState(false);
  // Every hook lives above the loading return below. One declared after it
  // ran on some renders and not others, and React threw the moment the
  // link arrived — which is what "Invitations crashes" was.
  const [codeCopied, setCodeCopied] = useState(false);

  // The field starts as whatever the link currently is, so editing it reads
  // as changing something rather than filling something in.
  useEffect(() => {
    if (link.data?.slug) setSuffix(link.data.slug);
  }, [link.data?.slug]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["invite-link"] });
  const fail = (err: unknown) =>
    showAlert("That didn't work", err instanceof Error ? err.message : String(err));

  const rename = useMutation({
    mutationFn: setInviteSlug,
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
    onError: fail,
  });
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
  // The code is the link's ending. It is what somebody types after
  // installing the app, when the link they tapped is long gone.
  const copyCode = async () => {
    await Clipboard.setStringAsync(slug);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCodeCopied(true);
    setTimeout(() => setCodeCopied(false), 2000);
  };

  // The share sheet is the invitation. The words carry the code as well as
  // the link, because a link does not survive installing an app: the
  // recipient taps it, is sent to install, and arrives with nothing — the
  // code is what they type then. The link goes last so a preview card,
  // where the recipient's phone draws one, sits under the words.
  const send = () =>
    Share.share({
      message:
        `You're invited to VINTAGE — a members' club for photographs.\n\n` +
        `Your invitation code is ${slug}. Install VINTAGE, choose "I have an invitation" and enter it — or open:\n${url}`,
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
        <EngravedCard style={styles.card} tone="paper">
          <Text style={styles.cardEyebrow}>By invitation</Text>
          <Text style={styles.cardWordmark}>VINTAGE</Text>
          <View style={styles.cardRule} />
          <Text style={styles.cardLink} numberOfLines={2}>
            {inviteUrlLabel(slug)}
          </Text>
        </EngravedCard>

        <View style={styles.actions}>
          <Pressable style={styles.primary} onPress={send}>
            <Feather name="send" size={14} color={colors.onShutter} />
            <Text style={styles.primaryText}>Send invitation</Text>
          </Pressable>
          <Pressable style={styles.secondary} onPress={copy} accessibilityLabel="Copy link">
            <Feather name={copied ? "check" : "copy"} size={14} color={colors.ink} />
            <Text style={styles.secondaryText}>{copied ? "Copied" : "Copy"}</Text>
          </Pressable>
        </View>

        {/* The code on its own, for the person who has to type it. */}
        <Pressable style={styles.codeRow} onPress={copyCode} accessibilityLabel="Copy invitation code">
          <View style={styles.grow}>
            <Text style={styles.codeLabel}>Invitation code</Text>
            <Text style={styles.code}>{slug}</Text>
          </View>
          <Text style={styles.codeCopy}>{codeCopied ? "Copied" : "Copy code"}</Text>
        </Pressable>

        {/* The count, said the way it actually behaves. */}
        <View style={styles.allowanceRow}>
          <Text style={styles.allowance}>{left}</Text>
          <Text style={styles.allowanceOf}>
            {left === 1 ? "invitation" : "invitations"} left · {used} of {allowance} taken up
          </Text>
        </View>
        <Text style={styles.allowanceNote}>
          {left > 0
            ? "One is spent when someone joins through your link, not when you send it. Share the same link with as many people as you like."
            : "Every invitation you were given has been taken up. Your link still opens VINTAGE, but no one else can join through it."}
        </Text>

        {!inviteLinkIsWeb() ? (
          <Text style={styles.note}>
            This link opens VINTAGE for anyone who already has it. Once the invitation
            page is live it will work for people who don't.
          </Text>
        ) : null}

        <View style={styles.rule} />

        {editing ? (
          <>
            <Text style={styles.sectionLabel}>The address</Text>
            <TextInput
              inputAccessoryViewID={KEYBOARD_DONE}
              value={suffix}
              onChangeText={(t) => setSuffix(t.replace(/[^A-Za-z0-9-]/g, "").toLowerCase().slice(0, SLUG_MAX))}
              style={styles.input}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              placeholder="your-name-here"
              placeholderTextColor={colors.inkFaint}
            />
            <Text style={[styles.hint, problem && styles.hintBad]}>
              {problem ??
                `${SLUG_MIN} to ${SLUG_MAX} letters, numbers or hyphens. Changing it replaces the address you have given out; everyone who already joined stays yours.`}
            </Text>
            <View style={styles.editorActions}>
              <Pressable
                style={[styles.update, (Boolean(problem) || unchanged) && styles.updateOff]}
                disabled={Boolean(problem) || unchanged || rename.isPending}
                onPress={() => rename.mutate(suffix.trim().toLowerCase())}
              >
                <Text style={styles.updateText}>Update address</Text>
              </Pressable>
              <Pressable
                style={styles.cancel}
                onPress={() => {
                  setSuffix(slug);
                  setEditing(false);
                }}
              >
                <Text style={styles.cancelText}>Keep it</Text>
              </Pressable>
            </View>
          </>
        ) : (
          <Pressable style={styles.fold} onPress={() => setEditing(true)}>
            <View style={styles.foldText}>
              <Text style={styles.foldTitle}>Change the address</Text>
              <Text style={styles.foldBody}>{inviteUrlLabel(slug)}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.inkFaint} />
          </Pressable>
        )}

        <Pressable style={styles.revoke} onPress={confirmRotate} disabled={rotate.isPending}>
          <Text style={styles.revokeText}>Replace with a new link</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },

  // The card a member hands over, printed like the door: cream, ink, the
  // wordmark tracked wide inside the engraved frame.
  card: {
    backgroundColor: colors.paperRaised,
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    alignItems: "center",
  },
  cardEyebrow: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 2.6,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  cardWordmark: {
    fontFamily: type.serif,
    fontSize: 30,
    lineHeight: 40,
    letterSpacing: 8,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  cardRule: {
    width: 24,
    height: 1,
    backgroundColor: colors.ink,
    marginVertical: spacing.md,
    opacity: 0.85,
  },
  cardLink: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: colors.inkSoft,
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

  grow: { flex: 1 },
  codeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  codeLabel: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  code: { fontFamily: type.mono, fontSize: 18, letterSpacing: 1.5, color: colors.ink, marginTop: 4 },
  codeCopy: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.accent,
  },
  allowanceRow: { flexDirection: "row", alignItems: "baseline", gap: spacing.sm, marginTop: spacing.xl },
  allowance: { ...type.title, fontSize: 28 },
  allowanceOf: { ...type.caption, color: colors.inkSoft },
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
    flex: 1,
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
  editorActions: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
  cancel: { paddingVertical: 11 },
  cancelText: { ...type.caption, color: colors.inkSoft },
  fold: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  foldText: { flex: 1 },
  foldTitle: { fontSize: 14, fontWeight: "600", color: colors.ink },
  foldBody: { fontFamily: type.mono, fontSize: 11, color: colors.inkFaint, marginTop: 2 },
  revoke: { marginTop: spacing.xl, alignItems: "center" },
  revokeText: { ...type.caption, color: colors.danger },
});
