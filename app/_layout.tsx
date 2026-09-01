import React from "react";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SessionProvider } from "@/providers/SessionProvider";
import { colors, type } from "@/theme";

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.paper },
            headerTintColor: colors.ink,
            headerTitleStyle: { fontFamily: type.serif, fontSize: 17 },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: colors.paper },
            // Drag anywhere to go back, not just from the left edge — the
            // photographs fill the screen, so the edge is a small target.
            gestureEnabled: true,
            fullScreenGestureEnabled: true,
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/landing" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/apply" options={{ title: "Apply" }} />
          {/* The invitation is a printed card, not a form in a frame. */}
          <Stack.Screen name="(gate)/invite" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/sign-in" options={{ title: "Sign in" }} />
          <Stack.Screen name="(gate)/pending" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="compose" options={{ title: "New post" }} />
          <Stack.Screen name="post/[id]" options={{ title: "Photo" }} />
          <Stack.Screen name="gallery" options={{ title: "" }} />
          <Stack.Screen name="comments" options={{ title: "Comments" }} />
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
