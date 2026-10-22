import { Linking, Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import { isDemoMode } from "@/lib/env";

/**
 * Whether the Darkroom may look at the photo library, in the five states
 * that each need a different word.
 *
 *   unavailable    no library here (the browser, outside the demo)
 *   undetermined   never asked — explain first, then let iOS ask
 *   denied         refused; only Settings can change it
 *   limited        a chosen selection; works, but sees only that
 *   full           the whole library
 *
 * Asking is only ever done from a tap on the Darkroom's own explanation,
 * never on the way past it.
 */
export type LibraryAccess = "unavailable" | "undetermined" | "denied" | "limited" | "full";

export function accessFrom(p: {
  status: string;
  granted: boolean;
  accessPrivileges?: "all" | "limited" | "none";
}): LibraryAccess {
  if (p.granted) return p.accessPrivileges === "limited" ? "limited" : "full";
  if (p.status === "undetermined") return "undetermined";
  return "denied";
}

/** The browser review build reads its demo library, which is always open. */
function demoLibrary(): boolean {
  return Platform.OS === "web" && isDemoMode();
}

export async function readAccess(): Promise<LibraryAccess> {
  if (demoLibrary()) return "full";
  if (Platform.OS === "web") return "unavailable";
  try {
    return accessFrom(await MediaLibrary.getPermissionsAsync(false, ["photo"]));
  } catch {
    return "unavailable";
  }
}

/** Show iOS's own question, if it may still be asked. */
export async function requestAccess(): Promise<LibraryAccess> {
  if (demoLibrary()) return "full";
  if (Platform.OS === "web") return "unavailable";
  try {
    const now = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
    if (now.granted || !now.canAskAgain) return accessFrom(now);
    return accessFrom(await MediaLibrary.requestPermissionsAsync(false, ["photo"]));
  } catch {
    return "unavailable";
  }
}

/** iOS's own sheet for changing a limited selection. */
export async function chooseMorePhotographs(): Promise<void> {
  if (Platform.OS !== "ios") return;
  try {
    await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
  } catch {
    // Nothing to do: the selection stays as it was.
  }
}

export function openPhotoSettings(): void {
  Linking.openSettings().catch(() => undefined);
}
