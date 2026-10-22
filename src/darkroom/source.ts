import { Platform } from "react-native";
import { isDemoMode } from "@/lib/env";
import { nativeSource } from "./nativeSource";
import type { LibrarySource } from "./types";

/**
 * Which library the Darkroom reads: the iPhone's own — in a demo build
 * too, since that is the library worth testing it with — and the bundled
 * demo library in the browser review build. Nowhere else: Android has no
 * Photos subtypes to tell a screenshot from a photograph, and no `ph://`
 * address for the image view to draw from, and a browser outside the
 * demo has no library at all.
 */
export function darkroomAvailable(): boolean {
  return Platform.OS === "ios" || (Platform.OS === "web" && isDemoMode());
}

export function darkroomSource(): LibrarySource | null {
  if (Platform.OS === "ios") return nativeSource;
  if (Platform.OS !== "web") return null;
  if (!isDemoMode()) return null;
  // Required lazily so the phone's bundle never evaluates the demo library.
  return (require("./demoSource") as typeof import("./demoSource")).demoSource;
}
