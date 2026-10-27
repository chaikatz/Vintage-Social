import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { showAlert } from "@/utils/alert";
import { prepareImage } from "@/media/nativeMedia";
import { captureDateForAsset } from "@/utils/captureDate";
import { clipSeconds, clipTooLong } from "@/utils/composeDraft";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * The ordinary ways to a new post — the system picker and the camera —
 * ending in the parameters the editor opens on. Shared by the Post tab and
 * the Darkroom's "Choose from your library", so there is one way a picked
 * photograph reaches the editor, not two.
 *
 * Neither asks for the photo library. The system picker needs no
 * permission: the member hands over one photograph, and its capture date
 * is read from that file's own EXIF. But iOS passes the file's metadata
 * over in one dictionary, GPS block and all — copied in as GPSLatitude,
 * GPSLongitude and the rest. So the moment the picker returns, the
 * dictionary is cut down to the few fields a capture date is read from,
 * and nothing else of it is kept or passed on: VINTAGE does not read
 * where a photograph was taken. A video carries no EXIF, so none is asked
 * for; its date comes from the library, and only when access has already
 * been given (`captureDateForAsset`).
 */

export interface PickedParams {
  [key: string]: string;
  uri: string;
  mediaType: "photo" | "video";
  width: string;
  height: string;
  duration: string;
  takenAt: string;
}

/**
 * The EXIF fields a capture date is read from (`captureDateFrom` in
 * utils/exif), and the only ones kept. Named one by one rather than by
 * pattern, so a field that only looks like a date can never come along.
 */
const DATE_FIELDS = ["DateTimeOriginal", "DateTimeDigitized", "{Exif}DateTimeOriginal", "DateTime"] as const;

function dateFields(from: Record<string, unknown>): Record<string, string> {
  const kept: Record<string, string> = {};
  for (const key of DATE_FIELDS) {
    const value = from[key];
    if (typeof value === "string") kept[key] = value;
  }
  return kept;
}

/**
 * A picked file's EXIF with everything but its dates taken out — no GPS,
 * no camera, no lens, nothing else. Some iOS payloads nest the EXIF block
 * rather than flattening it, so the nested block is cut down the same
 * way. Null when no date is left.
 */
export function datesOnly(exif: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!exif || typeof exif !== "object") return null;
  const kept: Record<string, unknown> = dateFields(exif);
  const nested = exif["{Exif}"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const inner = dateFields(nested as Record<string, unknown>);
    if (Object.keys(inner).length > 0) kept["{Exif}"] = inner;
  }
  return Object.keys(kept).length > 0 ? kept : null;
}

/** The picked asset as the rest of the app sees it: the same file, with only its dates left of the metadata. */
function withDatesOnly(asset: ImagePicker.ImagePickerAsset): ImagePicker.ImagePickerAsset {
  return { ...asset, exif: datesOnly(asset.exif) };
}

/**
 * The editor's working copy of a photograph: long enough on its long side
 * for the 1440 px bake to have room for the member's crop, and one JPEG
 * generation at a quality that leaves the renderer's grain as grain.
 */
export const PICKED_MAX_SIDE = 2048;
export const PICKED_QUALITY = 0.92;
/** A second try comes after a breath, so a file still being written, or a moment of memory pressure, has passed. */
const PREPARE_RETRY_PAUSE_MS = 250;

/**
 * A picked photograph decoded properly, or null when it could not be.
 *
 * It arrives as the picker found it, HEIC or JPEG, perhaps stored on its
 * side, so it is decoded straight to the editor's size with its
 * orientation applied, in sRGB, and saved as a JPEG with no metadata at
 * all. The size that comes back is the upright one the editor frames by.
 *
 * There is no falling back to the original. The renderer reads JPEG and
 * PNG only: handed a HEIC it draws a black frame and reports nothing, and
 * that black frame was baked and posted. So a failure is tried once more,
 * and then the member is told.
 */
async function prepareForEditor(uri: string): Promise<{ uri: string; width: number; height: number } | null> {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const ready = await prepareImage(uri, { maxSide: PICKED_MAX_SIDE, quality: PICKED_QUALITY });
      if (ready.uri && ready.width > 0 && ready.height > 0) {
        return { uri: ready.uri, width: ready.width, height: ready.height };
      }
    } catch {
      // Tried again below, then reported.
    }
    if (attempt === 1) await new Promise((resolve) => setTimeout(resolve, PREPARE_RETRY_PAUSE_MS));
  }
  return null;
}

/**
 * The editor's parameters for a picked asset. Null when a photograph could
 * not be made readable; the member has been told, and stays where they were.
 */
export async function paramsForPicked(
  asset: ImagePicker.ImagePickerAsset,
  mediaType: "photo" | "video",
): Promise<PickedParams | null> {
  // EXIF first, then the photo library — video carries no EXIF at all, so
  // the library is the only place its real date exists. Only the dates and
  // the library's identifier go on, whoever picked the asset.
  const takenAt = await captureDateForAsset({ exif: datesOnly(asset.exif), assetId: asset.assetId });
  let { uri, width, height } = asset;
  if (mediaType === "photo") {
    const ready = await prepareForEditor(uri);
    if (!ready) {
      showAlert("Couldn’t open that photograph", "It couldn’t be read here. Try again in a moment, or choose another.");
      return null;
    }
    ({ uri, width, height } = ready);
  }
  return {
    uri,
    mediaType,
    width: String(width ?? 0),
    height: String(height ?? 0),
    // Whole seconds, held to the 1 to 60 the posts table accepts; 0 when
    // the picker did not say.
    duration: String(clipSeconds(asset.duration)),
    // When the shutter actually fired, for the date stamp. Empty when
    // neither the file nor the library knew.
    takenAt: takenAt ?? "",
  };
}

/** The system picker. Null when cancelled or refused. */
export async function pickFromLibrary(mediaType: "photo" | "video"): Promise<PickedParams | null> {
  const isVideo = mediaType === "video";
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: isVideo ? ["videos"] : ["images"],
    // Photographs are not put through the system editor: on iOS it crops
    // to a square whatever aspect is asked for, which is what squeezed
    // every portrait into a box. The editor frames the picture itself, at
    // its own shape between 4:5 and 1.91:1, as a photo feed does. Videos
    // still open the system trimmer on iOS so a long clip can be cut to
    // length here instead of being picked and then refused.
    allowsEditing: isVideo && Platform.OS === "ios",
    quality: 1,
    // Only honoured alongside allowsEditing; it caps the trimmer.
    videoMaxDuration: MAX_VIDEO_SECONDS,
    // For the capture date only, and cut down to it below.
    exif: !isVideo,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = withDatesOnly(result.assets[0]);
  // On iOS the trimmer holds a clip to the minute already. Where there is
  // no trimmer a clip can be any length, and it is refused here, before
  // any of it is developed or uploaded.
  if (isVideo && clipTooLong(asset.duration)) {
    showAlert("Too long", `Videos on VINTAGE are at most ${MAX_VIDEO_SECONDS} seconds. Trim this one and try again.`);
    return null;
  }
  return paramsForPicked(asset, mediaType);
}

/** The camera. Null when cancelled or refused. */
export async function takeForCompose(): Promise<PickedParams | null> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    showAlert("Camera is off", "VINTAGE can only take a photograph if it may use the camera. You can allow this in Settings.");
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ["images"],
    allowsEditing: false, // the editor frames it; the system editor would crop it square
    quality: 1,
    // For the capture date only, and cut down to it below.
    exif: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  return paramsForPicked(withDatesOnly(result.assets[0]), "photo");
}
