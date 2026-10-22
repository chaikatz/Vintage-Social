import { Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import type { ImagePickerAsset } from "expo-image-picker";
import { captureDateFrom, captureDateFromEpoch } from "./exif";

/**
 * When the shutter actually fired, for the amber date stamp.
 *
 * Photographs carry it in EXIF and that is the best answer — it is what the
 * camera itself recorded. Video does not: there is no EXIF block in a movie
 * file, and expo-image-picker returns no `exif` for one at all, which is why
 * every video used to be stamped with the day it was posted.
 *
 * The photo library knows anyway. Every picked asset has an id, and the
 * library stores a creation date against it, so a second lookup gets the
 * real date for video and for the stripped-metadata photographs that used to
 * fall through as well.
 *
 * It stays best-effort throughout: no permission (it is never asked for
 * here), no asset id, a library that does not know — all of them return
 * null and the stamp falls back to the posting time.
 */
export async function captureDateForAsset(
  asset: Pick<ImagePickerAsset, "exif" | "assetId">,
): Promise<string | null> {
  const fromExif = captureDateFrom(asset.exif);
  if (fromExif) return fromExif;
  return libraryCreationTime(asset.assetId);
}

async function libraryCreationTime(assetId: string | null | undefined): Promise<string | null> {
  // The photo library module is native-only; the browser picker hands over a
  // blob with no library behind it.
  if (!assetId || Platform.OS === "web") return null;
  try {
    // Only if access was already given. The ordinary picker needs no
    // library permission, and asking for the whole library in the middle of
    // picking one photograph is a prompt nobody was told about. The Darkroom
    // asks, with an explanation, when the member walks into it.
    const permission = await MediaLibrary.getPermissionsAsync();
    if (!permission.granted) return null;

    // Only the date is wanted, and the library knows it without the file:
    // never bring an original down from iCloud just to read when it was taken.
    const info = await MediaLibrary.getAssetInfoAsync(assetId, { shouldDownloadFromNetwork: false });
    return captureDateFromEpoch(info?.creationTime);
  } catch {
    // A date stamp is never worth failing a post over.
    return null;
  }
}
