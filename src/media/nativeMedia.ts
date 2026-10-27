import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as ImageManipulator from "expo-image-manipulator";
import { perfLog } from "@/utils/perf";
import type {
  NativePrepareImageOptions,
  NativePreparedFile,
  VintageLibraryModule,
} from "../../modules/vintage-library";

/**
 * Preparing a photograph to post: the upload JPEG at its final size, and
 * its thumbnail, from one decode.
 *
 * On iOS this is `prepareImage` in `modules/vintage-library`. ImageIO
 * decodes straight to the size wanted (a HEIC in hardware) with the EXIF
 * orientation applied, the pixels are converted to sRGB so a Display P3
 * photograph keeps its colours, and the JPEG is written with no metadata,
 * at user-initiated priority. The image manipulator it replaces decoded the
 * whole original and redrew it once more for orientation, at background
 * priority, which iOS starves in Low Power Mode.
 *
 * A binary built before `prepareImage` existed, the browser build, and any
 * source the native side refuses (a `ph://` address, a file it cannot
 * read) all take the image manipulator instead, exactly as `resizeJpeg` in
 * `src/api/media.ts` does, so a photograph is never refused here that was
 * accepted before.
 */

export interface PrepareImageOptions {
  /** Longest side of the prepared JPEG, in pixels. Never enlarges. */
  maxSide: number;
  /** JPEG quality, 0 to 1. Default `PREPARE_QUALITY`. */
  quality?: number;
  /** Longest side of a thumbnail made from the prepared pixels. None when absent. */
  thumbSide?: number;
  /** Default `THUMB_QUALITY`. */
  thumbQuality?: number;
}

export interface PreparedFile {
  uri: string;
  width: number;
  height: number;
}

export interface PreparedImage extends PreparedFile {
  thumb?: PreparedFile;
  /** Which way it was made, for dev timing logs. */
  via?: "native" | "manipulator";
}

export const PREPARE_QUALITY = 0.9;
export const THUMB_QUALITY = 0.8;

type PreparingModule = VintageLibraryModule & Required<Pick<VintageLibraryModule, "prepareImage">>;

let loaded: VintageLibraryModule | null | undefined;

/** The module when it can prepare, else null: off iOS, without the module, or from a binary built before it. */
function preparingModule(): PreparingModule | null {
  if (loaded === undefined) {
    loaded = Platform.OS === "ios" ? requireOptionalNativeModule<VintageLibraryModule>("VintageLibrary") : null;
  }
  return loaded && typeof loaded.prepareImage === "function" ? (loaded as PreparingModule) : null;
}

export function hasNativePrepare(): boolean {
  return preparingModule() != null;
}

/**
 * Decode a local image straight to size (ImageIO thumbnail with the EXIF
 * transform), convert it to sRGB, and write a metadata-free JPEG, at
 * userInitiated QoS. Uses VintageLibrary.prepareImage when the binary has
 * it, otherwise falls back to expo-image-manipulator (the existing
 * resizeJpeg behaviour), and on web to the same.
 * Optionally also writes a thumbnail in the same decode.
 */
export async function prepareImage(uri: string, opts: PrepareImageOptions): Promise<PreparedImage> {
  if (!(opts.maxSide > 0) || !Number.isFinite(opts.maxSide)) {
    throw new Error("prepareImage needs a positive maxSide");
  }
  const quality = unit(opts.quality, PREPARE_QUALITY);
  const thumbQuality = unit(opts.thumbQuality, THUMB_QUALITY);
  const thumbSide = opts.thumbSide != null && opts.thumbSide > 0 && Number.isFinite(opts.thumbSide) ? opts.thumbSide : 0;

  const native = preparingModule();
  if (native && isLocalFile(uri)) {
    // Every key has a value: the native record refuses one sent as undefined.
    const options: NativePrepareImageOptions = { maxSide: opts.maxSide, quality, thumbSide, thumbQuality };
    try {
      const prepared = readNative(await native.prepareImage(uri, options), thumbSide > 0);
      if (prepared) return { ...prepared, via: "native" };
      perfLog("prepare native answered short");
    } catch (error) {
      // A file ImageIO cannot read may still be one the manipulator can;
      // the post goes on either way. The code says why, in development;
      // the path is the member's and is not logged.
      perfLog("prepare native failed", { code: (error as { code?: unknown } | null)?.code ?? null });
    }
  }
  return manipulate(uri, opts.maxSide, quality, thumbSide, thumbQuality);
}

/** `file://` or an absolute path: what the native side can open itself. */
function isLocalFile(uri: string): boolean {
  return uri.startsWith("file://") || uri.startsWith("/");
}

function unit(value: number | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(1, value);
}

function readFile(raw: unknown): PreparedFile | null {
  const r = raw as Partial<NativePreparedFile> | null;
  if (!r || typeof r.uri !== "string" || !r.uri) return null;
  if (typeof r.width !== "number" || typeof r.height !== "number") return null;
  if (!(r.width > 0) || !(r.height > 0)) return null;
  return { uri: r.uri, width: r.width, height: r.height };
}

/** The native answer held to its shape. One missing the thumbnail it was asked for counts as no answer. */
function readNative(raw: unknown, wantThumb: boolean): PreparedImage | null {
  const main = readFile(raw);
  if (!main) return null;
  if (!wantThumb) return main;
  const thumb = readFile((raw as { thumb?: unknown }).thumb);
  return thumb ? { ...main, thumb } : null;
}

/**
 * The image manipulator, as `resizeJpeg` uses it: render once to learn the
 * upright size, resize the long side if it is over, save as JPEG. The
 * thumbnail continues the same context, so it is made from the prepared
 * pixels rather than from a second decode of the original.
 */
async function manipulate(
  uri: string,
  maxSide: number,
  quality: number,
  thumbSide: number,
  thumbQuality: number,
): Promise<PreparedImage> {
  const context = ImageManipulator.ImageManipulator.manipulate(uri);
  const refs: { release?: () => void }[] = [context];
  try {
    const original = await context.renderAsync();
    refs.push(original);
    const size = fit(original.width, original.height, maxSide);
    let image = original;
    if (size) {
      context.resize(size);
      image = await context.renderAsync();
      refs.push(image);
    }
    const saved = await image.saveAsync({ compress: quality, format: ImageManipulator.SaveFormat.JPEG });
    const result: PreparedImage = { uri: saved.uri, width: saved.width, height: saved.height, via: "manipulator" };

    if (thumbSide > 0) {
      const thumbSize = fit(saved.width, saved.height, thumbSide);
      let thumbImage = image;
      if (thumbSize) {
        context.resize(thumbSize);
        thumbImage = await context.renderAsync();
        refs.push(thumbImage);
      }
      const thumb = await thumbImage.saveAsync({ compress: thumbQuality, format: ImageManipulator.SaveFormat.JPEG });
      result.thumb = { uri: thumb.uri, width: thumb.width, height: thumb.height };
    }
    return result;
  } finally {
    // The decoded pixels are native memory; let them go now rather than
    // whenever the garbage collector next looks.
    for (const ref of refs) {
      try {
        ref.release?.();
      } catch {
        // Released already.
      }
    }
  }
}

/** The resize that brings the long side down to `maxSide`, or null when it is already within it. */
function fit(width: number, height: number, maxSide: number): { width: number } | { height: number } | null {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  if (!(scale < 1)) return null;
  return width >= height ? { width: Math.round(width * scale) } : { height: Math.round(height * scale) };
}
