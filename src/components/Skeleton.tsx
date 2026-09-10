import React from "react";
import { Animated, Dimensions, Easing, StyleSheet, View, type ViewStyle } from "react-native";
import { colors, spacing } from "@/theme";

/**
 * What a screen shows while it is still asking.
 *
 * A blank page reads as broken; a spinner reads as slow. A faint shape in
 * the place the photograph will land reads as *arriving*, which is the
 * truth. These breathe rather than shimmer — nothing on VINTAGE glints.
 */
function usePulse(): Animated.Value {
  const pulse = React.useRef(new Animated.Value(0.55)).current;
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return pulse;
}

export function Bone({ style }: { style?: ViewStyle | ViewStyle[] }) {
  const opacity = usePulse();
  return <Animated.View style={[styles.bone, style, { opacity }]} />;
}

/** One feed card's worth of nothing yet: header, a 4:5 frame, two lines. */
export function PostSkeleton({ ratio = 4 / 5 }: { ratio?: number }) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Bone style={styles.avatar} />
        <View style={styles.headerText}>
          <Bone style={styles.name} />
          <Bone style={styles.meta} />
        </View>
      </View>
      <Bone style={[styles.media, { aspectRatio: ratio }]} />
      <View style={styles.lines}>
        <Bone style={styles.lineShort} />
        <Bone style={styles.lineLong} />
      </View>
    </View>
  );
}

/** A profile grid before its squares arrive. */
export function GridSkeleton({ rows = 3 }: { rows?: number }) {
  const gap = 2;
  const size = (Dimensions.get("window").width - gap * 2) / 3;
  return (
    <View style={{ gap }}>
      {Array.from({ length: rows }, (_, r) => (
        <View key={r} style={{ flexDirection: "row", gap }}>
          {Array.from({ length: 3 }, (_, c) => (
            <Bone key={c} style={{ width: size, height: size, borderRadius: 0 }} />
          ))}
        </View>
      ))}
    </View>
  );
}

/** The top of a profile before the member is known. */
export function ProfileSkeleton() {
  return (
    <View style={styles.profile}>
      <View style={styles.profileTop}>
        <Bone style={styles.profileAvatar} />
        <View style={styles.profileStats}>
          <Bone style={styles.stat} />
          <Bone style={styles.stat} />
          <Bone style={styles.stat} />
        </View>
      </View>
      <Bone style={[styles.name, { marginTop: spacing.md, width: 120 }]} />
      <Bone style={[styles.meta, { width: 200 }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bone: { backgroundColor: colors.paperSunken, borderRadius: 3 },
  card: { marginBottom: spacing.xl },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
  },
  headerText: { flex: 1, gap: 6 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  name: { width: 96, height: 11 },
  meta: { width: 150, height: 9 },
  media: { width: "100%", borderRadius: 0 },
  lines: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: 8 },
  lineShort: { width: 70, height: 10 },
  lineLong: { width: "60%", height: 10 },
  profile: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg, paddingBottom: spacing.md },
  profileTop: { flexDirection: "row", alignItems: "center" },
  profileAvatar: { width: 80, height: 80, borderRadius: 40 },
  profileStats: { flex: 1, flexDirection: "row", justifyContent: "space-evenly", marginLeft: spacing.lg },
  stat: { width: 36, height: 26 },
});
