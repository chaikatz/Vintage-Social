/**
 * When the GL renderer can be trusted, and with what.
 *
 * Two failures used to pass silently. A photograph the decoder cannot read
 * (a HEIC original, a remote address, a file larger than the GPU takes)
 * became an empty texture, drew as a black frame, and that black frame was
 * baked and posted. And `onReady` fired as soon as the first frame was
 * queued rather than shown, so the photograph under the renderer was taken
 * away a frame early and the preview flickered to its background.
 *
 * Everything here is plain logic, kept apart from the component so it can
 * be tested without a GPU.
 */

/** The only formats expo-gl's decoder (stb_image, built JPEG and PNG only) reads. */
const DECODABLE = new Set(["jpg", "jpeg", "jpe", "png"]);

/** The file extension of a uri, lower case, or null when it has none. */
export function extensionOf(uri: string): string | null {
  const path = uri.split(/[?#]/, 1)[0];
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,5}$/.test(ext) ? ext : null;
}

/**
 * Why the renderer cannot read this uri, or null when it can try.
 *
 * expo-gl reads only a local file: anything that is not `file://` gives it
 * nothing to decode, and it says so by uploading an empty texture. A name
 * with no extension is let through, because the decoder looks at the bytes
 * and the empty-texture check after the upload still catches a failure.
 */
export function uriProblem(uri: string | null | undefined): string | null {
  if (typeof uri !== "string" || !/^file:\/\//i.test(uri)) {
    return "it is not a file on this device";
  }
  const ext = extensionOf(uri);
  if (ext && !DECODABLE.has(ext)) return `it is a .${ext} file, and only JPEG and PNG can be read`;
  return null;
}

/**
 * Why a photograph of this size cannot be uploaded to the GPU, or null.
 * Unknown sizes pass, since there is nothing to compare; the upload itself
 * then fails into an empty texture, which is caught after it.
 */
export function sizeProblem(
  width: number | null | undefined,
  height: number | null | undefined,
  maxTextureSize: number | null | undefined,
): string | null {
  if (!width || !height || !maxTextureSize || !(maxTextureSize > 0)) return null;
  const long = Math.max(width, height);
  if (long > maxTextureSize) {
    return `it is ${long} pixels on its long side, and this device draws at most ${maxTextureSize}`;
  }
  return null;
}

/** Mipmaps on a texture whose sides are not powers of two need OpenGL ES 3. */
export function canMipmap(webgl2: boolean, width?: number | null, height?: number | null): boolean {
  if (webgl2) return true;
  const pow2 = (n: number | null | undefined) => !!n && n > 0 && (n & (n - 1)) === 0;
  return pow2(width) && pow2(height);
}

/** The pixel at the centre of a frame, in readPixels coordinates. */
export function centreOf(width: number, height: number): { x: number; y: number } {
  return { x: Math.max(0, Math.floor(width / 2)), y: Math.max(0, Math.floor(height / 2)) };
}

/**
 * Whether a pixel read back from a drawn frame says nothing was drawn.
 *
 * The shader carries the photograph's alpha through, and a decoded JPEG is
 * opaque, so a drawn pixel has alpha. Alpha 0 means the draw did not
 * happen at all (a destroyed context leaves the read buffer untouched) or
 * the texture was empty on a driver that samples an empty texture as
 * transparent. Drivers that follow the spec sample it as opaque black
 * instead, which is why the texture is also checked on its own after the
 * upload (see the renderer).
 */
export function isEmptyPixel(pixel: ArrayLike<number>): boolean {
  return pixel.length < 4 || pixel[3] === 0;
}

export type GateState = "pending" | "ready" | "failed";

/**
 * A promise for "the renderer has drawn and checked its first frame",
 * settled once. Bakes wait on it rather than polling, and a renderer that
 * fails (or closes) rejects it, so a waiting bake fails at once instead of
 * at its timeout.
 */
export interface ReadyGate {
  readonly promise: Promise<void>;
  readonly state: GateState;
  readonly error: Error | null;
  open(): void;
  fail(error: Error): void;
}

export function createReadyGate(): ReadyGate {
  let state: GateState = "pending";
  let error: Error | null = null;
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // Most renderers are never baked (the fifteen in the film tray), so a
  // failure often has nobody waiting on it, and an unobserved rejection is
  // reported as an error in development.
  promise.catch(() => undefined);
  return {
    promise,
    get state() {
      return state;
    },
    get error() {
      return error;
    },
    open() {
      if (state !== "pending") return;
      state = "ready";
      resolve();
    },
    fail(reason: Error) {
      if (state !== "pending") return;
      state = "failed";
      error = reason;
      reject(reason);
    },
  };
}

/** A renderer, or an image, that did not get ready in the time allowed. */
export class NotReadyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotReadyError";
  }
}

/**
 * The promise's result, or a NotReadyError after `timeoutMs`. The timer is
 * cleared either way, so nothing is left running after a bake.
 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new NotReadyError(message)),
      Number.isFinite(timeoutMs) ? Math.max(0, timeoutMs) : 0,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    );
  });
}

/** Wait for the gate to open, at most `timeoutMs`. */
export function waitUntilReady(gate: Pick<ReadyGate, "promise">, timeoutMs: number): Promise<void> {
  return withTimeout(gate.promise, timeoutMs, "The filter renderer was not ready in time");
}

/**
 * Resolve after `count` animation frames.
 *
 * `endFrameEXP` only queues the frame: expo-gl presents it on the next tick
 * of the view's display link. Two ticks of requestAnimationFrame after the
 * GL work has finished leave that tick time to happen, so the frame is on
 * screen before whatever stands in for it is taken away.
 */
export function afterFrames(
  count: number,
  raf: (callback: () => void) => unknown = (callback) => requestAnimationFrame(callback),
): Promise<void> {
  return new Promise<void>((resolve) => {
    const tick = (left: number) => {
      if (left <= 0) {
        resolve();
        return;
      }
      raf(() => tick(left - 1));
    };
    tick(count);
  });
}
