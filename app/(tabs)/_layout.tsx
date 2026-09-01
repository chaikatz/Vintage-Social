import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Redirect, useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { fetchUnreadMessageCount } from "@/api/messages";
import { SwipeTabs } from "@/navigation/SwipeTabs";
import { colors, spacing, type } from "@/theme";
import { useSession } from "@/providers/SessionProvider";

/**
 * Home / Search / Post / Activity / Profile — nothing else.
 *
 * The five live in a pager, so they can be swiped between as well as
 * tapped. The bar sits at the bottom and keeps the flat, hairline look of
 * the rest of the app: icons only, no indicator, no ripple.
 */
export default function TabsLayout() {
  const { session, profile, profileLoaded } = useSession();
  const insets = useSafeAreaInsets();

  if (session === null) return <Redirect href="/(gate)/landing" />;
  if (profileLoaded && profile?.status !== "approved") {
    return <Redirect href="/(gate)/pending" />;
  }

  return (
    <View style={styles.root}>
      <TabHeader username={profile?.username} userId={session?.user?.id ?? ""} />
      <SwipeTabs
        tabBarPosition="bottom"
        // Screens mount as they are first reached; neighbours preload so a
        // swipe never lands on an empty page.
        screenOptions={{
          lazy: true,
          lazyPreloadDistance: 1,
          tabBarShowLabel: false,
          tabBarShowIcon: true,
          tabBarActiveTintColor: colors.ink,
          tabBarInactiveTintColor: colors.inkFaint,
          tabBarPressColor: "transparent",
          tabBarPressOpacity: 1,
          tabBarIndicatorStyle: styles.indicator,
          tabBarItemStyle: styles.barItem,
          tabBarStyle: [styles.bar, { paddingBottom: insets.bottom }],
          sceneStyle: { backgroundColor: colors.paper },
        }}
      >
        <SwipeTabs.Screen
          name="index"
          options={{
            title: "Home",
            tabBarIcon: ({ color }) => <Feather name="home" size={23} color={color} />,
          }}
        />
        <SwipeTabs.Screen
          name="search"
          options={{
            title: "Search",
            tabBarIcon: ({ color }) => <Feather name="search" size={23} color={color} />,
          }}
        />
        <SwipeTabs.Screen
          name="create"
          options={{
            title: "Post",
            tabBarIcon: ({ color }) => <Feather name="plus-square" size={23} color={color} />,
          }}
        />
        <SwipeTabs.Screen
          name="activity"
          options={{
            title: "Activity",
            tabBarIcon: ({ color }) => <Feather name="heart" size={23} color={color} />,
          }}
        />
        <SwipeTabs.Screen
          name="profile"
          options={{
            title: "Profile",
            tabBarIcon: ({ color }) => <Feather name="user" size={23} color={color} />,
          }}
        />
      </SwipeTabs>
    </View>
  );
}

/** Titles for the five tabs, keyed by route segment. */
const TITLES: Record<string, string> = {
  search: "Search",
  create: "Post",
  activity: "Activity",
};

/**
 * The pager has no header of its own, so the tabs share one. Home flies the
 * wordmark; the profile flies the member's username.
 */
function TabHeader({ username, userId }: { username?: string; userId: string }) {
  const router = useRouter();
  // Typed loosely on purpose: the tab is whatever segment follows "(tabs)".
  const segments = useSegments() as string[];
  const tab = segments[1] ?? "index";
  const insets = useSafeAreaInsets();

  const title = tab === "profile" ? username ?? "Profile" : TITLES[tab] ?? null;

  // Messages hang off the feed, the way a letter tray sits beside a desk —
  // not a tab of their own, since they aren't a place you browse.
  const unread = useQuery({
    queryKey: ["unread-messages", userId],
    queryFn: () => fetchUnreadMessageCount(userId),
    enabled: Boolean(userId),
  });

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      {title === null ? (
        <Text style={styles.wordmark}>VINTAGE</Text>
      ) : (
        <Text style={styles.headerTitle}>{title}</Text>
      )}
      {tab === "index" ? (
        <Pressable
          style={styles.headerAction}
          hitSlop={10}
          onPress={() => router.push("/messages")}
          accessibilityLabel="Messages"
        >
          <Feather name="send" size={20} color={colors.ink} />
          {(unread.data ?? 0) > 0 ? <View style={styles.badge} /> : null}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.paper },
  header: {
    backgroundColor: colors.paper,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: spacing.sm,
  },
  wordmark: { ...type.wordmark, fontSize: 20, letterSpacing: 4 },
  headerAction: { position: "absolute", right: spacing.lg, bottom: spacing.sm },
  badge: {
    position: "absolute",
    top: -1,
    right: -2,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  headerTitle: { fontFamily: type.serif, fontSize: 17, color: colors.ink },
  bar: {
    backgroundColor: colors.paper,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 0,
    shadowOpacity: 0,
  },
  barItem: { paddingVertical: spacing.sm + 2 },
  indicator: { height: 0 },
});
