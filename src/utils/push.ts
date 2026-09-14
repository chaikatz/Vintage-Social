import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { registerPushToken, unregisterPushToken } from "@/api/notifications";
import { isDemoMode } from "@/lib/env";
import { routeForNotification } from "./pushRoute";

/**
 * The phone's side of notifications.
 *
 * Two jobs. First, once an approved member is signed in, ask the phone
 * for permission and a push token, and file the token under the member.
 * Second, when a notice is tapped, go where it points. While the app is
 * open in front, a notice is shown quietly — a banner, no sound — since
 * the thing it describes is usually already on screen in Activity.
 *
 * Everything degrades to nothing on the web, in the simulator, in demo
 * mode, or when the member says no. Nothing is asked twice: the phone
 * remembers its answer and `getPermissionsAsync` reads it back.
 */

// A notice arriving while the app is open: show it, softly.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/** The one token this phone holds, once known, so sign-out can drop it. */
let currentToken: string | null = null;

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
}

/** Whether this phone can be pushed to at all. */
export function pushSupported(): boolean {
  return Platform.OS !== "web" && !isDemoMode() && Device.isDevice;
}

/**
 * Ask, once, and file the token. Returns the token, or null when the phone
 * cannot be reached — no permission, no device, no project.
 */
export async function registerForPush(userId: string): Promise<string | null> {
  if (!pushSupported()) return null;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    const id = projectId();
    const { data: token } = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
    if (!token) return null;
    const platform = Platform.OS === "ios" ? "ios" : "android";
    const device = [Device.manufacturer, Device.modelName].filter(Boolean).join(" ") || null;
    await registerPushToken(userId, token, platform, device);
    currentToken = token;
    return token;
  } catch (err) {
    // A push that cannot be set up is a push that will not arrive; the
    // rest of the app is unaffected.
    console.warn("push registration failed", err);
    return null;
  }
}

/** On sign out: this phone stops speaking for the member who just left. */
export async function forgetPushToken(): Promise<void> {
  const token = currentToken;
  currentToken = null;
  if (!token) return;
  try {
    await unregisterPushToken(token);
  } catch {
    // Already gone, or offline. The function retires dead tokens on its own.
  }
}

/** Register when an approved member is present; once per member per launch. */
export function usePushRegistration(userId: string | null | undefined, approved: boolean): void {
  const done = useRef<string | null>(null);
  useEffect(() => {
    if (!userId || !approved) return;
    if (done.current === userId) return;
    done.current = userId;
    registerForPush(userId);
  }, [userId, approved]);
}

/**
 * Follow a tapped notice to the thing it is about, and keep Activity
 * fresh while the app is open. Mount once, anywhere under the router.
 */
export function useNotificationTaps(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (Platform.OS === "web" || isDemoMode()) return;

    const go = (response: Notifications.NotificationResponse | null | undefined) => {
      const data = response?.notification.request.content.data as Record<string, unknown> | undefined;
      const route = routeForNotification(data);
      if (route) router.push(route as never);
    };

    // The tap that opened the app from cold, if there was one.
    Notifications.getLastNotificationResponseAsync().then((last) => {
      if (last) go(last);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener(go);
    // A notice arriving while the app is open: what it describes is new,
    // so Activity and the unread count go and look.
    const arrived = Notifications.addNotificationReceivedListener(() => {
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      queryClient.invalidateQueries({ queryKey: ["unread-messages"] });
    });
    return () => {
      tapped.remove();
      arrived.remove();
    };
  }, [router, queryClient]);
}
