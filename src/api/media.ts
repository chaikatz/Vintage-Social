import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { File } from "expo-file-system";
import { decode } from "base64-arraybuffer";
import { supabase } from "@/lib/supabase";

/**
 * Media pipeline: optimize on-device, upload originals-free.
 *
 * Photos are baked (filter applied) at up to screen resolution by the GL
 * renderer, then normalized here: the full image capped at 1440px and a
 * 480px thumbnail for grids, both JPEG. Videos upload as recorded (capped
 * at 60s by the picker) with a poster-frame thumbnail.
 */

export const FEED_IMAGE_MAX = 1440;
export const THUMB_MAX = 480;

export interface PreparedImage {
  uri: string;
  width: number;
  height: number;
}

async function resizeJpeg(uri: string, maxDim: number, compress: number): Promise<PreparedImage> {
  const ctx = ImageManipulator.ImageManipulator.manipulate(uri);
  const image = await ctx.renderAsync();
  const { width, height } = image;
  const scale = Math.min(1, maxDim / Math.max(width, height));
  if (scale < 1) {
    ctx.resize(
      width >= height
        ? { width: Math.round(width * scale) }
        : { height: Math.round(height * scale) },
    );
  }
  const rendered = await ctx.renderAsync();
  const saved = await rendered.saveAsync({
    compress,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

export function prepareFeedImage(uri: string): Promise<PreparedImage> {
  return resizeJpeg(uri, FEED_IMAGE_MAX, 0.85);
}

export function prepareThumbnail(uri: string): Promise<PreparedImage> {
  return resizeJpeg(uri, THUMB_MAX, 0.8);
}

export function prepareAvatar(uri: string): Promise<PreparedImage> {
  return resizeJpeg(uri, 512, 0.85);
}

export type Bucket = "avatars" | "media" | "thumbnails";

export async function uploadFile(
  bucket: Bucket,
  path: string,
  localUri: string,
  contentType: string,
): Promise<string> {
  let body: ArrayBuffer;
  if (Platform.OS === "web") {
    // expo-file-system's File API is native-only; browsers read blob/data
    // uris through fetch.
    body = await (await fetch(localUri)).arrayBuffer();
  } else {
    const base64 = await new File(localUri).base64();
    body = decode(base64);
  }
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, body, { contentType, upsert: true });
  if (error) throw error;
  return path;
}

/**
 * Resolve a stored media path to a display URL. Seed/demo data uses
 * absolute URLs (https, blob:, data:); real uploads store bucket-relative
 * paths.
 */
export function mediaUrl(bucket: Bucket, path: string | null): string | null {
  if (!path) return null;
  if (/^(https?:|blob:|data:|file:)/.test(path)) return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}
