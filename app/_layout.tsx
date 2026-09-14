import React from "react";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SessionProvider } from "@/providers/SessionProvider";
import { colors, type } from "@/theme";
import { restoreAppearance } from "@/utils/appearance";
import { useNotificationTaps } from "@/utils/push";

// Before the first screen draws, so the page opens on the print it was left on.
restoreAppearance();

/** A tapped notice goes where it points. Lives under the router, renders nothing. */
function NotificationTaps() {
  useNotificationTaps();
  return null;
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <StatusBar style="auto" />
        <NotificationTaps />
        <Stack
          screenOptions={{
            // Typed as strings by React Navigation, but resolved by the
            // platform: dynamic colours pass straight through processColor.
            headerStyle: { backgroundColor: colors.paper as unknown as string },
            headerTintColor: colors.ink as unknown as string,
            headerTitleStyle: { fontFamily: type.serif, fontSize: 17 },
            headerShadowVisible: false,
            // The chevron alone. iOS labels a back button with the previous
            // screen's title, and the previous screen is usually the tab
            // pager — whose route is literally "(tabs)". Nobody wants to
            // read that, and a bare chevron is what the photographs deserve.
            headerBackButtonDisplayMode: "minimal",
            headerBackTitle: "Back",
            contentStyle: { backgroundColor: colors.paper },
            // Drag anywhere to go back, not just from the left edge — the
            // photographs fill the screen, so the edge is a small target.
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          {/* The whole signed-out world is a printed object, not a form in
              a frame: no navigation header on any of it. Each screen carries
              its own back mark. */}
          <Stack.Screen name="(gate)/landing" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/apply" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/invite" options={{ headerShown: false }} />
          {/* Carries a tapped invitation's suffix through to the card. */}
          <Stack.Screen name="invite/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/pending" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false, title: "Home" }} />
          {/* Composing is the one screen a stray swipe must not throw away:
              the back gesture is off here, so leaving is a deliberate tap. */}
          <Stack.Screen
            name="compose"
            options={{
              title: "New post",
              gestureEnabled: false,
              fullScreenGestureEnabled: false,
            }}
          />
          <Stack.Screen name="post/[id]" options={{ title: "" }} />
          <Stack.Screen name="follows" options={{ title: "" }} />
          <Stack.Screen name="memories" options={{ title: "On this day" }} />
          <Stack.Screen name="library-picker" options={{ title: "" }} />
          <Stack.Screen name="gallery" options={{ title: "" }} />
          <Stack.Screen name="comments" options={{ title: "Comments" }} />
          <Stack.Screen name="edit-caption" options={{ presentation: "modal", title: "Edit caption" }} />
          <Stack.Screen name="messages/index" options={{ title: "Messages" }} />
          <Stack.Screen name="messages/[id]" options={{ title: "" }} />
          <Stack.Screen name="share" options={{ presentation: "modal", title: "Send to" }} />
          <Stack.Screen name="requests" options={{ title: "Requests" }} />
          <Stack.Screen name="user/[username]" options={{ title: "" }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
          <Stack.Screen name="invites" options={{ title: "Invitations" }} />
          <Stack.Screen name="report" options={{ presentation: "modal", title: "Report" }} />
          <Stack.Screen name="admin/index" options={{ title: "Admin" }} />
          <Stack.Screen name="admin/applications" options={{ title: "Applications" }} />
          <Stack.Screen name="admin/reports" options={{ title: "Reports" }} />
          <Stack.Screen name="admin/members" options={{ title: "Members" }} />
        </Stack>
      </SessionProvider>
    </QueryClientProvider>
  );
}
