import React, { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Switch, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
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
import { supabase } from "@/lib/supabase";
import { useSession } from "@/providers/SessionProvider";
import { darkroomAvailable } from "@/darkroom/source";
import { forgetDarkroomHistory } from "@/darkroom/forget";
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
import { createSettingWriter } from "@/components/settingWriter";

/**
 * Whether the club has an admin besides this one. The database refuses to
 * delete the only admin's account, but only after the app has already
 * removed every one of that member's files (deleteMyAccount removes the
 * files first), so the only admin who tapped Delete kept the account and
 * lost every photograph in it. Asked before anything is removed.
 */
async function anotherAdminExists(myId: string): Promise<boolean> {
  if (isDemoMode()) return true;
  const { count, error } = await supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .neq("id", myId);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export default function Settings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, profile, isAdmin, refreshProfile, signOut } = useSession();
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
  // One write at a time and the newest last (settingWriter); a refusal puts
  // the switches back as the server has them.
  const userIdRef = useRef(userId);
  userIdRef.current = userId;
  const refreshRef = useRef(refreshProfile);
  refreshRef.current = refreshProfile;
  const prefsQuery = useQuery({
    queryKey: ["notification-prefs", userId],
    queryFn: () => fetchNotificationPrefs(userId),
    enabled: Boolean(userId),
  });
  const [prefsEdit, setPrefsEdit] = useState<NotificationPrefs | null>(null);
  const prefs = prefsEdit ?? prefsQuery.data ?? DEFAULT_PREFS;
  // Turning something on is also a reason to make sure the phone is registered.
  const registerAfterSave = useRef(false);
  const [prefsWriter] = useState(() =>
    createSettingWriter<NotificationPrefs>({
      write: async (next) => {
        await updateNotificationPrefs(userIdRef.current, next);
        queryClient.setQueryData(["notification-prefs", userIdRef.current], next);
      },
      onSaved: () => {
        if (registerAfterSave.current && pushSupported()) registerForPush(userIdRef.current);
        registerAfterSave.current = false;
      },
      onFailed: (err) => {
        registerAfterSave.current = false;
        setPrefsEdit(null);
        showAlert("Couldn’t save", errorMessage(err, "Try again in a moment."));
      },
    }),
  );
  // Each flip writes the whole row, so nothing is written until the row
  // has been read: switches drawn from the defaults while the read was on
  // its way, or after it failed, wrote every other one back on, undoing
  // what the member had turned off.
  const prefsKnown = prefsQuery.data != null;
  const togglePref = (key: keyof NotificationPrefs) => (on: boolean) => {
    if (!userId || !prefsKnown) return;
    const next = { ...prefs, [key]: on };
    setPrefsEdit(next);
    if (on) registerAfterSave.current = true;
    prefsWriter.set(next);
  };

  // A private account is private the moment the switch says so, as the
  // notification switches below it are: it used to wait for Save, and a
  // member who flipped it and went back was public with the switch on.
  const savedPrivate = useRef(profile?.is_private ?? false);
  const [privacyWriter] = useState(() =>
    createSettingWriter<boolean>({
      write: async (on) => {
        await updateOwnProfile(userIdRef.current, { is_private: on });
        savedPrivate.current = on;
      },
      onSaved: () => {
        refreshRef.current().catch(() => undefined);
      },
      onFailed: (err) => {
        setIsPrivate(savedPrivate.current);
        showAlert("Couldn’t change your account", errorMessage(err, "It is as it was. Try again in a moment."));
      },
    }),
  );
  const togglePrivate = (on: boolean) => {
    if (!userId) return;
    setIsPrivate(on);
    privacyWriter.set(on);
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
        // A new key for every portrait. The old one was overwritten in place
        // under a fixed name, and every cache between the bucket and the
        // screen — the CDN's, the image library's — went on serving the old
        // face for as long as it liked. A new address is new everywhere at
        // once; the previous file is cleared away afterwards, best-effort.
        avatarPath = await uploadFile("avatars", `${userId}/avatar-${Date.now()}.jpg`, prepared.uri, "image/jpeg");
        const previous = profile?.avatar_url;
        if (previous && previous.startsWith(`${userId}/`) && previous !== avatarPath) {
          supabase.storage.from("avatars").remove([previous]).catch(() => undefined);
        }
      }
      await updateOwnProfile(userId, {
        full_name: fullName.trim(),
        bio: bio.trim(),
        city: city.trim(),
        ...(avatarPath ? { avatar_url: avatarPath } : {}),
      });
      await refreshProfile();
      queryClient.invalidateQueries();
      router.back();
    } catch (err) {
      showAlert("Couldn’t save", errorMessage(err, "Your changes aren’t saved yet. Try again in a moment."));
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
                    if (isAdmin && !(await anotherAdminExists(userId))) {
                      setDeleting(false);
                      showAlert(
                        "You are the only admin",
                        "Make another member an admin before deleting this account, or the club has no one to let anyone in. Nothing has been deleted.",
                      );
                      return;
                    }
                    await deleteMyAccount(userId);
                    queryClient.clear();
                    await signOut();
                  } catch (err) {
                    setDeleting(false);
                    showAlert(
                      "Couldn’t delete the account",
                      errorMessage(err, "Your account is still here. Try again in a moment."),
                    );
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
          onValueChange={togglePrivate}
          accessibilityLabel="Private account"
          trackColor={{ true: colors.accent, false: colors.borderStrong }}
          thumbColor={isPrivate ? colors.paperRaised : colors.knob}
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
        {prefsQuery.isError && !prefsKnown ? (
          <Pressable onPress={() => prefsQuery.refetch()} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.prefsFailed}>Couldn’t load these. Tap to try again.</Text>
          </Pressable>
        ) : null}
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
            disabled={!prefsKnown}
            accessibilityLabel={`${label} notifications`}
            trackColor={{ true: colors.accent, false: colors.borderStrong }}
            thumbColor={prefs[key] ? colors.paperRaised : colors.knob}
          />
        </View>
      ))}

      <View style={styles.divider} />

      <View style={styles.settingText}>
        <Text style={styles.settingLabel}>Appearance</Text>
        <Text style={styles.settingHint}>The same page, printed light or on black.</Text>
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
      {darkroomAvailable() ? (
        <Pressable
          style={styles.linkRow}
          onPress={() =>
            showAlert(
              "Forget what the Memory Room has shown you?",
              "It keeps a short list, on this phone, of the photographs it has shown you and the ones you posted, so it doesn’t repeat itself. Nothing on it ever leaves your phone. Photographs you set aside stay set aside.",
              [
                { text: "Forget", style: "destructive", onPress: () => forgetDarkroomHistory() },
                { text: "Cancel", style: "cancel" },
              ],
            )
          }
          accessibilityRole="button"
          accessibilityHint="Clears the Memory Room’s list of photographs it has shown you, on this phone."
        >
          <Text style={styles.linkLabel}>Forget what the Memory Room has shown me</Text>
          <Feather name="chevron-right" size={16} color={colors.inkFaint} />
        </Pressable>
      ) : null}
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
          onPress={() =>
            Linking.openURL(supportMailto("VINTAGE support") ?? "").catch(() =>
              showAlert("Write to us", `No mail account is set up on this phone. Our address is ${SUPPORT_EMAIL}.`),
            )
          }
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
  prefsFailed: { ...type.caption, fontSize: 12, marginTop: spacing.sm, color: colors.danger },
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
