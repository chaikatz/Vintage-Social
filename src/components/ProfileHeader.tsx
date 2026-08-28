import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, type } from "@/theme";
import { Avatar } from "./Avatar";
import type { ProfileRow } from "@/types/db";

interface Props {
  profile: ProfileRow;
  /** Follow / Edit profile button area. */
  action?: React.ReactElement;
}

export function ProfileHeader({ profile, action }: Props) {
  return (
    <View style={styles.wrap}>
      <View style={styles.topRow}>
        <Avatar path={profile.avatar_url} username={profile.username} size={80} />
        <View style={styles.stats}>
          <Stat label="posts" value={profile.post_count} />
          <Stat label="followers" value={profile.follower_count} />
          <Stat label="following" value={profile.following_count} />
        </View>
      </View>
      <Text style={styles.name}>{profile.full_name ?? profile.username}</Text>
      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
      {profile.city ? <Text style={styles.city}>{profile.city}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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
  stat: { alignItems: "center" },
  statValue: { fontSize: 16, fontWeight: "600", color: colors.ink },
  statLabel: { fontSize: 12, color: colors.inkSoft, marginTop: 1 },
  name: { fontSize: 15, fontWeight: "600", color: colors.ink, marginTop: spacing.md },
  bio: { ...type.body, fontSize: 14, marginTop: 2 },
  city: { ...type.caption, marginTop: 2, color: colors.inkFaint },
  action: { marginTop: spacing.md },
});
