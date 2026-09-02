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
 * It stays best-effort throughout: no permission, no asset id, a library
 * that does not know — all of them return null and the stamp falls back to
 * the posting time, which is what it did before.
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
    let permission = await MediaLibrary.getPermissionsAsync();
    if (!permission.granted && permission.canAskAgain) {
      permission = await MediaLibrary.requestPermissionsAsync();
    }
    if (!permission.granted) return null;

    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    return captureDateFromEpoch(info?.creationTime);
  } catch {
    // A date stamp is never worth failing a post over.
    return null;
  }
}
