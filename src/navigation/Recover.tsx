import React, { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { router, type ErrorBoundaryProps } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, type } from "@/theme";
import { queryClient } from "@/lib/queryClient";
import { forgetUnwatchedReads } from "@/components/recoverReads";

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
 * Where a screen's header cannot be counted on for that, `RecoverPageWithBack`
 * puts the way back on the page too: a screen opened straight from a link
 * is the first in its stack and has no back button, the editor hides its
 * own while it develops, and a sheet has none. Going back from it returns
 * to the screen before, or to Home when there is none. The Memory Room,
 * which has no header at all, has `RecoverRoom`, which also keeps clear of
 * the status bar. A tab's page needs neither: the tab bar is the way out.
 * Trying again on any of them draws the screen from reads made afresh, not
 * from the row it broke on (src/components/recoverReads.ts).
 *
 * None of them reads the app's own providers (the session, the query
 * cache's provider): the root one is drawn where they have been taken
 * down with the layout, and the others reach the one cache directly. The
 * Memory Room's asks only where the status bar ends.
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

/** Back to the screen before, or Home when there is none (a screen opened from a notification). */
function leave() {
  if (router.canGoBack()) router.back();
  else router.replace("/(tabs)");
}

function GoBack() {
  return (
    <Pressable onPress={leave} hitSlop={10} style={styles.retry} accessibilityRole="button">
      <Text style={styles.retryText}>Go back</Text>
      <View style={styles.rule} />
    </Pressable>
  );
}

interface PageProps extends ErrorBoundaryProps {
  /** Draw the way back on the page as well as Try again. */
  withBack?: boolean;
  /** Space kept above it where there is no header: the status bar's. */
  top?: number;
}

/** One screen's: drawn under its header, which keeps the way back. */
export function RecoverPage({ error, retry, withBack = false, top = 0 }: PageProps) {
  useLogged(error);
  // Drawn again from the reads it broke on, the screen would break again at
  // once: those, which nothing watches now, are let go of and read afresh.
  const { trying, tryAgain } = useRetry(() => {
    forgetUnwatchedReads(queryClient);
    return retry();
  });
  return (
    <View style={[styles.screen, top > 0 && { paddingTop: top + PAGE_TOP }]}>
      <Text style={styles.title} accessibilityRole="header">
        This page didn’t open
      </Text>
      <Text style={styles.body}>Nothing you’ve posted is lost. Try again, or go back.</Text>
      <TryAgain onPress={tryAgain} disabled={trying} />
      {withBack ? <GoBack /> : null}
    </View>
  );
}

/**
 * One screen's, whose header may not hold the way back: a screen opened
 * straight from a link, the editor while it develops, a sheet.
 */
export function RecoverPageWithBack(props: ErrorBoundaryProps) {
  return <RecoverPage {...props} withBack />;
}

/** The Memory Room's, which has no header: the way back on the page, clear of the status bar. */
export function RecoverRoom(props: ErrorBoundaryProps) {
  const insets = useSafeAreaInsets();
  return <RecoverPage {...props} withBack top={insets.top} />;
}

/** Where a screen's recover page starts under its header. */
const PAGE_TOP = spacing.xxl * 2;

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
    paddingTop: PAGE_TOP,
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
