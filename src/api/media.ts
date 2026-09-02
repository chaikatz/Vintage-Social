import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { File } from "expo-file-system";
import { decode } from "base64-arraybuffer";
import { supabase } from "@/lib/supabase";
import { DEMO_PREFIX } from "@/demo/photos";
import { PHOTOS } from "@/demo/photoAssets";

export { ownedPath } from "@/utils/storagePath";

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

/**
 * Upload one file to a bucket.
 *
 * `upsert` defaults to false and should stay that way for anything keyed by
 * a fresh id. Post media is written to {uid}/{postId}.jpg, so a collision
 * would mean a uuid clash and ought to fail loudly rather than quietly
 * overwrite a photograph. Avatars are the one genuine overwrite: they live
 * at the fixed path {uid}/avatar.jpg and replace the previous picture.
 *
 * Note that an upsert also costs more than it looks: the storage API turns
 * it into `insert ... on conflict do update`, which makes PostgreSQL apply
 * the SELECT policy on storage.objects as well as the insert one. Migration
 * 0009 adds that policy; without it every upsert is refused.
 */
export async function uploadFile(
  bucket: Bucket,
  path: string,
  localUri: string,
  contentType: string,
  { upsert = false }: { upsert?: boolean } = {},
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
    .upload(path, body, { contentType, upsert });
  if (error) throw error;
  return path;
}



/**
 * Resolve a stored media path to a display URL. Seed/demo data uses
 * absolute URLs (https, blob:, data:); real uploads store bucket-relative
 * paths.
 */
export function mediaUrl(bucket: Bucket, path: string | null): string | number | null {
  if (!path) return null;
  // Demo-mode photographs are bundled with the app; Metro hands back a
  // module id, which the image components accept directly.
  if (path.startsWith(DEMO_PREFIX)) return PHOTOS[path.slice(DEMO_PREFIX.length)] ?? null;
  if (/^(https?:|blob:|data:|file:)/.test(path)) return path;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Same as mediaUrl, for the places that need a plain URL string (video). */
export function mediaUrlString(bucket: Bucket, path: string | null): string | null {
  const url = mediaUrl(bucket, path);
  return typeof url === "string" ? url : null;
}
