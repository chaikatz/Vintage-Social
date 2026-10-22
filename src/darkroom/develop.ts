import { Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import NetInfo from "@react-native-community/netinfo";
import { printFileUri } from "./printSource";
import { prepareForDarkroom } from "@/api/media";
import { captureDateFromEpoch } from "@/utils/exif";
import type { Print } from "./types";

/**
 * Develop: from a print in the Darkroom to the ordinary editor.
 *
 * The library hands over the original file — HEIC, perhaps on its side,
 * perhaps only in iCloud. It is read without touching the network first;
 * only if Photos says the original lives in iCloud is it fetched, and the
 * screen says so while it is. Then it is decoded properly (orientation
 * applied, long side capped, JPEG), exactly as a photograph picked from
 * the ordinary picker is, and the editor opens on it with the date the
 * shutter fired. Nothing is uploaded here: the editor's own "Share to
 * VINTAGE" is still the only door out.
 *
 * The photograph's location is not read. VINTAGE does not read location
 * from photographs (see the Privacy Policy); the place on a post is the
 * one the member names in the editor.
 */

export type DevelopStage = "reading" | "icloud" | "preparing";
export type DevelopFailure = "missing" | "icloud" | "offline" | "unreadable";

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

/** How long an iCloud original may take to come down before the member is told. */
const ICLOUD_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | "timeout"> {
  return Promise.race([promise, new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), ms))]);
}

export async function develop(print: Print, onStage: (stage: DevelopStage) => void = () => undefined): Promise<DevelopOutcome> {
  const takenAt = captureDateFromEpoch(print.takenAt) ?? "";
  // The browser demo's prints are bundled images: no library to read.
  if (typeof print.uri === "number" || Platform.OS === "web") {
    try {
      const uri = printFileUri(print.uri);
      if (!uri) return { ok: false, reason: "missing" };
      return {
        ok: true,
        params: { uri, mediaType: "photo", width: String(print.width), height: String(print.height), duration: "0", takenAt, assetId: print.id, from: "darkroom" },
      };
    } catch {
      return { ok: false, reason: "unreadable" };
    }
  }

  onStage("reading");
  let info: MediaLibrary.AssetInfo | null;
  try {
    info = await MediaLibrary.getAssetInfoAsync(print.id, { shouldDownloadFromNetwork: false });
  } catch {
    return { ok: false, reason: "missing" };
  }
  if (!info) return { ok: false, reason: "missing" };

  let original = info.localUri ?? null;
  if (!original && info.isNetworkAsset) {
    // The original is in iCloud. Offline, say so at once rather than wait out a timeout.
    const net = await NetInfo.fetch().catch(() => null);
    if (net && net.isConnected === false) return { ok: false, reason: "offline" };
    onStage("icloud");
    try {
      const fetched = await withTimeout(MediaLibrary.getAssetInfoAsync(print.id, { shouldDownloadFromNetwork: true }), ICLOUD_TIMEOUT_MS);
      original = fetched === "timeout" ? null : fetched?.localUri ?? null;
    } catch {
      original = null;
    }
    if (!original) return { ok: false, reason: "icloud" };
  }
  if (!original) return { ok: false, reason: "unreadable" };

  onStage("preparing");
  try {
    const ready = await prepareForDarkroom(original);
    return {
      ok: true,
      params: {
        uri: ready.uri,
        mediaType: "photo",
        width: String(ready.width),
        height: String(ready.height),
        duration: "0",
        takenAt: captureDateFromEpoch(info.creationTime ?? print.takenAt) ?? takenAt,
        assetId: print.id,
        from: "darkroom",
      },
    };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
