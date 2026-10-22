import { Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { File } from "expo-file-system";
import { prepareForDarkroom } from "@/api/media";
import { captureDateFromEpoch } from "@/utils/exif";
import { printFileUri } from "./printSource";
import type { Print } from "./types";

/**
 * Develop: from a print in the Darkroom to the ordinary editor.
 *
 * The photograph is read straight from Photos by its `ph://` address, the
 * way the image manipulator reads one: the current version (with the
 * member's own crops and edits), the still only — never a Live Photo's
 * video — and brought down from iCloud if that is where the original is.
 * It is then decoded properly (orientation applied, long side capped,
 * JPEG with no metadata carried over), exactly as a photograph picked
 * from the ordinary picker is, and the editor opens on it with the date
 * the shutter fired, which the library already gave the Darkroom.
 *
 * Nothing else is asked of the library here. In particular the asset-info
 * call is not used: it hands over the photograph's location and EXIF, and
 * for a Live Photo fetches and writes its video. VINTAGE does not read
 * location from photographs (see the Privacy Policy), so the Darkroom never
 * holds it. Nothing is uploaded either: the editor's own "Share to VINTAGE"
 * is still the only door out.
 */

export type DevelopStage = "reading" | "icloud";
export type DevelopFailure = "missing" | "icloud" | "offline" | "unreadable" | "cancelled";

export interface ComposeParams {
  [key: string]: string;
  uri: string;
  mediaType: "photo";
  width: string;
  height: string;
  duration: string;
  takenAt: string;
  /** The library identifier, so the Darkroom knows later that this one was posted. */
  assetId: string;
  /** The editor was opened from the Darkroom. */
  from: "darkroom";
}

export type DevelopOutcome = { ok: true; params: ComposeParams } | { ok: false; reason: DevelopFailure };

/** A local photograph decodes well inside this; past it, it is probably coming down from iCloud. */
export const ICLOUD_SUSPECTED_AFTER_MS = 1500;
/** How long an iCloud original may take to come down before the member is told it didn't. */
export const DEVELOP_TIMEOUT_MS = 90_000;

export interface DevelopOptions {
  onStage?: (stage: DevelopStage) => void;
  /** True once the member has asked to stop waiting. */
  cancelled?: () => boolean;
  /** The print's image already failed to draw because the photograph is gone. */
  known_missing?: boolean;
  timeoutMs?: number;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

function forget(uri: string | null | undefined): void {
  if (!uri || !uri.startsWith("file:")) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // A temporary copy left behind is cleared with the cache.
  }
}

function paramsFor(print: Print, uri: string, width: number, height: number): ComposeParams {
  return {
    uri,
    mediaType: "photo",
    width: String(width),
    height: String(height),
    duration: "0",
    takenAt: captureDateFromEpoch(print.takenAt) ?? "",
    assetId: print.id,
    from: "darkroom",
  };
}

export async function develop(print: Print, opts: DevelopOptions = {}): Promise<DevelopOutcome> {
  const { onStage = () => undefined, cancelled = () => false, timeoutMs = DEVELOP_TIMEOUT_MS } = opts;
  if (opts.known_missing) return { ok: false, reason: "missing" };

  // The browser demo's prints are bundled images: no library to read.
  if (Platform.OS === "web" || typeof print.uri !== "string" || !print.uri.startsWith("ph://")) {
    const uri = printFileUri(print.uri);
    return uri ? { ok: true, params: paramsFor(print, uri, print.width, print.height) } : { ok: false, reason: "missing" };
  }

  onStage("reading");
  const slow = setTimeout(() => {
    if (!cancelled()) onStage("icloud");
  }, ICLOUD_SUSPECTED_AFTER_MS);
  const work = prepareForDarkroom(print.uri);
  let ready: Awaited<typeof work> | "timeout" | null = null;
  try {
    ready = await withTimeout(work, timeoutMs);
  } catch {
    ready = null;
  } finally {
    clearTimeout(slow);
  }

  if (cancelled()) {
    // The photograph may still arrive after the member stopped waiting; its copy is not kept.
    if (ready && ready !== "timeout") forget(ready.uri);
    else work.then((late) => forget(late.uri)).catch(() => undefined);
    return { ok: false, reason: "cancelled" };
  }
  if (ready && ready !== "timeout") return { ok: true, params: paramsFor(print, ready.uri, ready.width, ready.height) };

  if (ready === "timeout") work.then((late) => forget(late.uri)).catch(() => undefined);
  const net = await NetInfo.fetch().catch(() => null);
  if (net && net.isConnected === false) return { ok: false, reason: "offline" };
  return { ok: false, reason: ready === "timeout" ? "icloud" : "unreadable" };
}

/** A developed copy that was not posted is not kept. */
export function discardDeveloped(uri: string | null | undefined): void {
  forget(uri);
}
