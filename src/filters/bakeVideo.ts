import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { buildColorMatrix } from "./colorMatrix";
import type { FilterSpec } from "./types";
import type {
  BakeDebug,
  BakeOptions,
  BakeProgressEvent,
  NativeVideoInfo,
  VintageVideoModule,
} from "../../modules/vintage-video";

/**
 * Baking a filter into video, where the build can.
 *
 * The GL shader bakes photographs; it cannot touch a movie. The native
 * module in `modules/vintage-video` does the same job for video on iOS
 * with AVFoundation, frame by frame, using the same matrix and artifact
 * numbers, so a clip and a still wearing the same film match.
 *
 * It is loaded optionally on purpose. Android, the web review build and a
 * binary made without the module all report `false` from `canBakeVideo`.
 * A binary made before progress and cancelling existed still bakes; it
 * simply sends no progress, and a cancel there only stops waiting for it.
 */

/** Longest side of a baked clip. 1080p is plenty for a phone-width column
 * and keeps a six-second upload in the tens of megabytes, not hundreds. */
export const BAKED_VIDEO_MAX = 1920;

/**
 * The developed clip never comes out larger than this: 46 MiB (48.2 MB),
 * under the storage limit of about 50 MB however that is counted. The
 * native side checks the written file against it.
 */
export const VIDEO_SIZE_CAP_BYTES = 46 * 1024 * 1024;

/**
 * The numbers the encoder is given, mirrored from `BakeTuning` in
 * VintageVideoModule.swift (a test holds the two to the same values).
 *
 * They are chosen in bits per pixel per frame: bitrate ÷ (width × height ×
 * fps). The camera's own H.264 at 1080p30 runs at about 0.28; 10 Mbps at
 * 1080×1920×30 is 0.16, enough for grain and fine detail on a phone's
 * hardware encoder. Below 3.5 Mbps (0.056) H.264 starts to smear faces and
 * block on fades, so that is the floor. A full 60-second clip, held under
 * the cap, gets about 5.6 Mbps (0.09).
 */
export const VIDEO_MAX_BITRATE = 10_000_000;
export const VIDEO_MIN_BITRATE = 3_500_000;
/** AAC, when the sound has to be encoded; AAC sound is copied as it is. */
export const VIDEO_AUDIO_BITRATE = 160_000;
/** The share of the cap the encoder aims at, leaving room for rate-control overshoot and the MP4 index. */
export const VIDEO_BUDGET_HEADROOM = 0.9;
/** Clips faster than 31 fps are developed at this rate. */
export const VIDEO_MAX_FRAME_RATE = 30;
/** The size and rate `VIDEO_MAX_BITRATE` is the ceiling for. */
export const VIDEO_REFERENCE = { width: 1080, height: 1920, frameRate: 30 } as const;

let loaded: VintageVideoModule | null | undefined;

/** The module, or null off iOS and in a binary built without it. */
function videoModule(): VintageVideoModule | null {
  if (loaded === undefined) {
    loaded = Platform.OS === "ios" ? requireOptionalNativeModule<VintageVideoModule>("VintageVideo") : null;
  }
  return loaded;
}

export function canBakeVideo(): boolean {
  return videoModule() != null;
}

/** What the native side is asked for — the shader's uniforms, by name. */
export function bakeOptionsFor(filter: FilterSpec, maxDimension = BAKED_VIDEO_MAX): BakeOptions {
  return {
    matrix: buildColorMatrix(filter.adjustments, filter.monochrome),
    fade: filter.artifacts.fade,
    fadeColor: [...filter.artifacts.fadeColor],
    vignette: filter.artifacts.vignette,
    grain: filter.artifacts.grain,
    maxDimension,
  };
}

export interface VideoBitrateOptions {
  /** The developed frame, in pixels. Defaults to 1080×1920. */
  width?: number;
  height?: number;
  /** The developed rate. Defaults to 30. */
  frameRate?: number;
  /** What the sound will take, bits per second. Defaults to `VIDEO_AUDIO_BITRATE`. */
  audioBitrate?: number;
  maxBitrate?: number;
  minBitrate?: number;
  sizeCapBytes?: number;
}

/**
 * The H.264 bitrate a clip of this length is developed at: enough for the
 * file to fit the cap (aiming at `VIDEO_BUDGET_HEADROOM` of it, after the
 * sound), never above the ceiling, never below the floor. The ceiling and
 * the floor scale with the frame's pixel rate against 1080×1920 at 30 fps,
 * so a smaller or slower clip gets the same bits per pixel per frame, not
 * the same bitrate. The same function as `Baker.videoBitrate` in Swift.
 */
export function videoBitrateFor(durationSeconds: number, opts: VideoBitrateOptions = {}): number {
  const width = positive(opts.width, VIDEO_REFERENCE.width);
  const height = positive(opts.height, VIDEO_REFERENCE.height);
  const frameRate = positive(opts.frameRate, VIDEO_REFERENCE.frameRate);
  const reference = VIDEO_REFERENCE.width * VIDEO_REFERENCE.height * VIDEO_REFERENCE.frameRate;
  const scale = Math.min(1, (width * height * frameRate) / reference);
  const ceiling = positive(opts.maxBitrate, VIDEO_MAX_BITRATE) * scale;
  const floor = Math.min(positive(opts.minBitrate, VIDEO_MIN_BITRATE), ceiling);
  if (!(durationSeconds > 0) || !Number.isFinite(durationSeconds)) return Math.round(ceiling);
  const cap = positive(opts.sizeCapBytes, VIDEO_SIZE_CAP_BYTES);
  // 0 is a real answer (a clip with no sound); only a missing one means the default.
  const audio = opts.audioBitrate === 0 ? 0 : positive(opts.audioBitrate, VIDEO_AUDIO_BITRATE);
  const budget = (cap * 8 * VIDEO_BUDGET_HEADROOM) / durationSeconds - audio;
  return Math.round(Math.min(ceiling, Math.max(floor, budget)));
}

function positive(value: number | undefined, fallback: number): number {
  return value != null && value > 0 && Number.isFinite(value) ? value : fallback;
}

export interface VideoBakeResult {
  uri: string;
  width: number;
  height: number;
  /** Seconds, measured on the written file; 0 from a binary too old to say. */
  duration: number;
  /** Size of the written file; 0 from a binary too old to say. */
  bytes: number;
  /** Overall bits per second of the written file; 0 from a binary too old to say. */
  bitrate: number;
  /** How the bake went (path, passes, HDR source, sound), for dev logs. Absent from older binaries. */
  debug?: BakeDebug;
}

export interface VideoBakeOptions {
  /** Names the bake, for its progress events and for cancelling. One is made up when absent. */
  jobId?: string;
  /** 0 to 1, in steps of at least a hundredth. A size-correcting second pass starts again from 0. */
  onProgress?: (fraction: number) => void;
  /** Aborting cancels the native bake and rejects at once; `isInterruptedBake` is true for that error. */
  signal?: AbortSignal;
  /** Video bitrate ceiling at 1080×1920, 30 fps. Default `VIDEO_MAX_BITRATE`. */
  maxBitrate?: number;
  /** The developed file must come in under this. Default `VIDEO_SIZE_CAP_BYTES`. */
  sizeCapBytes?: number;
  /** Develop only part of the clip, in seconds. */
  range?: { start: number; duration: number };
}

/**
 * Re-encode with the film, at most 1920 px on the long side and 30 fps,
 * with an explicit H.264 bitrate sized to the cap; audio is passed through
 * where possible. Throws where the module is missing or the bake fails.
 * The caller must not fall back to uploading the original: a failed bake
 * is retried, and one stopped by the app leaving the foreground
 * (`isInterruptedBake`) is retried once the app is active.
 */
export async function bakeVideo(uri: string, filter: FilterSpec, opts: VideoBakeOptions = {}): Promise<VideoBakeResult> {
  const native = videoModule();
  if (!native) throw new Error("Video baking is not available in this build");
  const { signal, onProgress } = opts;
  if (signal?.aborted) throw cancelledError();

  const jobId = opts.jobId || makeJobId();
  const options: BakeOptions = {
    ...bakeOptionsFor(filter),
    jobId,
    maxBitrate: positive(opts.maxBitrate, VIDEO_MAX_BITRATE),
    sizeCapBytes: positive(opts.sizeCapBytes, VIDEO_SIZE_CAP_BYTES),
  };
  // Only keys with values: the native record refuses a key sent as undefined.
  if (opts.range && opts.range.duration > 0) {
    options.rangeStart = Math.max(0, opts.range.start || 0);
    options.rangeDuration = opts.range.duration;
  }

  const stopListening = onProgress ? listenForProgress(native, jobId, onProgress) : () => undefined;
  let detach: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    if (!signal) return;
    const onAbort = () => {
      cancelNative(native, jobId);
      reject(cancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
    detach = () => signal.removeEventListener("abort", onAbort);
  });
  try {
    const baking = native.bake(uri, options);
    const raw = await (signal ? Promise.race([baking, aborted]) : baking);
    return readBakeResult(raw);
  } finally {
    detach();
    stopListening();
  }
}

/**
 * The bake stopped because the app left the foreground (or was cancelled).
 * Worth retrying when the app is active again.
 */
export function isInterruptedBake(err: unknown): boolean {
  if (err == null || typeof err !== "object") return false;
  const e = err as { code?: unknown; name?: unknown; message?: unknown };
  if (e.code === "E_BAKE_INTERRUPTED" || e.code === "E_BAKE_CANCELLED") return true;
  if (e.name === "AbortError") return true;
  // Some bridges fold the code into the message only.
  return typeof e.message === "string" && /\bE_BAKE_(INTERRUPTED|CANCELLED)\b/.test(e.message);
}

export interface VideoInfo {
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  bitrate: number;
  codec: string;
  hdr: boolean;
  bytes: number;
}

/** Dev diagnostics, and the job's sanity checks. Null when unavailable. */
export async function inspectVideo(uri: string): Promise<VideoInfo | null> {
  const native = videoModule();
  if (!native || typeof native.inspect !== "function") return null;
  try {
    return readVideoInfo(await native.inspect(uri));
  } catch {
    return null;
  }
}

function makeJobId(): string {
  return `bake-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Shaped like the native rejection, so one check covers both. */
function cancelledError(): Error {
  const error = new Error("The bake was cancelled") as Error & { code: string };
  error.name = "AbortError";
  error.code = "E_BAKE_CANCELLED";
  return error;
}

function cancelNative(native: VintageVideoModule, jobId: string): void {
  if (typeof native.cancelBake !== "function") return;
  try {
    native.cancelBake(jobId);
  } catch {
    // Already finished, or a binary that cannot stop one; the caller has stopped waiting either way.
  }
}

/** Passes on this bake's progress only, as a finite fraction. Returns the way to stop listening. */
function listenForProgress(
  native: VintageVideoModule,
  jobId: string,
  listener: (fraction: number) => void,
): () => void {
  if (typeof native.addListener !== "function") return () => undefined;
  let subscription: { remove(): void } | null = null;
  try {
    subscription = native.addListener("onBakeProgress", (event: BakeProgressEvent) => {
      if (event?.jobId !== jobId) return;
      const progress = Number(event.progress);
      if (!Number.isFinite(progress)) return;
      try {
        listener(Math.min(1, Math.max(0, progress)));
      } catch {
        // A listener's own failure must not reach the native event emitter.
      }
    });
  } catch {
    return () => undefined;
  }
  return () => {
    try {
      subscription?.remove();
    } catch {
      // Already gone with the module.
    }
    subscription = null;
  };
}

function finite(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Holds the native answer to the shape promised. A binary too old to say leaves the measurements at 0. */
function readBakeResult(raw: unknown): VideoBakeResult {
  const r = raw as Partial<Record<keyof VideoBakeResult, unknown>> | null;
  const uri = r?.uri;
  const width = finite(r?.width);
  const height = finite(r?.height);
  if (typeof uri !== "string" || !uri || !width || !height) {
    throw new Error("The developed clip came back without a file");
  }
  const result: VideoBakeResult = {
    uri,
    width,
    height,
    duration: finite(r?.duration),
    bytes: finite(r?.bytes),
    bitrate: finite(r?.bitrate),
  };
  if (r?.debug && typeof r.debug === "object") result.debug = r.debug as BakeDebug;
  return result;
}

function readVideoInfo(raw: unknown): VideoInfo | null {
  const r = raw as Partial<Record<keyof NativeVideoInfo, unknown>> | null;
  if (!r || typeof r !== "object") return null;
  const width = finite(r.width);
  const height = finite(r.height);
  if (!width || !height) return null;
  return {
    width,
    height,
    duration: finite(r.duration),
    frameRate: finite(r.frameRate),
    bitrate: finite(r.bitrate),
    codec: typeof r.codec === "string" ? r.codec : "",
    hdr: r.hdr === true,
    bytes: finite(r.bytes),
  };
}
