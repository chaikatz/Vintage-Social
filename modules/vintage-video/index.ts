/**
 * The native side of video filters — see `src/filters/bakeVideo.ts` for the
 * JS entry point, which loads this module optionally so Android, web and a
 * build without it fall back to the live overlay.
 *
 * Everything added after the first release (progress, cancelling,
 * inspecting, the richer result) is optional here, because a binary built
 * before it still answers `bake` with only `{ uri, width, height }`.
 */
export interface BakeOptions {
  /** 4x5 colour matrix, row-major, last column the offset — as `buildColorMatrix` returns it. */
  matrix: number[];
  fade: number;
  fadeColor: number[];
  vignette: number;
  grain: number;
  /** Longest side of the output, in pixels. */
  maxDimension: number;
  /** Names the bake, for its `onBakeProgress` events and for `cancelBake`. */
  jobId?: string;
  /** Video bitrate ceiling at 1080×1920 and 30 fps, in bits per second; scaled down for smaller or slower clips. */
  maxBitrate?: number;
  /** The developed file must come in under this many bytes. */
  sizeCapBytes?: number;
  /** Develop only part of the clip: its start, in seconds. */
  rangeStart?: number;
  /** …and its length, in seconds. 0 or absent means to the end. */
  rangeDuration?: number;
}

/** How the bake went, for dev logs and the outbox's sanity checks. */
export interface BakeDebug {
  /** "writer": read and written by hand. "export": the export-session fallback. */
  path: "writer" | "export";
  hdrSource: boolean;
  sourceFrameRate: number;
  frameRate: number;
  /** The video bitrate the encoder was asked for (writer path only). */
  targetVideoBitrate?: number;
  /** 2 when the first pass came out over the cap and the clip was developed again. */
  passes: number;
  /** "copied" (AAC passed through), "aac" (encoded) or "none". */
  audio: string;
  /** Wall time of the whole bake. */
  seconds: number;
}

export interface BakedVideo {
  uri: string;
  width: number;
  height: number;
  /** Seconds, measured on the written file. Absent from older binaries. */
  duration?: number;
  /** Size of the written file. Absent from older binaries. */
  bytes?: number;
  /** Overall bits per second of the written file (picture and sound). Absent from older binaries. */
  bitrate?: number;
  debug?: BakeDebug;
}

/** Sent while a bake runs, in steps of at least a hundredth. A second pass starts again from 0. */
export interface BakeProgressEvent {
  jobId: string;
  /** 0 to 1: how far through the clip the frame being written is. */
  progress: number;
}

/** What a clip is, as the native side reads it. */
export interface NativeVideoInfo {
  width: number;
  height: number;
  duration: number;
  frameRate: number;
  /** The video track's estimated data rate, bits per second. */
  bitrate: number;
  /** The video codec's four characters, "avc1" or "hvc1". */
  codec: string;
  hdr: boolean;
  /** Size of the file on disk. */
  bytes: number;
}

/** A rectangle in output pixels, y down from the top — as `exportLayout` gives it. */
export interface BrandRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrandTextBox extends BrandRect {
  size: number;
  spacing: number;
}

/**
 * The print to paint around a film — see `src/utils/exportLayout.ts`, whose
 * rectangles these are. Colours are `#rrggbb`. An empty text draws nothing.
 */
export interface BrandOptions {
  width: number;
  height: number;
  photo: BrandRect;
  rule: BrandRect;
  wordmark: BrandTextBox;
  /** "Members only", italic and faint, under the wordmark. */
  tagline: BrandTextBox;
  /** Where it was taken; may be two lines tall, or zero-height when there is no place. */
  place: BrandTextBox;
  byline: BrandTextBox;
  credit: BrandTextBox;
  stamp: BrandTextBox;
  /** The app icon's square, bottom-left; drawn from `iconUri` when that is a readable file. */
  icon: BrandRect;
  iconUri: string;
  paper: string;
  well: string;
  ink: string;
  inkSoft: string;
  inkFaint: string;
  ruleColor: string;
  wordmarkText: string;
  taglineText: string;
  placeText: string;
  bylineText: string;
  creditText: string;
  stampText: string;
}

/**
 * The error codes a bake rejects with. `E_BAKE_INTERRUPTED` means the app
 * left the foreground (or iOS ended its background time) and the bake can
 * simply run again once the app is active.
 */
export type BakeErrorCode =
  | "E_BAKE_INPUT"
  | "E_BAKE_EXPORT"
  | "E_BAKE_VERIFY"
  | "E_BAKE_TOO_LARGE"
  | "E_BAKE_CANCELLED"
  | "E_BAKE_INTERRUPTED";

export interface VintageVideoModule {
  bake(uri: string, options: BakeOptions): Promise<BakedVideo>;
  /**
   * Stops a bake by name. Synchronous: true when one was in flight; its own
   * promise then rejects with `E_BAKE_CANCELLED` once it has torn down.
   * Optional: older builds lack it.
   */
  cancelBake?(jobId: string): boolean;
  /** Reads a clip's size, length, rate, codec and HDR-ness. Optional: older builds lack it. */
  inspect?(uri: string): Promise<NativeVideoInfo>;
  /** A copy of the film on paper, with the label, sound kept. Optional: older builds lack it. */
  brand?(uri: string, options: BrandOptions): Promise<BakedVideo>;
  /** Optional: older builds send no events. */
  addListener?(eventName: "onBakeProgress", listener: (event: BakeProgressEvent) => void): { remove(): void };
}
