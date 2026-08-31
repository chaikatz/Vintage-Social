import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Redirect, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
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
      <TabHeader username={profile?.username} />
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
function TabHeader({ username }: { username?: string }) {
  // Typed loosely on purpose: the tab is whatever segment follows "(tabs)".
  const segments = useSegments() as string[];
  const tab = segments[1] ?? "index";
  const insets = useSafeAreaInsets();

  const title = tab === "profile" ? username ?? "Profile" : TITLES[tab] ?? null;

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      {title === null ? (
        <Text style={styles.wordmark}>VINTAGE</Text>
      ) : (
        <Text style={styles.headerTitle}>{title}</Text>
      )}
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
