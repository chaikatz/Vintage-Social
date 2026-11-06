import React, { useMemo, useState } from "react";
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { fetchFollowPage, searchProfiles, type FollowCursor } from "@/api/profiles";
import { useNameFace } from "@/utils/nameFace";
import { Avatar } from "./Avatar";
import { memberLabel } from "./memberLabel";
import { LoadFailed } from "./LoadFailed";
import type { ProfileRow } from "@/types/db";
import { KEYBOARD_DONE } from "@/components/KeyboardDone";

export type Taggable = Pick<ProfileRow, "id" | "username" | "full_name" | "avatar_url">;

interface Props {
  visible: boolean;
  /** The member doing the tagging — never offered to themselves. */
  myId: string;
  selected: Taggable[];
  onChange: (next: Taggable[]) => void;
  onClose: () => void;
}

/** How many people one photograph can name. */
export const MAX_TAGS = 10;

/**
 * Naming who was there.
 *
 * A sheet over the darkroom: the people you follow first, because they
 * are who you were with; type to find anyone else. Tap to add, tap again
 * to take back. Nothing is sent from here — the tags go out with the
 * post, and each person named decides whether the picture appears on
 * their own profile.
 */
export function TagPicker({ visible, myId, selected, onChange, onClose }: Props) {
  const [q, setQ] = useState("");
  const searching = q.trim().length >= 2;
  // Editorial (Preview): every username in the sheet, half bold.
  const face = useNameFace();

  // Fifty at a time as the sheet is scrolled; anyone further is a search away.
  const following = useInfiniteQuery({
    queryKey: ["following-list", myId, "pages"],
    queryFn: ({ pageParam }) => fetchFollowPage("following", myId, pageParam),
    initialPageParam: null as FollowCursor | null,
    getNextPageParam: (last) => last.next,
    enabled: visible && Boolean(myId),
    staleTime: 5 * 60_000,
  });
  const results = useQuery({
    queryKey: ["search", q],
    queryFn: () => searchProfiles(q),
    enabled: visible && searching,
  });

  const rows: Taggable[] = useMemo(() => {
    const source = searching ? results.data ?? [] : (following.data?.pages ?? []).flatMap((p) => p.members);
    return source.filter((p) => p.id !== myId);
  }, [searching, results.data, following.data, myId]);

  const chosen = new Set(selected.map((p) => p.id));
  const toggle = (p: Taggable) => {
    if (chosen.has(p.id)) onChange(selected.filter((s) => s.id !== p.id));
    else if (selected.length < MAX_TAGS) onChange([...selected, p]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={styles.head}>
          <Text style={styles.title}>Who was there</Text>
          <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Done">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.searchWrap}>
          <Feather name="search" size={15} color={colors.inkFaint} />
          <TextInput
            inputAccessoryViewID={KEYBOARD_DONE}
            value={q}
            onChangeText={setQ}
            placeholder="Search members"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        {selected.length > 0 ? (
          <View style={styles.chips}>
            {selected.map((p) => (
              <Pressable key={p.id} style={styles.chip} onPress={() => toggle(p)}>
                <Text style={[styles.chipText, face]}>{p.username}</Text>
                <Feather name="x" size={12} color={colors.inkSoft} />
              </Pressable>
            ))}
          </View>
        ) : null}

        <Text style={styles.label}>{searching ? "Members" : "People you follow"}</Text>
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          onEndReached={() => {
            if (!searching && following.hasNextPage && !following.isFetchingNextPage && !following.isFetchNextPageError) {
              following.fetchNextPage();
            }
          }}
          onEndReachedThreshold={1}
          ListFooterComponent={
            !searching && following.isFetchNextPageError ? (
              <LoadFailed what="the rest" onRetry={() => following.fetchNextPage()} />
            ) : null
          }
          ListEmptyComponent={
            // A read that failed is no answer: "Nobody by that name" would not be true.
            searching && results.isError ? (
              <LoadFailed what="the search" onRetry={() => results.refetch()} />
            ) : !searching && following.isError ? (
              <LoadFailed what="who you follow" onRetry={() => following.refetch()} />
            ) : (
              <Text style={styles.empty}>
                {searching
                  ? results.isFetched
                    ? "Nobody by that name."
                    : ""
                  : following.isFetched
                    ? "Follow a few members and they will be listed here."
                    : ""}
              </Text>
            )
          }
          renderItem={({ item }) => {
            const on = chosen.has(item.id);
            return (
              <Pressable
                style={styles.row}
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: !on && selected.length >= MAX_TAGS }}
                accessibilityLabel={memberLabel(item.username, item.full_name)}
              >
                <Avatar path={item.avatar_url} username={item.username} size={36} />
                <View style={styles.rowText}>
                  <Text style={[styles.username, face]}>{item.username}</Text>
                  {item.full_name ? <Text style={styles.fullName}>{item.full_name}</Text> : null}
                </View>
                <View style={[styles.mark, on && styles.markOn]}>
                  {on ? <Feather name="check" size={12} color={colors.paperRaised} /> : null}
                </View>
              </Pressable>
            );
          }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  title: { fontFamily: type.serif, fontSize: 18, color: colors.ink },
  done: { fontSize: 15, fontWeight: "600", color: colors.accent },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginVertical: spacing.sm,
    backgroundColor: colors.paperRaised,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 3,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, paddingVertical: 9, fontSize: 15, color: colors.ink },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.paperRaised,
  },
  chipText: { fontSize: 12, color: colors.ink },
  label: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: colors.inkFaint,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  empty: { ...type.caption, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm + 2, gap: spacing.md },
  rowText: { flex: 1 },
  username: { fontSize: 14, fontWeight: "600", color: colors.ink },
  fullName: { fontSize: 12, color: colors.inkSoft, marginTop: 1 },
  mark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  markOn: { backgroundColor: colors.ink, borderColor: colors.ink },
});
