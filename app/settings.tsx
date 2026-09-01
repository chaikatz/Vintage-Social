import React, { useState } from "react";
import { Pressable, StyleSheet, Switch, Text, View } from "react-native";
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

export default function Settings() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session, profile, refreshProfile, signOut } = useSession();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [bio, setBio] = useState(profile?.bio ?? "");
  const [city, setCity] = useState(profile?.city ?? "");
  const [newAvatarUri, setNewAvatarUri] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(profile?.is_private ?? false);
  const [busy, setBusy] = useState(false);

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
        avatarPath = await uploadFile("avatars", `${userId}/avatar.jpg`, prepared.uri, "image/jpeg");
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

      <Button title="Save" onPress={save} loading={busy} />
      <View style={styles.divider} />
      <Button
        title="Sign out"
        variant="danger"
        onPress={() =>
          showAlert("Sign out?", undefined, [
            { text: "Sign out", style: "destructive", onPress: signOut },
            { text: "Cancel", style: "cancel" },
          ])
        }
      />
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
});
