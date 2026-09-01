import React from "react";
import { FlatList, Pressable, Share, StyleSheet, Text, View } from "react-native";
import { showAlert } from "@/utils/alert";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { Screen } from "@/components/Screen";
import { EmptyState } from "@/components/EmptyState";
import { colors, radii, spacing, type } from "@/theme";
import { createInvite, fetchMyInvites } from "@/api/membership";
import { useSession } from "@/providers/SessionProvider";

/**
 * Nominations.
 *
 * A member does not hand out a referral link; they put someone's name
 * forward, and that person is admitted on their word. The count is small
 * and it does not refill, which is the whole mechanism — so the screen
 * says plainly how many are left and whose they became.
 */
export default function Nominations() {
  const queryClient = useQueryClient();
  const { session, profile } = useSession();
  const userId = session?.user?.id ?? "";

  const invites = useQuery({
    queryKey: ["invites", userId],
    queryFn: () => fetchMyInvites(userId),
    enabled: Boolean(userId),
  });

  const mint = useMutation({
    mutationFn: createInvite,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["invites", userId] }),
    onError: (err) =>
      showAlert("No nominations left", err instanceof Error ? err.message : String(err)),
  });

  const all = invites.data ?? [];
  const accepted = all.filter((i) => i.used_by).length;
  const remaining = Math.max(0, (profile?.invite_quota ?? 0) - all.length);

  return (
    <Screen padded={false}>
      <View style={styles.header}>
        <Text style={styles.eyebrow}>Nominations</Text>
        <Text style={styles.headline}>
          {remaining} left of {profile?.invite_quota ?? 0}
        </Text>
        <Text style={styles.sub}>
          Putting someone forward admits them on your word — there is no queue and no review.
          {accepted > 0 ? ` ${accepted} of yours ${accepted === 1 ? "has" : "have"} been taken up.` : ""}
        </Text>
        <Pressable
          style={[styles.mint, remaining <= 0 && styles.mintOff]}
          onPress={() => mint.mutate()}
          disabled={remaining <= 0 || mint.isPending}
        >
          <Text style={styles.mintText}>
            {remaining <= 0 ? "None left" : "Nominate a member"}
          </Text>
        </Pressable>
      </View>

      <FlatList
        data={all}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={
          invites.isFetched ? (
            <EmptyState
              title="No nominations yet"
              body="Put someone forward and pass the code to them quietly."
            />
          ) : null
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={[styles.code, item.used_by && styles.codeUsed]}>{item.code}</Text>
            {item.used_by ? (
              <Text style={styles.acceptedLabel}>Accepted</Text>
            ) : (
              <Pressable
                hitSlop={8}
                style={styles.share}
                onPress={() =>
                  Share.share({
                    message:
                      `You have been nominated for membership of VINTAGE.\n\n` +
                      `Open the app, choose “I have a nomination”, and enter ${item.code}.`,
                  })
                }
              >
                <Feather name="send" size={14} color={colors.accent} />
                <Text style={styles.shareText}>Send</Text>
              </Pressable>
            )}
          </View>
        )}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  headline: { ...type.title, marginTop: spacing.sm },
  sub: { ...type.caption, marginTop: spacing.xs, lineHeight: 19 },
  mint: {
    marginTop: spacing.lg,
    backgroundColor: colors.shutter,
    paddingVertical: 13,
    alignItems: "center",
    borderRadius: radii.sm,
  },
  mintOff: { backgroundColor: colors.borderStrong },
  mintText: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.2,
    textTransform: "uppercase",
    color: colors.onShutter,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  code: {
    fontFamily: type.mono,
    fontSize: 16,
    letterSpacing: 2,
    color: colors.ink,
    backgroundColor: colors.paperSunken,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  codeUsed: { color: colors.inkFaint, textDecorationLine: "line-through" },
  acceptedLabel: { ...type.caption, color: colors.inkFaint },
  share: { flexDirection: "row", alignItems: "center", gap: 6 },
  shareText: { ...type.caption, color: colors.accent },
});
