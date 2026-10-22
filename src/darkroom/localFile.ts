import { File } from "expo-file-system";
import { getAssetInfoAsync } from "expo-media-library";
import { prepareForDarkroom } from "@/api/media";
import type { NativeDevelopResult } from "./nativeLibrary";

/**
 * Develop's fallback, for a binary without `modules/vintage-library`: a
 * dev client built before the module existed. A release binary always has
 * the module and never comes here.
 *
 * Without the module, the only way to know whether a photograph's original
 * is on the phone, without bringing it down from iCloud, is to ask the
 * photo library for the asset's file with the network turned off. That
 * call is made here and nowhere else in the Darkroom. It answers with far
 * more than the Darkroom wants: the place the photograph was taken, the
 * camera's own record, and for a Live Photo its video, written out to a
 * temporary file. Exactly two of its answers are read, the local file's
 * address and whether the original is kept in iCloud. The Live Photo's
 * video is deleted the moment it is seen; nothing else is looked at.
 *
 * The local file is then decoded the way a photograph from the ordinary
 * picker is (`prepareForDarkroom`): upright, long side capped, a JPEG with
 * nothing of the original carried over. The answer comes back in the
 * module's own terms, so `develop.ts` treats both paths alike.
 */
export async function localFileFor(id: string, signal?: AbortSignal): Promise<NativeDevelopResult> {
  let info: Awaited<ReturnType<typeof getAssetInfoAsync>> | null;
  try {
    info = await getAssetInfoAsync(id, { shouldDownloadFromNetwork: false });
  } catch (error) {
    return /not found/i.test(messageOf(error)) ? { status: "missing" } : { status: "failed" };
  }
  // The library answers nothing at all for an identifier it no longer has.
  if (!info) return { status: "missing" };

  removeTemporary(info.pairedVideoAsset?.uri);

  const localUri = info.localUri;
  if (!localUri) return info.isNetworkAsset ? { status: "inCloud" } : { status: "failed" };
  // The member stopped, or develop gave up waiting: no copy is made.
  if (signal?.aborted) return { status: "failed" };
  try {
    const ready = await prepareForDarkroom(localUri);
    return { status: "ok", uri: ready.uri, width: ready.width, height: ready.height };
  } catch {
    return { status: "failed" };
  }
}

function removeTemporary(uri: string | null | undefined): void {
  if (typeof uri !== "string" || !uri.startsWith("file:")) return;
  try {
    const file = new File(uri);
    if (file.exists) file.delete();
  } catch {
    // It lives in the temporary folder, which iOS empties on its own.
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}
