import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { isDemoMode } from "@/lib/env";
import { deleteDiskCache, readDiskCache, writeDiskCache } from "./diskCache";

/**
 * The push token this phone has filed, and the phone's way to stop
 * receiving. Filing and removing the token's row is push.ts's, through
 * the api; this part needs neither, so the auth listener made with the
 * client (src/lib/supabase.ts) can use it without importing its own
 * client back through the api.
 */

/** The one token this launch has filed, once known, so sign-out can drop it. */
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
 * token cannot be removed (push.ts).
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

/** The token about to be filed: known, and kept, before the filing can fail. */
export function noteToken(token: string): void {
  currentToken = token;
  writeDiskCache(TOKEN_FILE, TOKEN_KEY, { v: 1, token } satisfies KeptToken, IN_CACHE);
}

/** The token sign-out should remove: this launch's, or failing that the one kept. */
export function takeToken(): string | null {
  const token = currentToken ?? keptToken();
  currentToken = null;
  return token;
}

/** Its row has been removed: nothing left to act on. */
export function tokenRemoved(): void {
  deleteDiskCache(TOKEN_FILE, TOKEN_KEY, IN_CACHE);
}

/** Whether this phone can be pushed to at all. */
export function pushSupported(): boolean {
  return Platform.OS !== "web" && !isDemoMode() && Device.isDevice;
}

/**
 * Unregister this phone from push notifications, and forget its token.
 * Only when a token was filed from it, or when it may receive at all.
 */
export async function stopReceiving(filed: boolean): Promise<void> {
  tokenRemoved();
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
 * The session has left this phone without a sign-out made on it (a
 * refresh token the server refused: a sign-out or a password change on
 * another device). There is no session to remove the row with, so if
 * this phone filed a token that sign-out did not take away, the phone
 * stops receiving.
 *
 * Called by the auth listener made with the client (src/lib/supabase.ts),
 * not the session provider's: a refresh refused at launch says SIGNED_OUT
 * once, to whoever is listening by then, which can be before the
 * provider has subscribed.
 */
export async function pushAfterSignedOut(): Promise<void> {
  currentToken = null;
  if (keptToken() == null) return;
  await stopReceiving(true);
}
