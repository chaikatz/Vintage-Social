import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import type {
  DevelopImageOptions,
  DevelopProgressEvent,
  NativeDevelopResult,
  VintageLibraryModule,
} from "../../modules/vintage-library";

/**
 * The Darkroom's own native module, `modules/vintage-library`, and the few
 * typed calls made on it.
 *
 * The module asks Photos for a 2048-pixel rendition of one photograph,
 * from the phone first and from iCloud only when the member has said so,
 * and writes it upright as a plain JPEG. That keeps a 48-megapixel decode
 * away from the editor and makes no download the member did not ask for.
 * It is loaded optionally: the browser demo has no Photos, and a dev client
 * built before the module existed falls back to `localFile.ts`. A release
 * binary always has it.
 *
 * Whatever the module answers is held to the four shapes below before
 * anyone sees it, and every call here settles rather than throws, so the
 * room never has to guard against a native surprise.
 */

export type { NativeDevelopResult } from "../../modules/vintage-library";
export type VintageLibraryNative = VintageLibraryModule;

let loaded: VintageLibraryNative | null | undefined;

/** The module, or null in the browser and in a binary built without it. */
export function libraryModule(): VintageLibraryNative | null {
  if (loaded === undefined) {
    loaded = Platform.OS === "ios" ? requireOptionalNativeModule<VintageLibraryNative>("VintageLibrary") : null;
  }
  return loaded;
}

const FAILED: NativeDevelopResult = { status: "failed" };

/** Develops one photograph. A rejection, or an answer of any other shape, is `failed`. */
export async function developImage(
  mod: VintageLibraryNative,
  id: string,
  options: DevelopImageOptions,
): Promise<NativeDevelopResult> {
  try {
    return readResult(await mod.developImage(id, options));
  } catch {
    return FAILED;
  }
}

function readResult(raw: unknown): NativeDevelopResult {
  const result = raw as { status?: unknown; uri?: unknown; width?: unknown; height?: unknown } | null;
  switch (result?.status) {
    case "ok": {
      const { uri, width, height } = result;
      if (typeof uri !== "string" || !uri) return FAILED;
      if (typeof width !== "number" || typeof height !== "number") return FAILED;
      if (!(width > 0) || !(height > 0)) return FAILED;
      return { status: "ok", uri, width, height };
    }
    case "inCloud":
      return { status: "inCloud" };
    case "missing":
      return { status: "missing" };
    default:
      return FAILED;
  }
}

/**
 * Asks Photos to stop a develop. The develop's own promise then settles as
 * `failed` straight away; nothing waits for this one.
 */
export function cancelDevelop(mod: VintageLibraryNative, requestId: string): void {
  try {
    mod.cancelDevelop(requestId).catch(() => undefined);
  } catch {
    // Nothing in flight to stop, or nothing to stop it with.
  }
}

/**
 * Listens for one develop's download progress, as a fraction from 0 to 1.
 * Events for any other request are not passed on. Returns the way to stop
 * listening.
 */
export function onDevelopProgress(
  mod: VintageLibraryNative,
  requestId: string,
  listener: (fraction: number) => void,
): () => void {
  if (typeof mod.addListener !== "function") return () => undefined;
  let subscription: { remove(): void } | null = null;
  try {
    subscription = mod.addListener("onDevelopProgress", (event: DevelopProgressEvent) => {
      if (event?.requestId !== requestId) return;
      const progress = Number(event.progress);
      if (!Number.isFinite(progress)) return;
      listener(Math.min(1, Math.max(0, progress)));
    });
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      subscription?.remove();
    } catch {
      // Already gone with the module.
    }
    subscription = null;
  };
}

/**
 * Which of these identifiers still resolve in the library, in the order
 * given. Rejects when the library cannot be read (the caller then knows
 * nothing, which is different from knowing they are gone). Under limited
 * access an identifier that is no longer shared does not resolve either.
 */
export async function existing(mod: VintageLibraryNative, ids: readonly string[]): Promise<string[]> {
  const found: unknown = await mod.existing([...ids]);
  // An answer of any other shape says nothing, and must not read as "all gone".
  if (!Array.isArray(found)) throw new Error("The library gave no list");
  return found.filter((id): id is string => typeof id === "string");
}
