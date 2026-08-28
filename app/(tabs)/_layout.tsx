import React from "react";
import { Text } from "react-native";
import { Redirect, Tabs } from "expo-router";
import Feather from "@expo/vector-icons/Feather";
import { colors, type } from "@/theme";
import { useSession } from "@/providers/SessionProvider";

/** Home / Search / Post / Activity / Profile — nothing else. */
export default function TabsLayout() {
  const { session, profile, profileLoaded } = useSession();

  if (session === null) return <Redirect href="/(gate)/landing" />;
  if (profileLoaded && profile?.status !== "approved") {
    return <Redirect href="/(gate)/pending" />;
  }

  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.paper },
        headerShadowVisible: false,
        headerTintColor: colors.ink,
        tabBarStyle: {
          backgroundColor: colors.paper,
          borderTopColor: colors.border,
        },
        tabBarActiveTintColor: colors.ink,
        tabBarInactiveTintColor: colors.inkFaint,
        tabBarShowLabel: false,
        sceneStyle: { backgroundColor: colors.paper },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          headerTitle: () => <Text style={{ ...type.wordmark, fontSize: 20, letterSpacing: 4 }}>VINTAGE</Text>,
          tabBarIcon: ({ color }) => <Feather name="home" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => <Feather name="search" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Post",
          tabBarIcon: ({ color }) => <Feather name="plus-square" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: "Activity",
          tabBarIcon: ({ color }) => <Feather name="heart" size={23} color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <Feather name="user" size={23} color={color} />,
        }}
      />
    </Tabs>
  );
}
