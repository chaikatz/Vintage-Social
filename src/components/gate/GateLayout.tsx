import React from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { colors, spacing, type } from "@/theme";

/**
 * The ground every signed-out screen stands on.
 *
 * Inside VINTAGE the chrome recedes and the photographs carry the screen.
 * Out here there are no photographs of yours yet, so the app introduces
 * itself the way the landing page does: the cream page, ink, the wordmark
 * tracked wide, letterspaced capitals on the buttons. These screens hide
 * the navigation header and carry their own back mark, because a grey iOS
 * bar across the top would break the object.
 */
export function GateLayout({
  children,
  back = true,
  scroll = true,
  contentStyle,
}: {
  children: React.ReactNode;
  back?: boolean;
  scroll?: boolean;
  contentStyle?: ViewStyle;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const body = (
    <View style={[styles.body, { paddingBottom: insets.bottom + spacing.xl }, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={styles.root}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {scroll ? (
          <ScrollView
            contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.xxl }]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {body}
          </ScrollView>
        ) : (
          <View style={[styles.fill, { paddingTop: insets.top + spacing.xxl }]}>{body}</View>
        )}
      </KeyboardAvoidingView>

      {back ? (
        <Pressable
          style={[styles.back, { top: insets.top + spacing.sm }]}
          hitSlop={14}
          onPress={() => router.back()}
          accessibilityLabel="Back"
        >
          <Feather name="chevron-left" size={22} color={colors.ink as unknown as string} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** The title block: an eyebrow in capitals, the wordmark, a struck rule. */
export function GateHeading({
  eyebrow,
  title,
  blurb,
  script = false,
}: {
  eyebrow?: string;
  title: string;
  blurb?: string;
  /** Set the title as the wordmark — the serif, tracked wide, as on the landing page. */
  script?: boolean;
}) {
  return (
    <View style={styles.heading}>
      {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
      <Text style={script ? styles.script : styles.title}>{script ? title.toUpperCase() : title}</Text>
      <View style={styles.rule} />
      {blurb ? <Text style={styles.blurb}>{blurb}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  fill: { flex: 1 },
  scroll: { flexGrow: 1 },
  body: { flex: 1, paddingHorizontal: spacing.xl + spacing.xs },
  back: { position: "absolute", left: spacing.md },

  heading: { alignItems: "center", marginBottom: spacing.xl },
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.inkFaint,
  },
  script: {
    fontFamily: type.serif,
    fontSize: 34,
    lineHeight: 44,
    letterSpacing: 9,
    color: colors.ink,
    marginTop: spacing.sm,
    textAlign: "center",
  },
  title: {
    fontFamily: type.serif,
    fontSize: 26,
    letterSpacing: 0.5,
    color: colors.ink,
    marginTop: spacing.sm,
  },
  rule: {
    height: 1,
    width: 24,
    backgroundColor: colors.ink,
    opacity: 0.85,
    marginTop: spacing.md,
  },
  blurb: {
    fontFamily: type.serif,
    fontSize: 14,
    lineHeight: 22,
    color: colors.inkSoft,
    textAlign: "center",
    marginTop: spacing.lg,
    maxWidth: 300,
  },
});
