import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { registerPushToken, unregisterAllPushTokens, unregisterPushToken } from "@/api/notifications";
import { isDemoMode } from "@/lib/env";
import { tapFollower, tokenFiler } from "./pushRoute";
import { onReturnFromBackground } from "./appReturn";
import { noteToken, pushSupported, stopReceiving, takeToken, tokenRemoved } from "./pushKept";

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

// The token kept on the phone, and what a session ended elsewhere does
// with it, live in pushKept.ts, which the auth client's own listener uses.
export { parseKeptToken, pushAfterSignedOut, pushSupported } from "./pushKept";

// A notice arriving while the app is open: show it, softly.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? (Constants.easConfig as { projectId?: string } | undefined)?.projectId;
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
    // Known before it is filed: a filing that fails (no signal, a token
    // that had run out) leaves the row an earlier launch filed, and
    // signing out must still be able to take it away.
    noteToken(token);
    await registerPushToken(userId, token, platform, device);
    return token;
  } catch (err) {
    // A push that cannot be set up is a push that will not arrive; the
    // rest of the app is unaffected.
    console.warn("push registration failed", err);
    return null;
  }
}

/**
 * On sign out, while still signed in: this phone stops speaking for the
 * member who is leaving. Its token's row is removed, the token this
 * launch filed or, failing that, the one an earlier launch kept.
 *
 * When the row cannot be removed (no signal, the server refusing, or a
 * removal that took nothing: the row another member's, which row-level
 * security neither removes nor reports), or no token is known while the
 * phone may receive notifications, the phone itself stops receiving them:
 * it unregisters from Apple's push service, so a phone left signed out is
 * never told about the last member's likes and messages. The next member
 * to sign in registers it again.
 */
export async function forgetPushToken(): Promise<void> {
  const token = takeToken();
  if (token) {
    try {
      if ((await unregisterPushToken(token)) > 0) {
        tokenRemoved();
        return;
      }
      // Nothing removed: gone already, or not this member's to remove.
    } catch {
      // Offline, or refused: the row stays. The phone stops receiving instead.
    }
  }
  await stopReceiving(token != null);
}

/**
 * On a sign-out that ends the member's sessions on every phone, while
 * still signed in: this phone stops speaking for them, and so does every
 * other phone of theirs. A phone whose session ended elsewhere hears of
 * it only when its app next runs (pushAfterSignedOut), and was sent the
 * member's likes and messages until then, for days if the app was not
 * opened.
 *
 * One request: every row of the member's goes, this phone's with them
 * when it is theirs, and the tokens that went come back. This phone is
 * let go as forgetPushToken lets it go: its row among them, the token is
 * done with; not among them (gone already, or another member's, which
 * row-level security neither removes nor reports), or no answer, the
 * phone stops receiving. It was two removals one after the other, two
 * waits on a slow connection before the sign-out could go on.
 *
 * Without a signal the rows stay: so does the sign-out, which then ends
 * only this phone's session (src/providers/SessionProvider.tsx), and the
 * other phones, still signed in, keep their notices.
 */
export async function forgetPushTokensEverywhere(userId: string | null | undefined): Promise<void> {
  if (!userId) return forgetPushToken();
  const token = takeToken();
  try {
    const removed = await unregisterAllPushTokens(userId);
    if (token && removed.includes(token)) {
      tokenRemoved();
      return;
    }
  } catch {
    // Offline, or refused: see above.
  }
  await stopReceiving(token != null);
}

/**
 * Register when an approved member is present, and again on each return
 * to the app until it has worked (pushRoute.ts). Kept with the tabs, so a
 * member who signs out and back in is filed afresh.
 */
export function usePushRegistration(userId: string | null | undefined, approved: boolean): void {
  const file = useRef<((userId: string) => void) | null>(null);
  file.current ??= tokenFiler(registerForPush);
  useEffect(() => {
    if (!userId || !approved) return;
    const want = () => file.current?.(userId);
    want();
    return onReturnFromBackground(want);
  }, [userId, approved]);
}

/** The app's one follower of taps (see useNotificationTaps). */
let follow: ReturnType<typeof tapFollower> | null = null;

/**
 * Follow a tapped notice to the thing it is about, and keep Activity
 * fresh while the app is open. Mount once, anywhere under the router.
 */
export function useNotificationTaps(): void {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    if (Platform.OS === "web" || isDemoMode()) return;

    // Each tap followed once, and waited for if the navigator is not up
    // yet (pushRoute.ts). Kept for the life of the app, not of this
    // effect, so a tap already followed is never followed again.
    const go = (follow ??= tapFollower({
      navigate: (route) => router.push(route as never),
      clear: () => Notifications.clearLastNotificationResponse(),
    }));

    // The tap that opened the app from cold, if there was one.
    Notifications.getLastNotificationResponseAsync()
      .then((last) => {
        if (last) go(last);
      })
      .catch(() => undefined);
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
