import React, { useMemo, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { fetchPost } from "@/api/posts";
import { fetchFollowing } from "@/api/profiles";
import { mediaUrl } from "@/api/media";
import { sharePostWith } from "@/api/messages";
import { useSession } from "@/providers/SessionProvider";
import { MAX_MESSAGE_LENGTH } from "@/utils/validation";

/**
 * Send a photograph to someone. Members you follow, a line to go with it,
 * and it lands in their messages — nothing is posted anywhere public, and
 * there is no "share to story" or link to copy.
 */
export default function Share() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { session } = useSession();
  const userId = session?.user?.id ?? "";
  const { postId } = useLocalSearchParams<{ postId: string }>();

  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const postQ = useQuery({
    queryKey: ["post", postId],
    queryFn: () => fetchPost(postId ?? ""),
    enabled: Boolean(postId),
  });
  const peopleQ = useQuery({
    queryKey: ["following", userId],
    queryFn: () => fetchFollowing(userId),
    enabled: Boolean(userId),
  });

  const post = postQ.data;
  const thumb = useMemo(
    () => (post ? mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path) : null),
    [post],
  );

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const send = async () => {
    if (!postId || selected.length === 0) return;
    setBusy(true);
    try {
      await sharePostWith(userId, selected, postId, note);
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
      router.back();
    } catch (err) {
      showAlert("Couldn’t send", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.preview}>
        {thumb ? <Image source={thumb} style={styles.previewImage} contentFit="cover" /> : null}
        <View style={styles.previewText}>
          <Text style={styles.previewAuthor}>{post?.author.username ?? ""}</Text>
          <Text style={styles.previewCaption} numberOfLines={2}>
            {post?.caption || "A photograph"}
          </Text>
        </View>
      </View>

      <TextInput
        value={note}
        onChangeText={(t) => setNote(t.slice(0, MAX_MESSAGE_LENGTH))}
        placeholder="Add a line…"
        placeholderTextColor={colors.inkFaint}
        style={styles.note}
      />

      <FlatList
        data={peopleQ.data ?? []}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          peopleQ.isFetched ? (
            <EmptyState
              title="Nobody to send to yet"
              body="Follow a few members and you can pass photographs along to them."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const on = selected.includes(item.id);
          return (
            <Pressable style={styles.row} onPress={() => toggle(item.id)}>
              <Avatar path={item.avatar_url} username={item.username} size={40} />
              <View style={styles.rowText}>
                <Text style={styles.username}>{item.username}</Text>
                {item.full_name ? <Text style={styles.fullName}>{item.full_name}</Text> : null}
              </View>
              <View style={[styles.check, on && styles.checkOn]}>
                {on ? <Feather name="check" size={14} color={colors.onShutter} /> : null}
              </View>
            </Pressable>
          );
        }}
      />

      <Pressable
        style={[styles.sendBar, selected.length === 0 && styles.sendBarOff]}
        disabled={selected.length === 0 || busy}
        onPress={send}
      >
        <Text style={styles.sendText}>
          {selected.length === 0
            ? "Choose someone"
            : `Send to ${selected.length} ${selected.length === 1 ? "member" : "members"}`}
        </Text>
      </Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  preview: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  previewImage: {
    width: 52,
    height: 52,
    borderRadius: radii.sm,
    backgroundColor: colors.paperSunken,
  },
  previewText: { flex: 1 },
  previewAuthor: { fontSize: 14, fontWeight: "600", color: colors.ink },
  previewCaption: { ...type.caption, marginTop: 2 },
  note: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.ink,
  },
  list: { paddingTop: spacing.sm },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  rowText: { flex: 1 },
  username: { fontSize: 15, color: colors.ink },
  fullName: { ...type.caption, marginTop: 1 },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  checkOn: { backgroundColor: colors.shutter, borderColor: colors.shutter },
  sendBar: {
    margin: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.shutter,
    paddingVertical: 14,
    alignItems: "center",
  },
  sendBarOff: { backgroundColor: colors.borderStrong },
  sendText: {
    color: colors.onShutter,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.5,
  },
});
