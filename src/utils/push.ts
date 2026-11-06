import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { registerPushToken, unregisterPushToken } from "@/api/notifications";
import { isDemoMode } from "@/lib/env";
import { tapFollower, tokenFiler } from "./pushRoute";
import { onReturnFromBackground } from "./appReturn";
import { deleteDiskCache, readDiskCache, writeDiskCache } from "./diskCache";

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

/**
 * The token last filed from this phone, kept on it, so sign-out can take
 * it away even in a launch whose own registration failed.
 *
 * Only the token this launch had filed was known before: a launch that
 * could not reach Expo for a token (no signal at the start), or one that
 * signed out before registering, left the row an earlier launch filed,
 * under the member who had just left, and the phone went on being told
 * about their likes and messages while signed out. Kept in the cache
 * folder, which is not backed up: a phone restored from this one's backup
 * must not take this phone's token for its own. If iOS empties the folder,
 * the token is simply not known, and sign-out does what it does when the
 * token cannot be removed (below).
 */
const TOKEN_FILE = "push-token.json";
const TOKEN_KEY = "vintage.push-token";
const IN_CACHE = { dir: "cache" } as const;

interface KeptToken {
  v: 1;
  token: string;
}

export function parseKeptToken(raw: unknown): KeptToken | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1 || typeof r.token !== "string" || !r.token) return null;
  return { v: 1, token: r.token };
}

function keptToken(): string | null {
  return readDiskCache(TOKEN_FILE, TOKEN_KEY, parseKeptToken, IN_CACHE)?.token ?? null;
}

function keepToken(token: string): void {
  writeDiskCache(TOKEN_FILE, TOKEN_KEY, { v: 1, token } satisfies KeptToken, IN_CACHE);
}

function dropKeptToken(): void {
  deleteDiskCache(TOKEN_FILE, TOKEN_KEY, IN_CACHE);
}

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
    // Known before it is filed: a filing that fails (no signal, a token
    // that had run out) leaves the row an earlier launch filed, and
    // signing out must still be able to take it away.
    currentToken = token;
    keepToken(token);
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
 * When the row cannot be removed (no signal, the server refusing), or no
 * token is known while the phone may receive notifications, the phone
 * itself stops receiving them: it unregisters from Apple's push service,
 * so a phone left signed out is never told about the last member's likes
 * and messages. The next member to sign in registers it again.
 */
export async function forgetPushToken(): Promise<void> {
  const token = currentToken ?? keptToken();
  currentToken = null;
  if (token) {
    try {
      await unregisterPushToken(token);
      dropKeptToken();
      return;
    } catch {
      // Offline, or refused: the row stays. The phone stops receiving instead.
    }
  }
  await stopReceiving(token != null);
}

/**
 * The session has left this phone without a sign-out made on it (a
 * refresh token the server refused: a sign-out or a password change on
 * another device). There is no session to remove the row with, so if
 * this phone filed a token that sign-out did not take away, the phone
 * stops receiving.
 */
export async function pushAfterSignedOut(): Promise<void> {
  currentToken = null;
  if (keptToken() == null) return;
  await stopReceiving(true);
}

/**
 * Unregister this phone from push notifications, and forget its token.
 * Only when a token was filed from it, or when it may receive at all.
 */
async function stopReceiving(filed: boolean): Promise<void> {
  dropKeptToken();
  if (!pushSupported()) return;
  try {
    if (!filed && (await Notifications.getPermissionsAsync()).status !== "granted") return;
    await Notifications.unregisterForNotificationsAsync();
  } catch {
    // Nothing more this phone can do; the push function retires the token
    // once Apple reports it gone.
  }
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
