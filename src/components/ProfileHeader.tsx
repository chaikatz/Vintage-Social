import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";
import { membershipLine } from "@/utils/membership";
import { Avatar } from "./Avatar";
import type { ProfileRow } from "@/types/db";

interface Props {
  profile: ProfileRow;
  /** Follow / Edit profile button area. */
  action?: React.ReactElement;
  /** Opens the list behind a count. Absent where the lists are not yours to see. */
  onPressStat?: (kind: "followers" | "following") => void;
}

export function ProfileHeader({ profile, action, onPressStat }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Avatar path={profile.avatar_url} username={profile.username} size={80} />
        <View style={styles.stats}>
          <Stat label="posts" value={profile.post_count} />
          <Stat
            label="followers"
            value={profile.follower_count}
            onPress={onPressStat ? () => onPressStat("followers") : undefined}
          />
          <Stat
            label="following"
            value={profile.following_count}
            onPress={onPressStat ? () => onPressStat("following") : undefined}
          />
        </View>
      </View>
      <View style={styles.nameRow}>
        <Text style={styles.name}>{profile.full_name ?? profile.username}</Text>
        {profile.is_private ? (
          <View style={styles.privateChip}>
            <Feather name="lock" size={9} color={colors.inkFaint} />
            <Text style={styles.privateText}>Private</Text>
          </View>
        ) : null}
      </View>
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      {profile.city ? <Text style={styles.city}>{profile.city}</Text> : null}
      {/* Issued by the database when the member was let in, and permanent.
          Nothing in Settings can change it. */}
      {membershipLine(profile.member_no) ? (
        <Text style={styles.membership}>{membershipLine(profile.member_no)}</Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

function Stat({ label, value, onPress }: { label: string; value: number; onPress?: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.stat, pressed && onPress ? styles.statPressed : null]}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={8}
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${value} ${label}`}
    >
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    backgroundColor: colors.paper,
    borderBottomWidth: 1,
    borderColor: colors.border,
    marginBottom: 2,
  },
  topRow: { flexDirection: "row", alignItems: "center" },
  stats: { flex: 1, flexDirection: "row", justifyContent: "space-evenly", marginLeft: spacing.lg },
  stat: { alignItems: "center", paddingHorizontal: spacing.xs },
  statPressed: { opacity: 0.5 },
  statValue: { fontSize: 16, fontWeight: "600", color: colors.ink },
  statLabel: { fontSize: 12, color: colors.inkSoft, marginTop: 1 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink },
  privateChip: { flexDirection: "row", alignItems: "center", gap: 3 },
  privateText: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  bio: { ...type.body, fontSize: 14, marginTop: 2 },
  city: { ...type.caption, marginTop: 2, color: colors.inkFaint },
  membership: {
    fontFamily: type.mono,
    fontSize: 9,
    letterSpacing: 1.6,
    color: colors.accent,
    marginTop: spacing.sm,
  },
  action: { marginTop: spacing.md },
});
