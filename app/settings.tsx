import React, { useState } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { TextField } from "@/components/TextField";
import { Button } from "@/components/Button";
import { colors, radii, spacing, type } from "@/theme";
import { fetchPendingRequests, updateOwnProfile } from "@/api/profiles";
import { mediaUrl, prepareAvatar, uploadFile } from "@/api/media";
import { isDemoMode } from "@/lib/env";
import { useSession } from "@/providers/SessionProvider";
import { MAX_BIO_LENGTH } from "@/utils/validation";
import { loadAppearance, setAppearance, type AppearanceChoice } from "@/utils/appearance";
import {
  DEFAULT_PREFS,
  fetchNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefs,
} from "@/api/notifications";
import { pushSupported, registerForPush } from "@/utils/push";
import { deleteMyAccount } from "@/api/account";
import { PRIVACY_URL, SUPPORT_EMAIL, TERMS_URL, supportMailto } from "@/config/launch";

export default function Settings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, profile, refreshProfile, signOut } = useSession();
  const [deleting, setDeleting] = useState(false);

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [newAvatarUri, setNewAvatarUri] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const [busy, setBusy] = useState(false);
  // Light print, dark print, or the phone's choice. Takes effect at once.
  const [appearance, setAppearanceChoice] = useState<AppearanceChoice>(loadAppearance);
  const chooseAppearance = (choice: AppearanceChoice) => {
    setAppearanceChoice(choice);
    setAppearance(choice);
  };

  // What the phone is allowed to say. Read once; each switch writes at once.
  const userId = session?.user?.id ?? "";
  const prefsQuery = useQuery({
    queryKey: ["notification-prefs", userId],
    queryFn: () => fetchNotificationPrefs(userId),
    enabled: Boolean(userId),
  });
  const [prefsEdit, setPrefsEdit] = useState<NotificationPrefs | null>(null);
  const prefs = prefsEdit ?? prefsQuery.data ?? DEFAULT_PREFS;
  const togglePref = (key: keyof NotificationPrefs) => (on: boolean) => {
    const next = { ...prefs, [key]: on };
    setPrefsEdit(next);
    if (!userId) return;
    updateNotificationPrefs(userId, next)
      .then(() => {
        queryClient.setQueryData(["notification-prefs", userId], next);
        // Turning something on is also a reason to make sure the phone is registered.
        if (on && pushSupported()) registerForPush(userId);
      })
      .catch((err) => showAlert("Couldn’t save", err instanceof Error ? err.message : String(err)));
  };

  const requests = useQuery({
    queryKey: ["follow-requests", session?.user?.id ?? ""],
    queryFn: () => fetchPendingRequests(session?.user?.id ?? ""),
    enabled: Boolean(session?.user?.id) && isPrivate,
  });
  const pending = requests.data?.length ?? 0;

  const currentAvatar = newAvatarUri ?? mediaUrl("avatars", profile?.avatar_url ?? null);

  const pickAvatar = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.9,
    });
    if (!result.canceled && result.assets[0]) setNewAvatarUri(result.assets[0].uri);
  };

  const save = async () => {
    const userId = session?.user?.id;
    if (!userId) return;
    setBusy(true);
    try {
      let avatarPath: string | undefined;
      if (newAvatarUri && isDemoMode()) {
        avatarPath = newAvatarUri; // demo mode: keep the local uri, no upload
      } else if (newAvatarUri) {
        const prepared = await prepareAvatar(newAvatarUri);
        avatarPath = await uploadFile("avatars", `${userId}/avatar.jpg`, prepared.uri, "image/jpeg", {
          upsert: true,
        });
      }
      await updateOwnProfile(userId, {
        full_name: fullName.trim(),
        bio: bio.trim(),
        city: city.trim(),
        is_private: isPrivate,
        ...(avatarPath ? { avatar_url: avatarPath } : {}),
      });
      await refreshProfile();
      queryClient.invalidateQueries();
      router.back();
    } catch (err) {
      showAlert("Couldn’t save", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // The documents open on the web when a copy is hosted, and in the app
  // otherwise, so they are always one tap away.
  const openDoc = (doc: "privacy" | "terms", url: string | null) => {
    if (url) Linking.openURL(url).catch(() => router.push(`/legal/${doc}`));
    else router.push(`/legal/${doc}`);
  };

  // Two questions, then it is done. The words say what goes, because it
  // all goes.
  const confirmDelete = () =>
    showAlert(
      "Delete your account?",
      "Your profile, photographs, comments, likes, follows, tags and messages are removed for good. Your membership number is never reissued. This cannot be undone.",
      [
        {
          text: "Delete account",
          style: "destructive",
          onPress: () =>
            showAlert("Are you sure?", "This is the last step. Everything is deleted now.", [
              {
                text: "Yes, delete everything",
                style: "destructive",
                onPress: async () => {
                  const userId = session?.user?.id;
                  if (!userId) return;
                  setDeleting(true);
                  try {
                    await deleteMyAccount(userId);
                    queryClient.clear();
                    await signOut();
                  } catch (err) {
                    setDeleting(false);
                    showAlert("Couldn’t delete the account", err instanceof Error ? err.message : String(err));
                  }
                },
              },
              { text: "Keep my account", style: "cancel" },
            ]),
        },
        { text: "Cancel", style: "cancel" },
      ],
    );

  return (
    <Screen scroll>
      <Pressable style={styles.avatarPicker} onPress={pickAvatar}>
        {currentAvatar ? (
          <Image source={currentAvatar} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarEmpty]} />
        )}
        <Text style={styles.avatarLabel}>Change photograph</Text>
      </Pressable>

      <TextField label="Name" value={fullName} onChangeText={setFullName} />
      <TextField
        label="Bio"
        value={bio}
        onChangeText={(t) => setBio(t.slice(0, MAX_BIO_LENGTH))}
        multiline
        hint={`${bio.length}/${MAX_BIO_LENGTH}`}
      />
      <TextField label="City" value={city} onChangeText={setCity} />

      <View style={styles.divider} />

      <View style={styles.settingRow}>
        <View style={styles.settingText}>
          <Text style={styles.settingLabel}>Private account</Text>
          <Text style={styles.settingHint}>
            New followers become requests you approve by hand, and only the members you have let in
            can see your photographs.
          </Text>
        </View>
        <Switch
          value={isPrivate}
          onValueChange={setIsPrivate}
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
          thumbColor={colors.paperRaised}
        />
      </View>

      {isPrivate ? (
        <Pressable style={styles.requestsRow} onPress={() => router.push("/requests")}>
          <Text style={styles.requestsLabel}>
            {pending > 0
              ? `${pending} ${pending === 1 ? "request" : "requests"} waiting`
              : "Follow requests"}
          </Text>
          <Feather name="chevron-right" size={16} color={colors.inkFaint} />
        </Pressable>
      ) : null}

      <View style={styles.divider} />

      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>Notifications</Text>
        <Text style={styles.settingHint}>
          A name and what happened, nothing more. Likes arrive at most once every half hour; a
          memory at most once a day.
        </Text>
      </View>
      {(
        [
          ["likes", "Likes", "Someone liked your photograph."],
          ["comments", "Comments", "Someone wrote under your photograph."],
          ["follows", "Follows", "A new follower, or a request to follow you."],
          ["tags", "Tags", "Someone put you in a photograph."],
          ["messages", "Messages", "A letter in the tray."],
          ["posts", "New photographs", "Someone you follow posted."],
          ["memories", "On this day", "One of your own, from this day in another year."],
        ] as [keyof NotificationPrefs, string, string][]
      ).map(([key, label, hint]) => (
        <View key={key} style={styles.prefRow}>
          <View style={styles.settingText}>
            <Text style={styles.prefLabel}>{label}</Text>
            <Text style={styles.prefHint}>{hint}</Text>
          </View>
          <Switch
            value={prefs[key]}
            onValueChange={togglePref(key)}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
            thumbColor={colors.paperRaised}
          />
        </View>
      ))}

      <View style={styles.divider} />

      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>Appearance</Text>
        <Text style={styles.settingHint}>The same page, printed light or on darkroom brown.</Text>
      </View>
      <View style={styles.choices} accessibilityRole="radiogroup">
        {(
          [
            ["system", "Automatic"],
            ["light", "Light"],
            ["dark", "Dark"],
          ] as [AppearanceChoice, string][]
        ).map(([value, label]) => {
          const on = appearance === value;
          return (
            <Pressable
              key={value}
              style={[styles.choice, on && styles.choiceOn]}
              onPress={() => chooseAppearance(value)}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.choiceText, on && styles.choiceTextOn]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />

      <Button title="Save" onPress={save} loading={busy} />

      <View style={styles.divider} />

      <Pressable style={styles.linkRow} onPress={() => router.push("/blocked")} accessibilityRole="button">
        <Text style={styles.linkLabel}>Blocked members</Text>
        <Feather name="chevron-right" size={16} color={colors.inkFaint} />
      </Pressable>
      <Pressable style={styles.linkRow} onPress={() => openDoc("privacy", PRIVACY_URL)} accessibilityRole="link">
        <Text style={styles.linkLabel}>Privacy Policy</Text>
        <Feather name="chevron-right" size={16} color={colors.inkFaint} />
      </Pressable>
      <Pressable style={styles.linkRow} onPress={() => openDoc("terms", TERMS_URL)} accessibilityRole="link">
        <Text style={styles.linkLabel}>Terms of Use</Text>
        <Feather name="chevron-right" size={16} color={colors.inkFaint} />
      </Pressable>
      {SUPPORT_EMAIL ? (
        <Pressable
          style={styles.linkRow}
          onPress={() => Linking.openURL(supportMailto("VINTAGE support") ?? "")}
          accessibilityRole="link"
        >
          <View>
            <Text style={styles.linkLabel}>Support</Text>
            <Text style={styles.linkHint}>{SUPPORT_EMAIL}</Text>
          </View>
          <Feather name="mail" size={16} color={colors.inkFaint} />
        </Pressable>
      ) : null}

      <View style={styles.divider} />

      <Button
        title="Sign out"
        variant="secondary"
        onPress={() =>
          showAlert("Sign out?", undefined, [
            { text: "Sign out", style: "destructive", onPress: signOut },
            { text: "Cancel", style: "cancel" },
          ])
        }
      />
      <View style={styles.deleteWrap}>
        <Button title="Delete account" variant="danger" onPress={confirmDelete} loading={deleting} />
        <Text style={styles.deleteHint}>
          Removes your profile and everything you have posted. Cannot be undone.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  avatarPicker: { alignItems: "center", marginVertical: spacing.xl },
  avatar: { width: 88, height: 88, borderRadius: radii.round, backgroundColor: colors.paperSunken },
  avatarEmpty: { borderWidth: 1, borderColor: colors.borderStrong, borderStyle: "dashed" },
  avatarLabel: { ...type.label, marginTop: spacing.sm, color: colors.accent },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.xl },
  settingRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.lg },
  settingText: { flex: 1 },
  settingLabel: { fontSize: 15, color: colors.ink },
  settingHint: { ...type.caption, marginTop: 3, lineHeight: 18 },
  requestsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
  requestsLabel: { fontSize: 15, color: colors.accent },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  linkLabel: { fontSize: 15, color: colors.ink },
  linkHint: { ...type.caption, fontSize: 12, marginTop: 2 },
  deleteWrap: { marginTop: spacing.lg },
  deleteHint: { ...type.caption, fontSize: 12, textAlign: "center", marginTop: spacing.sm },
  prefRow: { flexDirection: "row", alignItems: "center", gap: spacing.lg, marginTop: spacing.md },
  prefLabel: { fontSize: 14, color: colors.ink },
  prefHint: { ...type.caption, fontSize: 12, marginTop: 1 },
  choices: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  choice: {
    flex: 1,
    paddingVertical: 9,
    alignItems: "center",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
  },
  choiceOn: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  choiceText: { fontSize: 13, fontWeight: "600", color: colors.ink },
  choiceTextOn: { color: colors.onShutter },
});
