import React, { useRef } from "react";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Redirect, useRouter, useSegments } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import Feather from "@expo/vector-icons/Feather";
import { fetchUnreadMessageCount } from "@/api/messages";
import { SwipeTabs } from "@/navigation/SwipeTabs";
import { useTabSwipeEnabled } from "@/utils/tabSwipe";
import { keepPagerToOneFinger } from "@/utils/pagerTouches";
import { colors, spacing, type } from "@/theme";
import { useSession } from "@/providers/SessionProvider";
import { emitHomeAgain } from "@/utils/homeRefresh";
import { usePushRegistration } from "@/utils/push";
import { useFeedBackground } from "@/utils/feedPaper";
import { useNameTitleStyle } from "@/utils/nameFace";

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
  // Held still while a screen owns a sideways drag of its own (a magnified timeline).
  const swipeEnabled = useTabSwipeEnabled();
  // Two fingers are a pinch, never a swipe: the pager is told so as soon as
  // it is on screen, before any pinch can begin. See src/utils/pagerTouches.
  const root = useRef<View>(null);
  const toldPager = useRef(false);
  // An approved member on a real phone: ask once, file the token.
  usePushRegistration(session?.user?.id, profileLoaded && profile?.status === "approved");
  // Editorial (Preview): while Home is in front, the tab bar is on the feed's paper too.
  const paper = useFeedBackground();

  if (session === null) return <Redirect href="/(gate)/landing" />;
  if (profileLoaded && profile?.status !== "approved") {
    return <Redirect href="/(gate)/pending" />;
  }

  return (
    <View
      ref={root}
      style={styles.root}
      onLayout={() => {
        if (toldPager.current) return;
        toldPager.current = true;
        keepPagerToOneFinger(root.current).then((told) => {
          // Not found yet: let the next layout try again.
          if (!told) toldPager.current = false;
        });
      }}
    >
      <TabHeader username={profile?.username} userId={session?.user?.id ?? ""} />
      <SwipeTabs
        tabBarPosition="bottom"
        // Screens mount as they are first reached; neighbours preload so a
        // swipe never lands on an empty page.
        screenOptions={{
          swipeEnabled,
          lazy: true,
          lazyPreloadDistance: 1,
          tabBarShowLabel: false,
          tabBarShowIcon: true,
          // Typed as strings by React Navigation, but resolved by the
          // platform: dynamic colours pass straight through processColor.
          tabBarActiveTintColor: colors.ink as unknown as string,
          tabBarInactiveTintColor: colors.inkFaint as unknown as string,
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
            tabBarStyle: [styles.bar, { paddingBottom: insets.bottom }, paper],
          }}
          // Tapping Home while already on Home is "again": the feed goes
          // back to the top and asks for what is new. From any other tab it
          // is plain navigation, untouched.
          listeners={({ navigation }) => ({
            tabPress: () => {
              if (navigation.isFocused()) emitHomeAgain();
            },
          })}
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
  // The segments follow whatever is in front, so while a screen is pushed
  // over the tabs (a gallery, Settings, a profile) this header, still drawn
  // underneath through the slide and the swipe back, keeps the tab it was.
  const segments = useSegments() as string[];
  const lastTab = useRef("index");
  if (segments[0] === "(tabs)") lastTab.current = segments[1] ?? "index";
  const tab = lastTab.current;
  const insets = useSafeAreaInsets();
  // Editorial (Preview): Home's bar is on the feed's paper; the other tabs keep the app's.
  const paper = useFeedBackground();

  const title = tab === "profile" ? username ?? "Profile" : TITLES[tab] ?? null;
  // Editorial (Preview): the Profile tab's title, the member's username, in the names' face, as every bar titled
  // with a username is; any other title, and the tab's before the username is known, keeps the serif. The face's
  // line is taller than the serif's, so the title gives the difference back to the bar's padding, and the bar keeps
  // the height it has on every other tab. Both lines grow with the reader's text size (the phone scales a set line
  // height by it, as it scales the serif's own line), so what is given back grows with it, at any size of text.
  const titleStyle = useNameTitleStyle(tab === "profile" && username != null);
  const { fontScale } = useWindowDimensions();
  const nameTitle = titleStyle.fontSize !== styles.headerTitle.fontSize ? { marginVertical: styles.nameTitle.marginVertical * fontScale } : undefined;

  // Messages hang off the feed, the way a letter tray sits beside a desk —
  // not a tab of their own, since they aren't a place you browse.
  const unread = useQuery({
    queryKey: ["unread-messages", userId],
    queryFn: () => fetchUnreadMessageCount(userId),
    enabled: Boolean(userId),
  });

  return (
    <View style={[styles.header, tab === "index" && paper, { paddingTop: insets.top + spacing.sm }]}>
      {title === null ? (
        <Text style={styles.wordmark}>VINTAGE</Text>
      ) : (
        <Text style={[styles.headerTitle, titleStyle, nameTitle]}>{title}</Text>
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
    backgroundColor: colors.badge,
  },
  headerTitle: { fontFamily: type.serif, fontSize: 17, color: colors.ink },
  // Editorial (Preview): half the difference between the line the names' face is set on in a title (28) and the
  // serif's at 17 (19.32, Georgia's 1.136 of it, on the iPhone), above and below, at the default size of text;
  // TabHeader scales it with the reader's. (On the web, whose serif line is 19.5 and whose text keeps its size,
  // the Profile tab's bar is a fifth of a point shorter than the others.)
  nameTitle: { marginVertical: -4.34 },
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
