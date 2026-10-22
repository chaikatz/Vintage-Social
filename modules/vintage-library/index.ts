/**
 * The native side of DEVELOP — see `src/darkroom/nativeLibrary.ts` for the
 * JS entry point, which loads this module optionally so the browser build
 * and a binary without it fall back to the photo library's own file and
 * the image manipulator (`src/darkroom/localFile.ts`).
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

export interface VintageLibraryModule {
  developImage(id: string, options: DevelopImageOptions): Promise<NativeDevelopResult>;
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
