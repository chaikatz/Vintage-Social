import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { ErrorBoundaryProps } from "expo-router";
import { colors, spacing, type } from "@/theme";
import { queryClient } from "@/lib/queryClient";

/**
 * What the app shows when a page breaks while it is being drawn.
 *
 * Without it, one bad row from the server (a post whose author has gone,
 * a field that came back empty) made React give up on the whole tree,
 * and in a release build that closes the app: to the member it froze, or
 * vanished. Now the page that broke is replaced by this one, in the app's
 * own print and words, with one thing to do: try again. Nothing the
 * member made is touched; their posts are on the server and anything
 * still going up carries on from the outbox, which lives outside React.
 *
 * Two of them. `RecoverApp` stands in for the whole app (the root
 * layout's boundary), so it carries the wordmark and is the whole page;
 * trying again opens the app afresh at its door, which sends a member to
 * Home, away from whatever broke, with every read made again rather than
 * drawn from what was held when it broke. `RecoverPage` stands in for one
 * screen, under its own header, so the way back stays where it always is.
 *
 * Neither reads anything from the app's providers: the root one is drawn
 * where they have been taken down with the layout.
 */

declare const __DEV__: boolean | undefined;

function useLogged(error: Error) {
  useEffect(() => {
    // The message is for the developer's log, never the page: it is the
    // runtime talking, not us.
    if (typeof __DEV__ !== "undefined" && __DEV__) console.error("A page broke and was recovered:", error);
  }, [error]);
}

/** Tried again once at a time: a tap while the page is redrawn does nothing more. */
function useRetry(retry: () => Promise<void>) {
  const [trying, setTrying] = useState(false);
  const tryAgain = () => {
    if (trying) return;
    setTrying(true);
    retry().catch(() => undefined).finally(() => setTrying(false));
  };
  return { trying, tryAgain };
}

function TryAgain({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={10}
      style={styles.retry}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
    >
      <Text style={styles.retryText}>Try again</Text>
      <View style={styles.rule} />
    </Pressable>
  );
}

/** The whole app's: the root layout's boundary. */
export function RecoverApp({ error, retry }: ErrorBoundaryProps) {
  useLogged(error);
  // Everything under the layout is down, so nothing is reading the cache.
  const { trying, tryAgain } = useRetry(() => {
    queryClient.clear();
    return retry();
  });
  return (
    <View style={styles.page}>
      <Text style={type.wordmark} accessibilityRole="header">
        VINTAGE
      </Text>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.body}>Nothing you’ve posted is lost. Try again to go back to the app.</Text>
      <TryAgain onPress={tryAgain} disabled={trying} />
    </View>
  );
}

/** One screen's: drawn under its header, which keeps the way back. */
export function RecoverPage({ error, retry }: ErrorBoundaryProps) {
  useLogged(error);
  const { trying, tryAgain } = useRetry(retry);
  return (
    <View style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        This page didn’t open
      </Text>
      <Text style={styles.body}>Nothing you’ve posted is lost. Try again, or go back.</Text>
      <TryAgain onPress={tryAgain} disabled={trying} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.paper,
  },
  screen: {
    flex: 1,
    alignItems: "center",
    paddingTop: spacing.xxl * 2,
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.paper,
  },
  title: { ...type.title, fontSize: 18, textAlign: "center", marginTop: spacing.xl },
  body: { ...type.caption, textAlign: "center", marginTop: spacing.sm, color: colors.inkSoft },
  retry: { alignItems: "center", marginTop: spacing.xl, paddingVertical: spacing.sm, paddingHorizontal: spacing.md },
  retryText: {
    fontFamily: type.mono,
    fontSize: 11,
    letterSpacing: 2.4,
    marginRight: -2.4,
    textTransform: "uppercase",
    color: colors.ink,
  },
  rule: { width: 26, height: 1, backgroundColor: colors.ink, marginTop: 7, opacity: 0.8 },
});
