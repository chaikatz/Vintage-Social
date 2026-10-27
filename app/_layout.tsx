import React from "react";
import { StatusBar } from "expo-status-bar";
import { Stack } from "expo-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { SessionProvider } from "@/providers/SessionProvider";
import { colors, dark, type } from "@/theme";
import { restoreAppearance } from "@/utils/appearance";
import { useNotificationTaps } from "@/utils/push";
import { KeyboardDone } from "@/components/KeyboardDone";
import { startOutbox } from "@/uploads";

// Before the first screen draws, so the page opens on the print it was left on.
restoreAppearance();

// Posts still on their way up when the app was last closed carry on from
// where they stopped. Started here, once, above the navigator: the outbox
// outlives every screen, and Home only reads it.
startOutbox();

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
        <KeyboardDone />
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
          {/* The root and the door's resting screens are not "back" from
              anywhere: a swipe on them goes nowhere. */}
          <Stack.Screen name="index" options={{ headerShown: false, gestureEnabled: false, fullScreenGestureEnabled: false }} />
          {/* The whole signed-out world is a printed object, not a form in
              a frame: no navigation header on any of it. Each screen carries
              its own back mark. */}
          <Stack.Screen name="(gate)/landing" options={{ headerShown: false, gestureEnabled: false, fullScreenGestureEnabled: false }} />
          <Stack.Screen name="(gate)/apply" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/invite" options={{ headerShown: false }} />
          {/* Carries a tapped invitation's suffix through to the card. */}
          <Stack.Screen name="invite/[slug]" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/sign-in" options={{ headerShown: false }} />
          <Stack.Screen name="(gate)/pending" options={{ headerShown: false, gestureEnabled: false, fullScreenGestureEnabled: false }} />
          {/* The tabs are the floor of the signed-in app. Nothing is "back"
              from them — the door is not — so the back swipe is off here;
              the pager's own swipe moves between the tabs. */}
          <Stack.Screen
            name="(tabs)"
            options={{ headerShown: false, title: "Home", gestureEnabled: false, fullScreenGestureEnabled: false }}
          />
          {/* Composing is the one screen a stray swipe must not throw away:
              the back gesture is off here, so leaving is a deliberate tap. */}
          <Stack.Screen
            name="compose"
            options={({ route }) => ({
              title: "New post",
              gestureEnabled: false,
              fullScreenGestureEnabled: false,
              // Developed from the Darkroom: the print stays where it was
              // and the lights come up around it, rather than a new page
              // sliding over the room. Quicker than the room's own fade in,
              // so handing the print over adds no wait. Every other way in
              // slides as usual, at the platform's own pace.
              ...((route.params as { from?: string } | undefined)?.from === "darkroom"
                ? { animation: "fade" as const, animationDuration: 280 }
                : { animation: "default" as const }),
            })}
          />
          {/* The Darkroom: the lights go down as it fades in, onto the
              deepest brown the theme has, so not a frame of the light page
              shows in Light appearance. Back is the left edge only — a pan
              anywhere else is the next print. */}
          <Stack.Screen
            name="darkroom"
            options={{
              headerShown: false,
              animation: "fade",
              animationDuration: 360,
              gestureEnabled: true,
              fullScreenGestureEnabled: false,
              contentStyle: { backgroundColor: dark.paperSunken },
            }}
          />
          {/* Screens with sideways gestures of their own — a pinch on a
              photograph, a magnified timeline dragged with a finger — keep
              the back swipe to the left edge. A pan from anywhere else used to
              take the pinch's fingers as a swipe back and cancel the pinch. */}
          <Stack.Screen name="post/[id]" options={{ title: "", fullScreenGestureEnabled: false }} />
          <Stack.Screen name="follows" options={{ title: "" }} />
          <Stack.Screen name="likes" options={{ title: "Likes" }} />
          <Stack.Screen name="memories" options={{ title: "On this day" }} />
          <Stack.Screen name="library-picker" options={{ title: "" }} />
          <Stack.Screen name="gallery" options={{ title: "", fullScreenGestureEnabled: false }} />
          <Stack.Screen name="comments" options={{ title: "Comments" }} />
          <Stack.Screen name="edit-caption" options={{ presentation: "modal", title: "Edit caption" }} />
          <Stack.Screen name="messages/index" options={{ title: "Messages" }} />
          <Stack.Screen name="messages/[id]" options={{ title: "" }} />
          <Stack.Screen name="share" options={{ presentation: "modal", title: "Send to" }} />
          <Stack.Screen name="export" options={{ presentation: "modal", title: "Share outside" }} />
          <Stack.Screen name="requests" options={{ title: "Requests" }} />
          <Stack.Screen name="user/[username]" options={{ title: "", fullScreenGestureEnabled: false }} />
          <Stack.Screen name="settings" options={{ title: "Settings" }} />
          <Stack.Screen name="blocked" options={{ title: "Blocked members" }} />
          <Stack.Screen name="legal/[doc]" options={{ title: "" }} />
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
