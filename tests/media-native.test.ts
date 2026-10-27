import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The JS side of the native media modules: which path a call takes, what
 * it hands the native side, and how it cleans up after itself. There is no
 * native code under node, so the modules are stand-ins that answer the
 * way the Swift does; the last block holds the Swift's tuning constants to
 * the JS copies, since nothing else can.
 */

const env = vi.hoisted(() => ({
  os: "ios",
  modules: {} as Record<string, unknown>,
  manipulator: null as null | ((uri: string) => unknown),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return env.os;
    },
  },
}));
vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: (name: string) => env.modules[name] ?? null,
}));
vi.mock("expo-image-manipulator", () => ({
  ImageManipulator: {
    manipulate: (uri: string) => {
      if (!env.manipulator) throw new Error("no manipulator in this test");
      return env.manipulator(uri);
    },
  },
  SaveFormat: { JPEG: "jpeg", PNG: "png", WEBP: "webp" },
}));

const loadBake = () => import("@/filters/bakeVideo");
const loadMedia = () => import("@/media/nativeMedia");
const loadFilters = () => import("@/filters/presets");

beforeEach(() => {
  // Both modules look the native side up once; each test starts afresh.
  vi.resetModules();
  env.os = "ios";
  env.modules = {};
  env.manipulator = null;
});

// MARK: stand-ins

interface BakeEvent {
  jobId: string;
  progress: number;
}

/** A VintageVideo that bakes when told to, and stops the way the Swift does when cancelled. */
function videoModule({ legacy = false }: { legacy?: boolean } = {}) {
  const listeners = new Set<(event: BakeEvent) => void>();
  let settle: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;
  const mod: Record<string, unknown> & {
    bake: ReturnType<typeof vi.fn>;
    cancelBake?: ReturnType<typeof vi.fn>;
    inspect?: ReturnType<typeof vi.fn>;
    addListener?: ReturnType<typeof vi.fn>;
  } = {
    bake: vi.fn(
      () =>
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        }),
    ),
  };
  if (!legacy) {
    mod.cancelBake = vi.fn(() => {
      settle?.reject(Object.assign(new Error("The bake was cancelled"), { code: "E_BAKE_CANCELLED" }));
      return true;
    });
    mod.inspect = vi.fn();
    mod.addListener = vi.fn((_name: string, listener: (event: BakeEvent) => void) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
  }
  return {
    mod,
    listeners,
    emit: (event: BakeEvent) => listeners.forEach((l) => l(event)),
    finish: (value: unknown) => settle?.resolve(value),
    fail: (error: unknown) => settle?.reject(error),
    /** The options of the latest bake call. */
    options: () => mod.bake.mock.calls.at(-1)?.[1] as Record<string, unknown>,
  };
}

const BAKED = {
  uri: "file:///tmp/vintage-1.mp4",
  width: 1080,
  height: 1920,
  duration: 30.02,
  bytes: 38_100_000,
  bitrate: 10_153_000,
  debug: { path: "writer", hdrSource: true, sourceFrameRate: 59.94, frameRate: 30, targetVideoBitrate: 10_000_000, passes: 1, audio: "copied", seconds: 18.2 },
};

const flush = () => new Promise((r) => setTimeout(r, 0));

/** An image manipulator whose context records what it is asked to do. */
function manipulator(source: { width: number; height: number }) {
  const log: string[] = [];
  const released: string[] = [];
  let decodes = 0;
  env.manipulator = (uri: string) => {
    decodes += 1;
    log.push(`open ${uri}`);
    let size = { ...source };
    let renders = 0;
    const context = {
      resize(to: { width?: number; height?: number }) {
        log.push(`resize ${JSON.stringify(to)}`);
        const scale = to.width != null ? to.width / size.width : (to.height as number) / size.height;
        size = { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
        return context;
      },
      async renderAsync() {
        renders += 1;
        const tag = `render${renders}`;
        const { width, height } = size;
        return {
          width,
          height,
          async saveAsync(options: { compress: number; format: string }) {
            log.push(`save ${width}x${height} ${options.format} q${options.compress}`);
            return { uri: `file:///cache/ImageManipulator/${tag}.jpg`, width, height };
          },
          release: () => released.push(tag),
        };
      },
      release: () => released.push("context"),
    };
    return context;
  };
  return { log, released, decodes: () => decodes };
}

// MARK: the bitrate

describe("the bitrate a clip is developed at", () => {
  it("spends the 10 Mbps ceiling on short clips and the size budget on long ones", async () => {
    const { videoBitrateFor, VIDEO_MAX_BITRATE, VIDEO_SIZE_CAP_BYTES, VIDEO_BUDGET_HEADROOM, VIDEO_AUDIO_BITRATE } = await loadBake();
    expect(videoBitrateFor(15)).toBe(VIDEO_MAX_BITRATE);
    expect(videoBitrateFor(30)).toBe(VIDEO_MAX_BITRATE);
    // 46 MiB × 8 × 0.9 / 60 s, less the sound: about 5.63 Mbps.
    const sixty = videoBitrateFor(60);
    expect(sixty).toBe(Math.round((VIDEO_SIZE_CAP_BYTES * 8 * VIDEO_BUDGET_HEADROOM) / 60 - VIDEO_AUDIO_BITRATE));
    expect(sixty).toBeGreaterThan(5_600_000);
    expect(sixty).toBeLessThan(5_700_000);
  });

  it("hands over from the ceiling to the budget at about 34 seconds", async () => {
    const { videoBitrateFor } = await loadBake();
    expect(videoBitrateFor(34)).toBe(10_000_000);
    expect(videoBitrateFor(35)).toBeLessThan(10_000_000);
  });

  it("fits a full-length clip, sound included, under the cap with room to spare", async () => {
    const { videoBitrateFor, VIDEO_SIZE_CAP_BYTES, VIDEO_AUDIO_BITRATE } = await loadBake();
    for (const seconds of [35, 45, 60]) {
      const bytes = ((videoBitrateFor(seconds) + VIDEO_AUDIO_BITRATE) * seconds) / 8;
      // Within the aim, give or take the bitrate's rounding to a whole bit per second.
      expect(bytes).toBeLessThanOrEqual(VIDEO_SIZE_CAP_BYTES * 0.9 + seconds / 16);
    }
  });

  it("never rises as the clip gets longer, and never drops below the floor", async () => {
    const { videoBitrateFor, VIDEO_MIN_BITRATE } = await loadBake();
    let previous = Infinity;
    for (let seconds = 1; seconds <= 240; seconds += 1) {
      const rate = videoBitrateFor(seconds);
      expect(rate).toBeLessThanOrEqual(previous);
      expect(rate).toBeGreaterThanOrEqual(VIDEO_MIN_BITRATE);
      previous = rate;
    }
    expect(videoBitrateFor(200)).toBe(VIDEO_MIN_BITRATE);
  });

  it("is about 0.16 bits per pixel per frame at the reference size", async () => {
    const { videoBitrateFor, VIDEO_REFERENCE } = await loadBake();
    const { width, height, frameRate } = VIDEO_REFERENCE;
    expect(videoBitrateFor(15) / (width * height * frameRate)).toBeCloseTo(0.161, 3);
  });

  it("scales the ceiling and the floor with the frame's pixel rate", async () => {
    const { videoBitrateFor } = await loadBake();
    // 720p is 4/9 of the pixels: the same bits per pixel per frame, not the same bitrate.
    expect(videoBitrateFor(15, { width: 720, height: 1280 })).toBe(Math.round((10_000_000 * 4) / 9));
    // 24 fps is 4/5 of the frames.
    expect(videoBitrateFor(15, { frameRate: 24 })).toBe(8_000_000);
    // A clip so small its ceiling is under the floor gets its ceiling.
    const tiny = videoBitrateFor(60, { width: 320, height: 240, frameRate: 15 });
    expect(tiny).toBe(Math.round((10_000_000 * 320 * 240 * 15) / (1080 * 1920 * 30)));
    // Bigger than the reference (a 1920 square) is held at the reference ceiling.
    expect(videoBitrateFor(15, { width: 1920, height: 1920 })).toBe(10_000_000);
  });

  it("takes the ceiling, cap and sound as options", async () => {
    const { videoBitrateFor, VIDEO_MIN_BITRATE } = await loadBake();
    expect(videoBitrateFor(15, { maxBitrate: 8_000_000 })).toBe(8_000_000);
    expect(videoBitrateFor(60, { audioBitrate: 0 }) - videoBitrateFor(60)).toBe(160_000);
    // A small cap on a long clip: the floor wins over the budget, and the
    // native size check then refuses the file rather than posting it blurred.
    expect(videoBitrateFor(60, { sizeCapBytes: 20 * 1024 * 1024 })).toBe(VIDEO_MIN_BITRATE);
  });

  it("falls back to the ceiling when the length is unknown", async () => {
    const { videoBitrateFor } = await loadBake();
    expect(videoBitrateFor(0)).toBe(10_000_000);
    expect(videoBitrateFor(Number.NaN)).toBe(10_000_000);
    expect(videoBitrateFor(-5)).toBe(10_000_000);
  });
});

// MARK: baking

describe("baking a clip", () => {
  it("refuses where there is nothing to bake with, the web included", async () => {
    env.os = "web";
    env.modules.VintageVideo = videoModule().mod;
    const { bakeVideo, canBakeVideo } = await loadBake();
    expect(canBakeVideo()).toBe(false);
    const { FILTERS } = await loadFilters();
    await expect(bakeVideo("file:///clip.mov", FILTERS[0])).rejects.toThrow(/not available/);
  });

  it("asks for the film, the job's name, the ceiling and the cap, and nothing undefined", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo, bakeOptionsFor, VIDEO_MAX_BITRATE, VIDEO_SIZE_CAP_BYTES } = await loadBake();
    const { FILTERS } = await loadFilters();
    const film = FILTERS.find((f) => f.id === "seventy")!;
    const baking = bakeVideo("file:///clip.mov", film, { jobId: "post-1" });
    video.finish(BAKED);
    await baking;
    const options = video.options();
    expect(video.mod.bake).toHaveBeenCalledWith("file:///clip.mov", expect.any(Object));
    expect(options).toEqual({
      ...bakeOptionsFor(film),
      jobId: "post-1",
      maxBitrate: VIDEO_MAX_BITRATE,
      sizeCapBytes: VIDEO_SIZE_CAP_BYTES,
    });
    expect(Object.values(options).every((v) => v !== undefined)).toBe(true);
  });

  it("passes a range, a ceiling and a cap when given", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], {
      jobId: "post-2",
      maxBitrate: 8_000_000,
      sizeCapBytes: 30_000_000,
      range: { start: 2.5, duration: 12 },
    });
    video.finish(BAKED);
    await baking;
    expect(video.options()).toMatchObject({ maxBitrate: 8_000_000, sizeCapBytes: 30_000_000, rangeStart: 2.5, rangeDuration: 12 });
  });

  it("names a bake itself when not told one", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const seen: number[] = [];
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { onProgress: (p) => seen.push(p) });
    const jobId = video.options().jobId as string;
    expect(jobId).toMatch(/^bake-/);
    video.emit({ jobId, progress: 0.5 });
    video.finish(BAKED);
    await baking;
    expect(seen).toEqual([0.5]);
  });

  it("returns what was written, debug included", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "a" });
    video.finish(BAKED);
    await expect(baking).resolves.toEqual(BAKED);
  });

  it("accepts an older binary's bare answer, with the measurements at 0", async () => {
    const video = videoModule({ legacy: true });
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const progress = vi.fn();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "old", onProgress: progress });
    video.finish({ uri: "file:///tmp/old.mp4", width: 1080, height: 1920 });
    await expect(baking).resolves.toEqual({ uri: "file:///tmp/old.mp4", width: 1080, height: 1920, duration: 0, bytes: 0, bitrate: 0 });
    expect(progress).not.toHaveBeenCalled();
  });

  it("refuses an answer without a file", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "a" });
    video.finish({ width: 1080, height: 1920 });
    await expect(baking).rejects.toThrow(/without a file/);
  });

  it("passes on only its own progress, as a fraction, and stops listening when done", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const seen: number[] = [];
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "mine", onProgress: (p) => seen.push(p) });
    expect(video.mod.addListener).toHaveBeenCalledWith("onBakeProgress", expect.any(Function));
    video.emit({ jobId: "mine", progress: 0.01 });
    video.emit({ jobId: "someone-else", progress: 0.5 });
    video.emit({ jobId: "mine", progress: Number.NaN });
    video.emit({ jobId: "mine", progress: 1.2 });
    video.emit({ jobId: "mine", progress: -0.3 });
    expect(video.listeners.size).toBe(1);
    video.finish(BAKED);
    await baking;
    expect(seen).toEqual([0.01, 1, 0]);
    expect(video.listeners.size).toBe(0);
  });

  it("stops listening when the bake fails too, and passes the failure on", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo, isInterruptedBake } = await loadBake();
    const { FILTERS } = await loadFilters();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "x", onProgress: () => undefined });
    video.fail(Object.assign(new Error("The bake stopped because VINTAGE left the foreground"), { code: "E_BAKE_INTERRUPTED" }));
    const error = await baking.catch((e: unknown) => e);
    expect(isInterruptedBake(error)).toBe(true);
    expect(video.listeners.size).toBe(0);
  });

  it("does not listen at all without a progress callback", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "quiet" });
    video.finish(BAKED);
    await baking;
    expect(video.mod.addListener).not.toHaveBeenCalled();
  });

  it("keeps a throwing progress callback away from the native side", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], {
      jobId: "loud",
      onProgress: () => {
        throw new Error("render failed");
      },
    });
    expect(() => video.emit({ jobId: "loud", progress: 0.2 })).not.toThrow();
    video.finish(BAKED);
    await expect(baking).resolves.toMatchObject({ uri: BAKED.uri });
  });

  it("cancels the native bake when aborted, rejects as interrupted, and lets go of everything", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo, isInterruptedBake } = await loadBake();
    const { FILTERS } = await loadFilters();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "gone", onProgress: () => undefined, signal: controller.signal });
    await flush();
    controller.abort();
    const error = (await baking.catch((e: unknown) => e)) as { code?: string };
    expect(video.mod.cancelBake).toHaveBeenCalledWith("gone");
    expect(error.code).toBe("E_BAKE_CANCELLED");
    expect(isInterruptedBake(error)).toBe(true);
    expect(video.listeners.size).toBe(0);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("does not start when already aborted", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo, isInterruptedBake } = await loadBake();
    const { FILTERS } = await loadFilters();
    const controller = new AbortController();
    controller.abort();
    const error = await bakeVideo("file:///clip.mov", FILTERS[0], { signal: controller.signal }).catch((e: unknown) => e);
    expect(isInterruptedBake(error)).toBe(true);
    expect(video.mod.bake).not.toHaveBeenCalled();
  });

  it("stops waiting on an older binary that cannot cancel", async () => {
    const video = videoModule({ legacy: true });
    env.modules.VintageVideo = video.mod;
    const { bakeVideo, isInterruptedBake } = await loadBake();
    const { FILTERS } = await loadFilters();
    const controller = new AbortController();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "old", signal: controller.signal });
    controller.abort();
    expect(isInterruptedBake(await baking.catch((e: unknown) => e))).toBe(true);
  });

  it("does not cancel a bake that has already finished", async () => {
    const video = videoModule();
    env.modules.VintageVideo = video.mod;
    const { bakeVideo } = await loadBake();
    const { FILTERS } = await loadFilters();
    const controller = new AbortController();
    const baking = bakeVideo("file:///clip.mov", FILTERS[0], { jobId: "done", signal: controller.signal });
    video.finish(BAKED);
    await baking;
    controller.abort();
    expect(video.mod.cancelBake).not.toHaveBeenCalled();
  });
});

describe("telling an interrupted bake from a failed one", () => {
  it("reads the code, an AbortError, or a code folded into the message", async () => {
    const { isInterruptedBake } = await loadBake();
    expect(isInterruptedBake({ code: "E_BAKE_INTERRUPTED" })).toBe(true);
    expect(isInterruptedBake({ code: "E_BAKE_CANCELLED" })).toBe(true);
    expect(isInterruptedBake(Object.assign(new Error("stopped"), { name: "AbortError" }))).toBe(true);
    expect(isInterruptedBake(new Error("Calling the 'bake' function has failed: E_BAKE_INTERRUPTED"))).toBe(true);
  });

  it("is false for real failures and for anything that is not an error", async () => {
    const { isInterruptedBake } = await loadBake();
    for (const code of ["E_BAKE_EXPORT", "E_BAKE_VERIFY", "E_BAKE_TOO_LARGE", "E_BAKE_INPUT"]) {
      expect(isInterruptedBake({ code, message: "The filter could not be applied" })).toBe(false);
    }
    expect(isInterruptedBake(null)).toBe(false);
    expect(isInterruptedBake(undefined)).toBe(false);
    expect(isInterruptedBake("E_BAKE_INTERRUPTED")).toBe(false);
    expect(isInterruptedBake(new Error("E_BAKE_INTERRUPTEDLY"))).toBe(false);
  });
});

describe("inspecting a clip", () => {
  it("reads what the native side says, held to its shape", async () => {
    const video = videoModule();
    video.mod.inspect!.mockResolvedValue({
      width: 2160,
      height: 3840,
      duration: 12.5,
      frameRate: 59.94,
      bitrate: 48_000_000,
      codec: "hvc1",
      hdr: true,
      bytes: 75_000_000,
    });
    env.modules.VintageVideo = video.mod;
    const { inspectVideo } = await loadBake();
    await expect(inspectVideo("file:///clip.mov")).resolves.toEqual({
      width: 2160,
      height: 3840,
      duration: 12.5,
      frameRate: 59.94,
      bitrate: 48_000_000,
      codec: "hvc1",
      hdr: true,
      bytes: 75_000_000,
    });
  });

  it("is null where it cannot say", async () => {
    let { inspectVideo } = await loadBake();
    await expect(inspectVideo("file:///clip.mov")).resolves.toBeNull();

    vi.resetModules();
    env.modules.VintageVideo = videoModule({ legacy: true }).mod;
    ({ inspectVideo } = await loadBake());
    await expect(inspectVideo("file:///clip.mov")).resolves.toBeNull();

    vi.resetModules();
    const failing = videoModule();
    failing.mod.inspect!.mockRejectedValue(new Error("no video track"));
    env.modules.VintageVideo = failing.mod;
    ({ inspectVideo } = await loadBake());
    await expect(inspectVideo("file:///clip.mov")).resolves.toBeNull();

    vi.resetModules();
    const odd = videoModule();
    odd.mod.inspect!.mockResolvedValue({ width: 0, height: "tall" });
    env.modules.VintageVideo = odd.mod;
    ({ inspectVideo } = await loadBake());
    await expect(inspectVideo("file:///clip.mov")).resolves.toBeNull();
  });

  it("fills in what an answer leaves out", async () => {
    const video = videoModule();
    video.mod.inspect!.mockResolvedValue({ width: 1080, height: 1920, codec: 7, hdr: "yes" });
    env.modules.VintageVideo = video.mod;
    const { inspectVideo } = await loadBake();
    await expect(inspectVideo("file:///clip.mov")).resolves.toEqual({
      width: 1080,
      height: 1920,
      duration: 0,
      frameRate: 0,
      bitrate: 0,
      codec: "",
      hdr: false,
      bytes: 0,
    });
  });
});

// MARK: preparing photographs

/** A VintageLibrary, with or without `prepareImage` (a binary built before it has only the Darkroom's calls). */
function libraryModule(prepare?: (uri: string, options: Record<string, unknown>) => Promise<unknown>) {
  const mod: Record<string, unknown> = {
    developImage: vi.fn(),
    cancelDevelop: vi.fn(),
    existing: vi.fn(),
  };
  if (prepare) mod.prepareImage = vi.fn(prepare);
  return mod as Record<string, unknown> & { prepareImage?: ReturnType<typeof vi.fn> };
}

const PREPARED = { uri: "file:///Caches/prepared/A.jpg", width: 1440, height: 1080 };
const THUMB = { uri: "file:///Caches/prepared/A-thumb.jpg", width: 480, height: 360 };

describe("which way a photograph is prepared", () => {
  it("is native only on iOS, with a binary that has prepareImage", async () => {
    let { hasNativePrepare } = await loadMedia();
    expect(hasNativePrepare()).toBe(false);

    vi.resetModules();
    env.modules.VintageLibrary = libraryModule();
    ({ hasNativePrepare } = await loadMedia());
    expect(hasNativePrepare()).toBe(false);

    vi.resetModules();
    env.modules.VintageLibrary = libraryModule(async () => PREPARED);
    ({ hasNativePrepare } = await loadMedia());
    expect(hasNativePrepare()).toBe(true);

    vi.resetModules();
    env.os = "web";
    ({ hasNativePrepare } = await loadMedia());
    expect(hasNativePrepare()).toBe(false);
  });

  it("sends every option with a value, the defaults filled in", async () => {
    const library = libraryModule(async () => PREPARED);
    env.modules.VintageLibrary = library;
    const { prepareImage } = await loadMedia();
    await expect(prepareImage("file:///photo.jpg", { maxSide: 1440 })).resolves.toEqual({ ...PREPARED, via: "native" });
    expect(library.prepareImage).toHaveBeenCalledWith("file:///photo.jpg", {
      maxSide: 1440,
      quality: 0.9,
      thumbSide: 0,
      thumbQuality: 0.8,
    });
  });

  it("returns the thumbnail made in the same decode", async () => {
    const library = libraryModule(async () => ({ ...PREPARED, thumb: THUMB }));
    env.modules.VintageLibrary = library;
    const { prepareImage } = await loadMedia();
    const prepared = await prepareImage("/var/mobile/photo.heic", { maxSide: 1440, quality: 0.85, thumbSide: 480, thumbQuality: 0.7 });
    expect(prepared).toEqual({ ...PREPARED, thumb: THUMB, via: "native" });
    expect(library.prepareImage).toHaveBeenCalledWith("/var/mobile/photo.heic", {
      maxSide: 1440,
      quality: 0.85,
      thumbSide: 480,
      thumbQuality: 0.7,
    });
  });

  it("falls back to the manipulator when the native side fails, or answers short", async () => {
    const lab = manipulator({ width: 4032, height: 3024 });
    env.modules.VintageLibrary = libraryModule(async () => {
      throw Object.assign(new Error("The photograph could not be read"), { code: "E_PREPARE_DECODE" });
    });
    let { prepareImage } = await loadMedia();
    await expect(prepareImage("file:///photo.dng", { maxSide: 1440 })).resolves.toMatchObject({ width: 1440, height: 1080, via: "manipulator" });

    vi.resetModules();
    // Asked for a thumbnail, answered without one.
    env.modules.VintageLibrary = libraryModule(async () => PREPARED);
    ({ prepareImage } = await loadMedia());
    const prepared = await prepareImage("file:///photo.jpg", { maxSide: 1440, thumbSide: 480 });
    expect(prepared.via).toBe("manipulator");
    expect(prepared.thumb).toEqual({ uri: expect.any(String), width: 480, height: 360 });
    expect(lab.decodes()).toBe(2);
  });

  it("leaves a photo-library address to the manipulator, which can read it", async () => {
    const lab = manipulator({ width: 3024, height: 4032 });
    const library = libraryModule(async () => PREPARED);
    env.modules.VintageLibrary = library;
    const { prepareImage } = await loadMedia();
    await prepareImage("ph://ABC-123", { maxSide: 1440 });
    expect(library.prepareImage).not.toHaveBeenCalled();
    expect(lab.log[0]).toBe("open ph://ABC-123");
  });

  it("uses the manipulator on the web", async () => {
    env.os = "web";
    const lab = manipulator({ width: 1200, height: 1500 });
    env.modules.VintageLibrary = libraryModule(async () => PREPARED);
    const { prepareImage } = await loadMedia();
    await expect(prepareImage("blob:http://localhost/1", { maxSide: 1440 })).resolves.toMatchObject({
      width: 1152,
      height: 1440,
      via: "manipulator",
    });
    expect(lab.decodes()).toBe(1);
  });

  it("refuses a size it cannot use", async () => {
    const { prepareImage } = await loadMedia();
    await expect(prepareImage("file:///photo.jpg", { maxSide: 0 })).rejects.toThrow(/maxSide/);
    await expect(prepareImage("file:///photo.jpg", { maxSide: Number.NaN })).rejects.toThrow(/maxSide/);
  });
});

describe("the manipulator fallback", () => {
  it("brings the long side of a landscape down, then makes the thumbnail from the same pixels", async () => {
    const lab = manipulator({ width: 4032, height: 3024 });
    const { prepareImage } = await loadMedia();
    const prepared = await prepareImage("file:///photo.heic", { maxSide: 1440, thumbSide: 480 });
    expect(lab.log).toEqual([
      "open file:///photo.heic",
      'resize {"width":1440}',
      "save 1440x1080 jpeg q0.9",
      'resize {"width":480}',
      "save 480x360 jpeg q0.8",
    ]);
    expect(lab.decodes()).toBe(1);
    expect(prepared).toEqual({
      uri: "file:///cache/ImageManipulator/render2.jpg",
      width: 1440,
      height: 1080,
      via: "manipulator",
      thumb: { uri: "file:///cache/ImageManipulator/render3.jpg", width: 480, height: 360 },
    });
    // Every image and the context itself are let go of.
    expect(lab.released.sort()).toEqual(["context", "render1", "render2", "render3"]);
  });

  it("fits a portrait by its height", async () => {
    const lab = manipulator({ width: 3024, height: 4032 });
    const { prepareImage } = await loadMedia();
    await expect(prepareImage("file:///photo.jpg", { maxSide: 1440, quality: 0.85 })).resolves.toMatchObject({ width: 1080, height: 1440 });
    expect(lab.log).toContain('resize {"height":1440}');
    expect(lab.log).toContain("save 1080x1440 jpeg q0.85");
  });

  it("never enlarges", async () => {
    const lab = manipulator({ width: 800, height: 600 });
    const { prepareImage } = await loadMedia();
    const prepared = await prepareImage("file:///small.jpg", { maxSide: 1440, thumbSide: 1000 });
    expect(lab.log.filter((l) => l.startsWith("resize"))).toEqual([]);
    expect(prepared).toMatchObject({ width: 800, height: 600, thumb: { width: 800, height: 600 } });
  });

  it("keeps the quality between 0 and 1", async () => {
    const lab = manipulator({ width: 1000, height: 1000 });
    const { prepareImage } = await loadMedia();
    await prepareImage("file:///a.jpg", { maxSide: 1440, quality: 7, thumbSide: 480, thumbQuality: -1 });
    expect(lab.log).toContain("save 1000x1000 jpeg q1");
    expect(lab.log).toContain("save 480x480 jpeg q0.8");
  });
});

// MARK: the native source

/**
 * The Swift cannot be compiled or run here, so its tuning is read as text
 * and held to the JS copies, and the shape of the pipeline is checked for
 * the pieces this repair depends on.
 */
describe("the native modules match their JS side", () => {
  const read = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8")
      // Comments out: they name what the code no longer does.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"])\/\/.*$/gm, "$1");
  const video = read("modules/vintage-video/ios/VintageVideoModule.swift");
  const library = read("modules/vintage-library/ios/VintageLibraryModule.swift");

  /** A `static let` in the Swift, evaluated (they are numbers, or products of numbers). */
  function constant(source: string, name: string): number {
    const match = source.match(new RegExp(`static let ${name}(?::\\s*\\w+)?\\s*=\\s*([^\\n]+)`));
    if (!match) throw new Error(`${name} is not in the Swift`);
    return match[1]
      .split("*")
      .map((part) => Number(part.trim().replace(/_/g, "")))
      .reduce((a, b) => a * b, 1);
  }

  it("holds the encoder to the numbers the JS budget is worked out with", async () => {
    const js = await loadBake();
    expect(constant(video, "defaultSizeCapBytes")).toBe(js.VIDEO_SIZE_CAP_BYTES);
    expect(constant(video, "defaultMaxBitrate")).toBe(js.VIDEO_MAX_BITRATE);
    expect(constant(video, "minimumBitrate")).toBe(js.VIDEO_MIN_BITRATE);
    expect(constant(video, "audioBitrate")).toBe(js.VIDEO_AUDIO_BITRATE);
    expect(constant(video, "budgetHeadroom")).toBe(js.VIDEO_BUDGET_HEADROOM);
    expect(constant(video, "maxFrameRate")).toBe(js.VIDEO_MAX_FRAME_RATE);
    const { width, height, frameRate } = js.VIDEO_REFERENCE;
    expect(constant(video, "referencePixelRate")).toBe(width * height * frameRate);
    expect(constant(video, "highFrameRateThreshold")).toBe(31);
    expect(constant(video, "keyFrameIntervalSeconds")).toBe(2);
    expect(constant(video, "durationTolerance")).toBe(0.25);
    expect(constant(video, "refreshHz")).toBe(15);
  });

  it("encodes by hand, at a set bitrate, with no file-length limit", () => {
    expect(video).not.toMatch(/fileLengthLimit/);
    for (const piece of [
      "AVAssetReaderVideoCompositionOutput(",
      "AVAssetWriter(outputURL:",
      "writer.shouldOptimizeForNetworkUse = true",
      "AVVideoAverageBitRateKey: bitrate",
      "AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel",
      "AVVideoMaxKeyFrameIntervalDurationKey: BakeTuning.keyFrameIntervalSeconds",
      "AVVideoExpectedSourceFrameRateKey:",
      "AVVideoAllowFrameReorderingKey: true",
      "composition.sourceTrackIDForFrameTiming = kCMPersistentTrackID_Invalid",
      "kCVPixelFormatType_32BGRA",
      "AVAssetReaderTrackOutput(track: audio.track, outputSettings: nil)",
      "outputSettings: nil, sourceFormatHint:",
      "writer.startSession(atSourceTime: plan.range.start)",
      "requestMediaDataWhenReady(on:",
      "group.notify(",
      "beginBackgroundTask(",
      "UIApplication.didEnterBackgroundNotification",
      "AVAssetExportPreset1920x1080",
      ".containsHDRVideo",
    ]) {
      expect(video, piece).toContain(piece);
    }
  });

  it("exposes progress, cancelling and inspecting, and keeps branding", () => {
    for (const piece of ['Events("onBakeProgress")', 'Function("cancelBake")', 'AsyncFunction("inspect")', 'AsyncFunction("bake")', 'AsyncFunction("brand")']) {
      expect(video, piece).toContain(piece);
    }
    for (const code of ["E_BAKE_INTERRUPTED", "E_BAKE_CANCELLED", "E_BAKE_TOO_LARGE", "E_BAKE_VERIFY"]) {
      expect(video, code).toContain(`"${code}"`);
    }
  });

  it("makes the grain opaque before it is added", () => {
    expect(video).toContain('"inputAVector": CIVector(x: 0, y: 0, z: 0, w: 0)');
    expect(video).toContain('"inputBiasVector": CIVector(x: 0, y: 0, z: 0, w: 1)');
    expect(video).toContain(".settingAlphaOne(in: frame)");
    expect(video).not.toContain("CIAdditionCompositing");
  });

  it("prepares with ImageIO into sRGB, and keeps the Darkroom's calls", () => {
    for (const piece of [
      'AsyncFunction("prepareImage")',
      "CGImageSourceCreateThumbnailAtIndex(",
      "kCGImageSourceCreateThumbnailFromImageAlways: true",
      "kCGImageSourceCreateThumbnailWithTransform: true",
      "kCGImageSourceThumbnailMaxPixelSize:",
      "kCGImageSourceShouldCacheImmediately: true",
      "CGColorSpace(name: CGColorSpace.sRGB)",
      "kCGImageDestinationLossyCompressionQuality",
      'appendingPathComponent("prepared", isDirectory: true)',
      'AsyncFunction("developImage")',
      'AsyncFunction("cancelDevelop")',
      'AsyncFunction("existing")',
      'Events("onDevelopProgress")',
    ]) {
      expect(library, piece).toContain(piece);
    }
    expect(library).toMatch(/label: "club\.vintage\.library\.prepare", qos: \.userInitiated/);
  });
});
