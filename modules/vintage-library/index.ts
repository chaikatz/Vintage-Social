/**
 * The native side of DEVELOP — see `src/darkroom/nativeLibrary.ts` for the
 * JS entry point, which loads this module optionally so the browser build
 * and a binary without it fall back to the photo library's own file and
 * the image manipulator (`src/darkroom/localFile.ts`).
 *
 * It also prepares a photograph that is already on the phone for posting;
 * `src/media/nativeMedia.ts` is that entry point, with the same fallback.
 */
export interface DevelopImageOptions {
  /** Longest side of the copy, in pixels. The Darkroom asks for 2048. */
  maxSide: number;
  /** Whether Photos may bring the original down from iCloud to make it. */
  allowNetwork: boolean;
  /** Names this request, for its progress events and for `cancelDevelop`. */
  requestId: string;
}

/**
 * What a develop came to. `ok` is an upright JPEG in the app's caches with
 * its size in pixels; `inCloud` means the original is not on the phone and
 * the network was not allowed; `missing` means the identifier no longer
 * resolves; `failed` is everything else, a cancelled request included.
 */
export type NativeDevelopResult =
  | { status: "ok"; uri: string; width: number; height: number }
  | { status: "inCloud" }
  | { status: "missing" }
  | { status: "failed" };

/** Sent while an original comes down from iCloud. */
export interface DevelopProgressEvent {
  requestId: string;
  /** 0 to 1. */
  progress: number;
}

/**
 * What `prepareImage` is asked for. Every field is sent (none undefined):
 * the native record treats a key that is present but empty as an error.
 */
export interface NativePrepareImageOptions {
  /** Longest side of the copy, in pixels. Never enlarges. */
  maxSide: number;
  /** JPEG quality, 0.1 to 1. */
  quality: number;
  /** Longest side of a thumbnail made from the same pixels; 0 for none. */
  thumbSide: number;
  thumbQuality: number;
}

export interface NativePreparedFile {
  uri: string;
  width: number;
  height: number;
}

/** An upright, sRGB, metadata-free JPEG in `Caches/prepared`, and its thumbnail when one was asked for. */
export interface NativePreparedImage extends NativePreparedFile {
  thumb?: NativePreparedFile;
}

export interface VintageLibraryModule {
  developImage(id: string, options: DevelopImageOptions): Promise<NativeDevelopResult>;
  /**
   * Decodes a local photograph straight to size (EXIF orientation applied),
   * converts it to sRGB and writes it as a JPEG with no metadata.
   * Optional: binaries built before it lack it. Rejects with
   * `E_PREPARE_INPUT` for anything but a local file.
   */
  prepareImage?(uri: string, options: NativePrepareImageOptions): Promise<NativePreparedImage>;
  /**
   * Stops a develop. Its own promise resolves straight away as `failed`, and
   * this one resolves `cancelled`; `failed` here means there was nothing in
   * flight under that name to stop (it had already finished).
   */
  cancelDevelop(requestId: string): Promise<"cancelled" | "failed">;
  /** The given identifiers that still resolve, in the order given. Rejects when the library cannot be read. */
  existing(ids: string[]): Promise<string[]>;
  addListener(eventName: "onDevelopProgress", listener: (event: DevelopProgressEvent) => void): { remove(): void };
}
