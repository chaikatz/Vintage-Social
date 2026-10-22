import { Platform } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { showAlert } from "@/utils/alert";
import { prepareForDarkroom } from "@/api/media";
import { captureDateForAsset } from "@/utils/captureDate";
import { MAX_VIDEO_SECONDS } from "@/utils/validation";

/**
 * The ordinary ways to a new post — the system picker and the camera —
 * ending in the parameters the editor opens on. Shared by the Post tab and
 * the Darkroom's "Library", so there is one way a picked photograph
 * reaches the editor, not two.
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

export async function paramsForPicked(asset: ImagePicker.ImagePickerAsset, mediaType: "photo" | "video"): Promise<PickedParams> {
  // EXIF first, then the photo library — video carries no EXIF at all, so
  // the library is the only place its real date exists.
  const takenAt = await captureDateForAsset(asset);
  // A photograph arrives as the picker found it — HEIC or JPEG, perhaps
  // stored on its side — so it is decoded properly first: orientation
  // applied, longest side capped, saved as JPEG the renderer can read.
  // The size that comes back is the upright one the editor frames by.
  let { uri, width, height } = asset;
  if (mediaType === "photo") {
    try {
      const ready = await prepareForDarkroom(uri);
      uri = ready.uri;
      width = ready.width;
      height = ready.height;
    } catch {
      // Fall through with the original; the editor reports what it can't read.
    }
  }
  return {
    uri,
    mediaType,
    width: String(width ?? 0),
    height: String(height ?? 0),
    duration: String(asset.duration != null ? Math.round(asset.duration / 1000) : 0),
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
    exif: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  if (isVideo && asset.duration != null && asset.duration > (MAX_VIDEO_SECONDS + 1) * 1000) {
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
    exif: true,
  });
  if (result.canceled || !result.assets[0]) return null;
  return paramsForPicked(result.assets[0], "photo");
}
