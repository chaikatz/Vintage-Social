import { Platform } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "@/lib/supabase";
import { DEMO_PREFIX } from "@/demo/photos";
import { PHOTOS } from "@/demo/photoAssets";
import { prepareImage } from "@/media/nativeMedia";
import { IMMUTABLE_CACHE_SECONDS, SHORT_CACHE_SECONDS, uploadToStorage } from "@/uploads/storageUpload";
import { isTransient, withRetry, withTimeout } from "@/utils/retry";

export { ownedPath } from "@/utils/storagePath";

/**
 * Media pipeline: optimize on-device, upload originals-free.
 *
 * Photos are baked (filter applied) off screen by the GL renderer at up to
 * 1440 px, then normalized by the post outbox (src/uploads) with
 * `prepareImage`: one decode, straight to size, written as a metadata-free
 * JPEG, with the 480 px grid thumbnail cut in the same pass. Videos are
 * baked natively and get a poster-frame thumbnail. Every post upload is
 * streamed from the file by the phone (see `uploadFile`).
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

/**
 * The feed's copy of a photograph: at most 1440 px on the long side.
 *
 * Through `prepareImage`, which decodes straight to size with ImageIO at
 * user-initiated priority where the binary has it. expo-image-manipulator
 * decoded the whole original, redrew it once more to fix the orientation,
 * and did both at background priority, which iOS throttles hard in Low
 * Power Mode. `prepareImage` falls back to that same path where the native
 * function is missing, so the result is the same either way.
 */
export async function prepareFeedImage(uri: string): Promise<PreparedImage> {
  const out = await prepareImage(uri, { maxSide: FEED_IMAGE_MAX, quality: 0.85 });
  return { uri: out.uri, width: out.width, height: out.height };
}

/** The grid's 480 px copy. Cut it from the feed copy rather than the original: a smaller decode. */
export async function prepareThumbnail(uri: string): Promise<PreparedImage> {
  const out = await prepareImage(uri, { maxSide: THUMB_MAX, quality: 0.8 });
  return { uri: out.uri, width: out.width, height: out.height };
}

export function prepareAvatar(uri: string): Promise<PreparedImage> {
  return resizeJpeg(uri, 512, 0.85);
}

/** Longest side of a photograph handed to the darkroom. Well above what the
 * bake writes out, and within every iPhone's texture limit. */
export const DARKROOM_MAX = 2048;

/**
 * Make a photograph the filter renderer can read.
 *
 * The GL renderer loads its texture with a plain image decoder: no HEIC,
 * and no notion of EXIF orientation. The system picker hides this by
 * handing over an edited JPEG, but a file read straight out of the photo
 * library — On This Day, the roulette, the rest of a night's roll — is the
 * original: usually HEIC, usually shot with the phone held upright and
 * stored on its side. Fed to the renderer as-is that came out black, or
 * rotated and stretched into a portrait frame.
 *
 * So the library path goes through the same decoder the rest of iOS uses
 * first: orientation applied, HEIC read, longest side capped, saved as
 * JPEG. The dimensions returned are the upright ones, which is what the
 * preview frame and the post need.
 */
export function prepareForDarkroom(uri: string): Promise<PreparedImage> {
  return resizeJpeg(uri, DARKROOM_MAX, 0.95);
}

export type Bucket = "avatars" | "media" | "thumbnails";

export interface UploadFileOptions {
  /** Overwrite what is there. See below for why that is the avatars' alone. */
  upsert?: boolean;
  /**
   * Try again on a dropped connection, inside this call. On by default for
   * the screens that upload directly (an avatar). The post outbox passes
   * false: it has its own schedule, and retries stacked inside retries are
   * what made a flaky connection cost half a minute.
   */
  retry?: boolean;
  /** Bytes sent so far, of how many. Native only; the browser path has no progress. */
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /** See `StorageUploadOptions.clockRunning`. */
  clockRunning?: () => boolean;
  /** An access token already fetched for this batch of uploads. */
  accessToken?: string;
}

/**
 * The browser's upload has no progress and storage-js takes no signal, so
 * the most it can have is a limit on how long it is waited for.
 */
const WEB_UPLOAD_TIMEOUT_MS = 120_000;

/**
 * How long a cache may keep a file. Post media and thumbnails sit at keys
 * named by a fresh post id that never change, so a year. An avatar may be
 * overwritten in place (an application's {uid}/avatar.jpg), so it keeps
 * storage-js's own hour.
 */
function cacheSecondsFor(bucket: Bucket, upsert: boolean): number {
  return bucket === "avatars" || upsert ? SHORT_CACHE_SECONDS : IMMUTABLE_CACHE_SECONDS;
}

/**
 * Upload one file to a bucket.
 *
 * On the phone the file is streamed from disk by URLSession
 * (`uploadToStorage`) and never enters JavaScript. The previous path read
 * it with File.bytes(), which fetch then copied, and React Native's
 * networking base64-encoded on the JS thread before native decoded it
 * again: the opposite of the "straight bytes" it was meant to be, and
 * seconds of a blocked thread for a clip. In the browser the file is read
 * through fetch and handed to supabase-js, as before.
 *
 * `upsert` defaults to false and should stay that way for anything keyed by
 * a fresh id. Post media is written to {uid}/{postId}.jpg, so a collision
 * would mean a uuid clash and ought to fail loudly rather than quietly
 * overwrite a photograph. Avatars are the one genuine overwrite: they live
 * at the fixed path {uid}/avatar.jpg and replace the previous picture.
 *
 * Storage answering "already exists" counts as success, on any attempt.
 * Every caller names its file freshly (a new post id, a timestamped
 * avatar), so the object being there means an earlier attempt landed and
 * only its reply was lost, including one from before the app was closed.
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
  options: UploadFileOptions = {},
): Promise<string> {
  const { upsert = false, retry = true } = options;
  const cacheSeconds = cacheSecondsFor(bucket, upsert);
  const once = async (): Promise<void> => {
    if (Platform.OS !== "web") {
      await uploadToStorage(bucket, path, localUri, contentType, {
        upsert,
        cacheControlSeconds: cacheSeconds,
        onProgress: options.onProgress,
        signal: options.signal,
        clockRunning: options.clockRunning,
        accessToken: options.accessToken,
      });
      return;
    }
    // expo-file-system's File API is native-only; browsers read blob/data
    // uris through fetch.
    await withTimeout(
      WEB_UPLOAD_TIMEOUT_MS,
      async () => {
        const body = await (await fetch(localUri)).arrayBuffer();
        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, body, { contentType, upsert, cacheControl: String(cacheSeconds) });
        if (!error) return;
        if (!upsert && isAlreadyThere(error)) return;
        throw error;
      },
      { signal: options.signal, what: "The upload" },
    );
  };
  if (retry) await withRetry(once);
  else await once();
  return path;
}

function isAlreadyThere(err: unknown): boolean {
  const e = err as { statusCode?: unknown; status?: unknown; message?: unknown; error?: unknown };
  const status = Number(e.statusCode ?? e.status ?? NaN);
  const text = `${String(e.message ?? "")} ${String(e.error ?? "")}`.toLowerCase();
  return status === 409 || /already exists|duplicate/.test(text);
}

export { isTransient };

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
