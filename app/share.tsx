import React, { useMemo, useRef, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { Screen } from "@/components/Screen";
import { Avatar } from "@/components/Avatar";
import { EmptyState } from "@/components/EmptyState";
import { LoadFailed } from "@/components/LoadFailed";
import { memberLabel } from "@/components/memberLabel";
import { colors, radii, spacing, type } from "@/theme";
import { fetchPost } from "@/api/posts";
import { fetchFollowPage, type FollowCursor } from "@/api/profiles";
import { mediaUrl } from "@/api/media";
import { sharePostWith } from "@/api/messages";
import { useSession } from "@/providers/SessionProvider";
import { MAX_MESSAGE_LENGTH } from "@/utils/validation";
import { useNameFace } from "@/utils/nameFace";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";

// A sheet has no back button: its recover page carries one (src/navigation/Recover.tsx).
export { RecoverPageWithBack as ErrorBoundary } from "@/navigation/Recover";

/**
 * Send a photograph to someone. Members you follow, a line to go with it,
 * and it lands in their messages — nothing is posted anywhere public by
 * us. The one way out is at the top: the photograph as a print, signed,
 * handed to the phone's share sheet for the member to place wherever they
 * like.
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
  // Editorial (Preview): every username in the sheet, half bold.
  const face = useNameFace();

  const postQ = useQuery({
    queryKey: ["post", postId],
    queryFn: () => fetchPost(postId ?? ""),
    enabled: Boolean(postId),
  });
  // Who the member follows, fifty at a time as the list is scrolled: every
  // one of them reachable, however many, none cut off at a thousand.
  const peopleQ = useInfiniteQuery({
    queryKey: ["following", userId, "pages"],
    queryFn: ({ pageParam }) => fetchFollowPage("following", userId, pageParam),
    initialPageParam: null as FollowCursor | null,
    getNextPageParam: (last) => last.next,
    enabled: Boolean(userId),
  });
  const people = useMemo(() => (peopleQ.data?.pages ?? []).flatMap((p) => p.members), [peopleQ.data]);

  const post = postQ.data;
  const thumb = useMemo(
    () => (post ? mediaUrl("thumbnails", post.thumb_path) ?? mediaUrl("media", post.media_path) : null),
    [post],
  );

  // Checked and set in the tap itself: the bar only goes quiet once React
  // has rendered, and a second tap in that moment sent every letter twice.
  const sending = useRef(false);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  const send = async () => {
    if (!postId || selected.length === 0 || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      // One at a time, each taken off the list as it lands, so a failure
      // on the third leaves the first two sent and the retry reaches only
      // the one who has not had it.
      for (const peerId of [...selected]) {
        await sharePostWith(userId, [peerId], postId, note);
        setSelected((s) => s.filter((x) => x !== peerId));
      }
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
      router.back();
    } catch (err) {
      queryClient.invalidateQueries({ queryKey: ["conversations", userId] });
      // Why, when the error says it in words fit to show; then what is true either way.
      const why = errorMessage(err, "");
      showAlert(
        "Couldn’t send to everyone",
        [why, "The members still ticked have not had it; send again to reach them."].filter(Boolean).join("\n\n"),
      );
    } finally {
      sending.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <View style={styles.preview}>
        {thumb ? <Image source={thumb} style={styles.previewImage} contentFit="cover" /> : null}
        <View style={styles.previewText}>
          {/* A post whose member is kept back comes naming nobody (src/components/hiddenAuthors.ts). */}
          <Text style={[styles.previewAuthor, face]}>{post?.author?.username ?? ""}</Text>
          <Text style={styles.previewCaption} numberOfLines={2}>
            {post?.caption || "A photograph"}
          </Text>
        </View>
      </View>

      <Pressable
        style={styles.exportRow}
        onPress={() => router.push({ pathname: "/export", params: { postId: postId ?? "" } })}
        accessibilityRole="button"
        accessibilityLabel="Share outside VINTAGE"
      >
        <View style={styles.exportIcon}>
          <Feather name="external-link" size={16} color={colors.ink} />
        </View>
        <View style={styles.rowText}>
          <Text style={styles.exportTitle}>Share outside VINTAGE</Text>
          <Text style={styles.exportHint}>As a signed print — Instagram, WhatsApp, anywhere.</Text>
        </View>
        <Feather name="chevron-right" size={16} color={colors.inkFaint} />
      </Pressable>

      <Text style={styles.sectionLabel}>To a member</Text>

      <TextInput

        inputAccessoryViewID={KEYBOARD_DONE}
        value={note}
        onChangeText={(t) => setNote(t.slice(0, MAX_MESSAGE_LENGTH))}
        placeholder="Add a line…"
        placeholderTextColor={colors.inkFaint}
        style={styles.note}
      />

      <FlatList
        data={people}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        onEndReached={() => {
          if (peopleQ.hasNextPage && !peopleQ.isFetchingNextPage && !peopleQ.isFetchNextPageError) peopleQ.fetchNextPage();
        }}
        onEndReachedThreshold={1}
        ListFooterComponent={
          peopleQ.isFetchNextPageError ? <LoadFailed what="the rest" onRetry={() => peopleQ.fetchNextPage()} /> : null
        }
        ListEmptyComponent={
          peopleQ.isError ? (
            <LoadFailed what="who you follow" onRetry={() => peopleQ.refetch()} />
          ) : peopleQ.isFetched ? (
            <EmptyState
              title="Nobody to send to yet"
              body="Follow a few members and you can pass photographs along to them."
            />
          ) : null
        }
        renderItem={({ item }) => {
          const on = selected.includes(item.id);
          return (
            <Pressable
              style={styles.row}
              onPress={() => toggle(item.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              accessibilityLabel={memberLabel(item.username, item.full_name)}
            >
              <Avatar path={item.avatar_url} username={item.username} size={40} />
              <View style={styles.rowText}>
                <Text style={[styles.username, face]}>{item.username}</Text>
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
        accessibilityRole="button"
        accessibilityState={{ disabled: selected.length === 0 || busy, busy }}
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
  exportRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
  },
  exportIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.paperSunken,
  },
  exportTitle: { fontSize: 15, color: colors.ink },
  exportHint: { ...type.caption, marginTop: 2 },
  sectionLabel: { ...type.label, marginHorizontal: spacing.lg, marginTop: spacing.xl },
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
