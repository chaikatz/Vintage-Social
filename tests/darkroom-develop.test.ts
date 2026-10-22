import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Print } from "@/darkroom/types";
import type { DevelopImageOptions, DevelopProgressEvent } from "../modules/vintage-library";

/**
 * DEVELOP, from a print to the editor's params, against a fake library.
 *
 * The native module is a fake that answers when the test says so, so each
 * path can be held open: a print on the phone, one only in iCloud, an
 * offline phone, a download that never finishes, a member who stops
 * waiting. The same paths run without the module, through the photo
 * library's own file and the `ph://` still. Files are a set of addresses,
 * so a copy that should not be kept can be seen to go.
 */

const world = vi.hoisted(() => ({
  os: "ios",
  natives: {} as Record<string, unknown>,
  files: new Set<string>(),
  deleted: [] as string[],
  net: { type: "wifi", isConnected: true } as { type: string; isConnected: boolean | null },
  netCalls: 0,
  netAnswer: null as null | (() => Promise<unknown>),
  assetInfo: vi.fn(),
  prepare: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return world.os;
    },
  },
  findNodeHandle: (view: unknown) =>
    view && typeof view === "object" && "nativeTag" in view ? (view as { nativeTag: number }).nativeTag : null,
}));

vi.mock("expo-modules-core", () => ({
  requireOptionalNativeModule: (name: string) => world.natives[name] ?? null,
}));

vi.mock("@react-native-community/netinfo", () => {
  const read = async () => {
    world.netCalls += 1;
    if (world.netAnswer) return world.netAnswer();
    return { ...world.net };
  };
  const NetInfoStateType = {
    unknown: "unknown",
    none: "none",
    cellular: "cellular",
    wifi: "wifi",
    ethernet: "ethernet",
    other: "other",
  };
  return { fetch: read, NetInfoStateType, default: { fetch: read } };
});

vi.mock("expo-file-system", () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get exists() {
      return world.files.has(this.uri);
    }
    delete() {
      world.files.delete(this.uri);
      world.deleted.push(this.uri);
    }
  },
  Paths: { cache: { uri: "file:///caches/" }, document: { uri: "file:///documents/" } },
}));

vi.mock("expo-media-library", () => ({
  getAssetInfoAsync: (...args: unknown[]) => world.assetInfo(...args),
}));

vi.mock("@/api/media", () => ({
  DARKROOM_MAX: 2048,
  prepareForDarkroom: (...args: unknown[]) => world.prepare(...args),
}));

vi.mock("@/darkroom/printSource", () => ({
  printFileUri: (uri: string | number) => {
    if (typeof uri === "number") return `file:///bundle/asset-${uri}.jpg`;
    if (uri === "demo:gone") return null;
    if (uri.startsWith("demo:")) return `/assets/demo-${uri.slice(5)}.jpg`;
    return uri;
  },
}));

/** The native module, answering only when told to. */
class FakeLibrary {
  requests: { id: string; options: DevelopImageOptions }[] = [];
  present = new Set<string>();
  existingError: Error | null = null;
  private answers = new Map<string, (result: unknown) => void>();
  private listeners = new Set<(event: DevelopProgressEvent) => void>();

  developImage = vi.fn((id: string, options: DevelopImageOptions) => {
    this.requests.push({ id, options });
    return new Promise((resolve) => this.answers.set(options.requestId, resolve));
  });
  cancelDevelop = vi.fn(async (_requestId: string) => "cancelled" as const);
  existing = vi.fn(async (ids: string[]) => {
    if (this.existingError) throw this.existingError;
    return ids.filter((id) => this.present.has(id));
  });
  addListener = vi.fn((_name: string, listener: (event: DevelopProgressEvent) => void) => {
    this.listeners.add(listener);
    return { remove: () => void this.listeners.delete(listener) };
  });

  get last() {
    const request = this.requests[this.requests.length - 1];
    if (!request) throw new Error("Nothing was asked of the library");
    return request;
  }

  answer(result: unknown, requestId = this.last.options.requestId): void {
    this.answers.get(requestId)?.(result);
  }

  progress(progress: number, requestId = this.last.options.requestId): void {
    for (const listener of [...this.listeners]) listener({ requestId, progress });
  }

  get listening(): number {
    return this.listeners.size;
  }
}

const ID = "ED7AC36B-A150-4C38-BB8C-B6D696F4F2ED/L0/001";
const TAKEN = new Date(2018, 7, 14, 15, 32).getTime();
const COPY = "file:///caches/darkroom/A1.jpg";
const LATE = "file:///caches/darkroom/LATE.jpg";

function print(over: Partial<Print> = {}): Print {
  return { id: ID, uri: `ph://${ID}`, width: 4032, height: 3024, takenAt: TAKEN, subtypes: [], ...over };
}

function ok(uri = COPY, width = 2048, height = 1536) {
  return { status: "ok", uri, width, height };
}

/** Lets every pending promise step run, without moving any clock. */
async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** A promise's answer so far, without waiting for it. */
function watch<T>(promise: Promise<T>): { readonly value: T | undefined } {
  const box: { value: T | undefined } = { value: undefined };
  promise.then((value) => {
    box.value = value;
  });
  return box;
}

async function load(native: FakeLibrary | null) {
  vi.resetModules();
  world.natives = native ? { VintageLibrary: native } : {};
  return import("@/darkroom/develop");
}

beforeEach(() => {
  world.os = "ios";
  world.natives = {};
  world.files = new Set();
  world.deleted = [];
  world.net = { type: "wifi", isConnected: true };
  world.netCalls = 0;
  world.netAnswer = null;
  world.assetInfo.mockReset();
  world.prepare.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("developing with the library module", () => {
  it("reads a print on the phone, never asking the network, and hands the editor its params", async () => {
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const pending = developLocal(print());
    expect(lib.last.id).toBe(ID);
    expect(lib.last.options).toEqual({ maxSide: 2048, allowNetwork: false, requestId: expect.any(String) });
    lib.answer(ok());
    await expect(pending).resolves.toEqual({
      status: "ok",
      params: {
        uri: COPY,
        mediaType: "photo",
        width: "2048",
        height: "1536",
        duration: "0",
        takenAt: new Date(TAKEN).toISOString(),
        assetId: ID,
        from: "darkroom",
      },
    });
  });

  it("carries a date from before 1970 into the editor", async () => {
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const then = new Date(1962, 7, 14, 15, 0).getTime();
    expect(then).toBeLessThan(0);
    const pending = developLocal(print({ takenAt: then }));
    lib.answer(ok());
    const result = await pending;
    expect(result.status === "ok" && result.params.takenAt).toBe(new Date(then).toISOString());
  });

  it("leaves the date stamp empty for a clock that was never set", async () => {
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const pending = developLocal(print({ takenAt: 0 }));
    lib.answer(ok());
    const result = await pending;
    expect(result.status === "ok" && result.params.takenAt).toBe("");
  });

  it("says when the original is only in iCloud, and when the print is gone", async () => {
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const inCloud = developLocal(print());
    lib.answer({ status: "inCloud" });
    await expect(inCloud).resolves.toEqual({ status: "inCloud" });

    const missing = developLocal(print());
    lib.answer({ status: "missing" });
    await expect(missing).resolves.toEqual({ status: "missing" });
  });

  it("calls a failed or malformed local read unreadable", async () => {
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const failed = developLocal(print());
    lib.answer({ status: "failed" });
    await expect(failed).resolves.toEqual({ status: "unreadable" });

    const malformed = developLocal(print());
    lib.answer({ status: "ok", width: 10, height: 10 });
    await expect(malformed).resolves.toEqual({ status: "unreadable" });

    lib.developImage.mockImplementationOnce(() => Promise.reject(new Error("decoder")));
    await expect(developLocal(print())).resolves.toEqual({ status: "unreadable" });
  });

  it("gives up on a local read after 15 seconds, stops Photos, and deletes a copy that comes late", async () => {
    vi.useFakeTimers();
    const lib = new FakeLibrary();
    const { developLocal, LOCAL_TIMEOUT_MS } = await load(lib);
    expect(LOCAL_TIMEOUT_MS).toBe(15_000);
    const result = watch(developLocal(print()));
    const { requestId } = lib.last.options;
    await vi.advanceTimersByTimeAsync(LOCAL_TIMEOUT_MS - 1);
    expect(result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result.value).toEqual({ status: "unreadable" });
    expect(lib.cancelDevelop).toHaveBeenCalledWith(requestId);

    world.files.add(LATE);
    lib.answer(ok(LATE), requestId);
    await flush();
    expect(world.deleted).toEqual([LATE]);
  });

  it("does not ask iCloud while the phone is offline", async () => {
    const lib = new FakeLibrary();
    const { developFromCloud } = await load(lib);
    world.net = { type: "none", isConnected: false };
    await expect(developFromCloud(print())).resolves.toEqual({ status: "offline" });
    expect(world.netCalls).toBe(1);
    expect(lib.developImage).not.toHaveBeenCalled();
  });

  it("brings the original down, reporting only its own progress and only forward", async () => {
    const lib = new FakeLibrary();
    const { developFromCloud } = await load(lib);
    const seen: number[] = [];
    const pending = developFromCloud(print(), { onProgress: (fraction) => seen.push(fraction) });
    await flush();
    expect(lib.last.options).toEqual({ maxSide: 2048, allowNetwork: true, requestId: expect.any(String) });
    expect(lib.listening).toBe(1);

    lib.progress(0.5, "someone-else");
    lib.progress(0.2);
    lib.progress(0.1);
    lib.progress(Number.NaN);
    lib.progress(0.6);
    lib.progress(1.4);
    lib.answer(ok());
    await expect(pending).resolves.toMatchObject({ status: "ok", params: { uri: COPY, width: "2048" } });
    expect(seen).toEqual([0.2, 0.6, 1]);
    expect(lib.listening).toBe(0);
  });

  it("reports a download that takes longer than a minute as iCloud not sending it", async () => {
    vi.useFakeTimers();
    const lib = new FakeLibrary();
    const { developFromCloud, CLOUD_TIMEOUT_MS } = await load(lib);
    expect(CLOUD_TIMEOUT_MS).toBe(60_000);
    const result = watch(developFromCloud(print(), { onProgress: () => undefined }));
    await flush();
    const { requestId } = lib.last.options;
    await vi.advanceTimersByTimeAsync(CLOUD_TIMEOUT_MS - 1);
    expect(result.value).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result.value).toEqual({ status: "cloudFailed" });
    expect(lib.cancelDevelop).toHaveBeenCalledWith(requestId);
    expect(lib.listening).toBe(0);

    world.files.add(LATE);
    lib.answer(ok(LATE), requestId);
    await flush();
    expect(world.deleted).toEqual([LATE]);
  });

  it("reports iCloud refusing as cloudFailed, and a print gone meanwhile as missing", async () => {
    const lib = new FakeLibrary();
    const { developFromCloud } = await load(lib);
    const refused = developFromCloud(print());
    await flush();
    lib.answer({ status: "failed" });
    await expect(refused).resolves.toEqual({ status: "cloudFailed" });

    const stillInCloud = developFromCloud(print());
    await flush();
    lib.answer({ status: "inCloud" });
    await expect(stillInCloud).resolves.toEqual({ status: "cloudFailed" });

    const gone = developFromCloud(print());
    await flush();
    lib.answer({ status: "missing" });
    await expect(gone).resolves.toEqual({ status: "missing" });
  });

  it("settles a stopped download at once, tells Photos, and deletes the copy that arrives anyway", async () => {
    vi.useFakeTimers();
    const lib = new FakeLibrary();
    const { developFromCloud } = await load(lib);
    const controller = new AbortController();
    const seen: number[] = [];
    const result = watch(developFromCloud(print(), { signal: controller.signal, onProgress: (f) => seen.push(f) }));
    await flush();
    const { requestId } = lib.last.options;
    lib.progress(0.3);

    controller.abort();
    await flush();
    // No clock has moved: the answer did not wait for any timeout.
    expect(result.value).toEqual({ status: "cancelled" });
    expect(lib.cancelDevelop).toHaveBeenCalledWith(requestId);
    expect(lib.listening).toBe(0);

    lib.progress(0.8, requestId);
    expect(seen).toEqual([0.3]);

    world.files.add(LATE);
    lib.answer(ok(LATE), requestId);
    await flush();
    expect(world.deleted).toEqual([LATE]);
  });

  it("settles a stopped local read at once", async () => {
    vi.useFakeTimers();
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const controller = new AbortController();
    const result = watch(developLocal(print(), { signal: controller.signal }));
    controller.abort();
    await flush();
    expect(result.value).toEqual({ status: "cancelled" });
    expect(lib.cancelDevelop).toHaveBeenCalledWith(lib.last.options.requestId);
  });

  it("does nothing at all for a develop stopped before it began", async () => {
    const lib = new FakeLibrary();
    const { developFromCloud, developLocal } = await load(lib);
    const controller = new AbortController();
    controller.abort();
    await expect(developLocal(print(), { signal: controller.signal })).resolves.toEqual({ status: "cancelled" });
    await expect(developFromCloud(print(), { signal: controller.signal })).resolves.toEqual({ status: "cancelled" });
    expect(lib.developImage).not.toHaveBeenCalled();
    expect(world.netCalls).toBe(0);
  });

  it("starts no download when the member stops while the connection is being read", async () => {
    const lib = new FakeLibrary();
    const { developFromCloud } = await load(lib);
    let answerNet: (state: unknown) => void = () => undefined;
    world.netAnswer = () => new Promise((resolve) => (answerNet = resolve));
    const controller = new AbortController();
    const result = watch(developFromCloud(print(), { signal: controller.signal }));
    await flush();
    controller.abort();
    await flush();
    expect(result.value).toEqual({ status: "cancelled" });

    answerNet({ type: "wifi", isConnected: true });
    await flush();
    expect(lib.developImage).not.toHaveBeenCalled();
  });

  it("leaves an answer that came before the stop to its caller", async () => {
    const lib = new FakeLibrary();
    const { developLocal } = await load(lib);
    const controller = new AbortController();
    const pending = developLocal(print(), { signal: controller.signal });
    world.files.add(COPY);
    lib.answer(ok());
    const result = await pending;
    controller.abort();
    await flush();
    expect(result.status).toBe("ok");
    expect(world.deleted).toEqual([]);
  });

  it("discards a developed copy that was not posted, once, and nothing it did not make", async () => {
    const lib = new FakeLibrary();
    const { developLocal, discardDeveloped } = await load(lib);
    const pending = developLocal(print());
    lib.answer(ok());
    const result = await pending;
    world.files.add(COPY);
    world.files.add("file:///bundle/asset-3.jpg");

    discardDeveloped(result.status === "ok" ? result.params.uri : null);
    discardDeveloped(COPY);
    discardDeveloped("file:///bundle/asset-3.jpg");
    discardDeveloped(null);
    discardDeveloped(undefined);
    expect(world.deleted).toEqual([COPY]);
  });

  it("knows which set-aside prints are still in the library, and says so when it cannot tell", async () => {
    const lib = new FakeLibrary();
    const { stillInLibrary, progressIsMeasured } = await load(lib);
    lib.present = new Set(["a", "c"]);
    await expect(stillInLibrary(["a", "b", "c"])).resolves.toEqual(["a", "c"]);
    await expect(stillInLibrary([])).resolves.toEqual([]);
    expect(lib.existing).toHaveBeenCalledTimes(1);

    lib.existingError = new Error("E_LIBRARY_ACCESS");
    await expect(stillInLibrary(["a"])).resolves.toBeNull();

    lib.existing.mockImplementationOnce(async () => "nonsense" as unknown as string[]);
    await expect(stillInLibrary(["a"])).resolves.toBeNull();

    expect(progressIsMeasured()).toBe(true);
  });
});

describe("developing without the module", () => {
  const LOCAL = "file:///var/mobile/Media/DCIM/100APPLE/IMG_0001.HEIC";
  const VIDEO = "file:///tmp/3F2A.mov";
  const PREPARED = "file:///caches/ImageManipulator/B2.jpg";

  it("asks for the file with the network off, deletes a Live Photo's video, and prepares the still", async () => {
    const { developLocal } = await load(null);
    world.files.add(VIDEO);
    world.assetInfo.mockResolvedValue({ localUri: LOCAL, isNetworkAsset: false, pairedVideoAsset: { uri: VIDEO } });
    world.prepare.mockResolvedValue({ uri: PREPARED, width: 1536, height: 2048 });

    const result = await developLocal(print());
    expect(world.assetInfo).toHaveBeenCalledWith(ID, { shouldDownloadFromNetwork: false });
    expect(world.deleted).toEqual([VIDEO]);
    expect(world.prepare).toHaveBeenCalledWith(LOCAL);
    expect(result).toMatchObject({ status: "ok", params: { uri: PREPARED, width: "1536", height: "2048", assetId: ID } });
  });

  it("says an original kept in iCloud is in iCloud, without preparing anything", async () => {
    const { developLocal } = await load(null);
    world.assetInfo.mockResolvedValue({ isNetworkAsset: true });
    await expect(developLocal(print())).resolves.toEqual({ status: "inCloud" });
    expect(world.prepare).not.toHaveBeenCalled();
  });

  it("tells a print that is gone from one that would not open", async () => {
    const { developLocal } = await load(null);
    world.assetInfo.mockResolvedValueOnce(null);
    await expect(developLocal(print())).resolves.toEqual({ status: "missing" });

    world.assetInfo.mockRejectedValueOnce(new Error("Asset not found"));
    await expect(developLocal(print())).resolves.toEqual({ status: "missing" });

    world.assetInfo.mockRejectedValueOnce(new Error("Missing photo library permission"));
    await expect(developLocal(print())).resolves.toEqual({ status: "unreadable" });

    world.assetInfo.mockResolvedValueOnce({ localUri: LOCAL, isNetworkAsset: false });
    world.prepare.mockRejectedValueOnce(new Error("decode"));
    await expect(developLocal(print())).resolves.toEqual({ status: "unreadable" });

    world.assetInfo.mockResolvedValueOnce({ isNetworkAsset: false });
    await expect(developLocal(print())).resolves.toEqual({ status: "unreadable" });
  });

  it("gives up after 15 seconds and makes no copy once it has", async () => {
    vi.useFakeTimers();
    const { developLocal } = await load(null);
    let answer: (info: unknown) => void = () => undefined;
    world.assetInfo.mockImplementation(() => new Promise((resolve) => (answer = resolve)));
    const result = watch(developLocal(print()));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(result.value).toEqual({ status: "unreadable" });

    world.files.add(VIDEO);
    answer({ localUri: LOCAL, isNetworkAsset: false, pairedVideoAsset: { uri: VIDEO } });
    await flush();
    expect(world.prepare).not.toHaveBeenCalled();
    expect(world.deleted).toEqual([VIDEO]);
  });

  it("deletes a copy prepared after the member stopped", async () => {
    vi.useFakeTimers();
    const { developLocal } = await load(null);
    world.assetInfo.mockResolvedValue({ localUri: LOCAL, isNetworkAsset: false });
    let prepared: (ready: unknown) => void = () => undefined;
    world.prepare.mockImplementation(() => new Promise((resolve) => (prepared = resolve)));
    const controller = new AbortController();
    const result = watch(developLocal(print(), { signal: controller.signal }));
    await flush();
    expect(world.prepare).toHaveBeenCalledWith(LOCAL);
    controller.abort();
    await flush();
    expect(result.value).toEqual({ status: "cancelled" });

    world.files.add(LATE);
    prepared({ uri: LATE, width: 10, height: 10 });
    await flush();
    expect(world.deleted).toEqual([LATE]);
  });

  it("brings the original down through the ph:// still, with no progress to report", async () => {
    const { developFromCloud, progressIsMeasured } = await load(null);
    world.prepare.mockResolvedValue({ uri: PREPARED, width: 2048, height: 1365 });
    const seen: number[] = [];
    const result = await developFromCloud(print(), { onProgress: (f) => seen.push(f) });
    expect(world.prepare).toHaveBeenCalledWith(`ph://${ID}`);
    expect(world.assetInfo).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "ok", params: { uri: PREPARED, height: "1365" } });
    expect(seen).toEqual([]);
    expect(progressIsMeasured()).toBe(false);
  });

  it("answers a stopped download at once and deletes the still that arrives later", async () => {
    vi.useFakeTimers();
    const { developFromCloud } = await load(null);
    let prepared: (ready: unknown) => void = () => undefined;
    world.prepare.mockImplementation(() => new Promise((resolve) => (prepared = resolve)));
    const controller = new AbortController();
    const result = watch(developFromCloud(print(), { signal: controller.signal }));
    await flush();
    controller.abort();
    await flush();
    expect(result.value).toEqual({ status: "cancelled" });

    world.files.add(LATE);
    prepared({ uri: LATE, width: 10, height: 10 });
    await flush();
    expect(world.deleted).toEqual([LATE]);
  });

  it("reports a refused or slow download as cloudFailed", async () => {
    vi.useFakeTimers();
    const { developFromCloud } = await load(null);
    world.prepare.mockRejectedValueOnce(new Error("The operation couldn’t be completed"));
    const refused = watch(developFromCloud(print()));
    await flush();
    expect(refused.value).toEqual({ status: "cloudFailed" });

    world.prepare.mockRejectedValueOnce(new Error("Asset not found"));
    const gone = watch(developFromCloud(print()));
    await flush();
    expect(gone.value).toEqual({ status: "missing" });

    world.prepare.mockImplementationOnce(() => new Promise(() => undefined));
    const slow = watch(developFromCloud(print()));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(slow.value).toEqual({ status: "cloudFailed" });
  });

  it("cannot tell which prints are still in the library", async () => {
    const { stillInLibrary } = await load(null);
    await expect(stillInLibrary(["a"])).resolves.toBeNull();
  });

  it("skips the copy when asked to stop before it is made", async () => {
    vi.resetModules();
    const { localFileFor } = await import("@/darkroom/localFile");
    world.files.add(VIDEO);
    world.assetInfo.mockResolvedValue({ localUri: LOCAL, isNetworkAsset: false, pairedVideoAsset: { uri: VIDEO } });
    const controller = new AbortController();
    controller.abort();
    await expect(localFileFor(ID, controller.signal)).resolves.toEqual({ status: "failed" });
    expect(world.prepare).not.toHaveBeenCalled();
    expect(world.deleted).toEqual([VIDEO]);
  });
});

describe("prints that are not in Photos", () => {
  it("develops a demo print straight from the app's own picture", async () => {
    const lib = new FakeLibrary();
    const { developFromCloud, developLocal, discardDeveloped } = await load(lib);
    const demo = print({ id: "demo-7", uri: "demo:7", width: 1200, height: 1500 });
    const local = await developLocal(demo);
    expect(local).toMatchObject({
      status: "ok",
      params: { uri: "/assets/demo-7.jpg", width: "1200", height: "1500", assetId: "demo-7", from: "darkroom" },
    });
    await expect(developFromCloud(demo)).resolves.toMatchObject({ status: "ok" });
    expect(lib.developImage).not.toHaveBeenCalled();
    expect(world.netCalls).toBe(0);

    world.files.add("/assets/demo-7.jpg");
    discardDeveloped("/assets/demo-7.jpg");
    expect(world.deleted).toEqual([]);
  });

  it("calls a demo print with no picture missing", async () => {
    const { developLocal } = await load(null);
    await expect(developLocal(print({ uri: "demo:gone" }))).resolves.toEqual({ status: "missing" });
  });

  it("never loads the module in the browser", async () => {
    world.os = "web";
    const lib = new FakeLibrary();
    const { developLocal, progressIsMeasured, stillInLibrary } = await load(lib);
    await expect(developLocal(print({ uri: "demo:3" }))).resolves.toMatchObject({ status: "ok" });
    expect(progressIsMeasured()).toBe(false);
    await expect(stillInLibrary(["a"])).resolves.toBeNull();
    expect(lib.developImage).not.toHaveBeenCalled();
  });
});

describe("the connection", () => {
  it("reads the phone's own link", async () => {
    const { connection } = await load(null);
    const cases: [{ type: string; isConnected: boolean | null }, string][] = [
      [{ type: "wifi", isConnected: true }, "wifi"],
      [{ type: "cellular", isConnected: true }, "cellular"],
      [{ type: "ethernet", isConnected: true }, "wifi"],
      [{ type: "unknown", isConnected: null }, "wifi"],
      [{ type: "cellular", isConnected: false }, "offline"],
      [{ type: "none", isConnected: null }, "offline"],
    ];
    for (const [state, expected] of cases) {
      world.net = state;
      await expect(connection()).resolves.toBe(expected);
    }
  });

  it("counts a connection it cannot read as there", async () => {
    const { connection } = await load(null);
    world.netAnswer = () => Promise.reject(new Error("NetInfo"));
    await expect(connection()).resolves.toBe("wifi");
  });
});

describe("the pinch guard", () => {
  async function loadPager(native: Record<string, unknown> | null) {
    vi.resetModules();
    world.natives = native ? { VintagePager: native } : {};
    return import("@/utils/pagerTouches");
  }

  it("tells the list's own scroll view to keep to one finger", async () => {
    const native = { keepToOneFinger: vi.fn(async () => true), keepScrollToOneFinger: vi.fn(async () => true) };
    const { keepScrollToOneFinger } = await loadPager(native);
    await expect(keepScrollToOneFinger({ getScrollableNode: () => 42 })).resolves.toBe(true);
    expect(native.keepScrollToOneFinger).toHaveBeenCalledWith(42);
    await expect(keepScrollToOneFinger({ nativeTag: 7 })).resolves.toBe(true);
    expect(native.keepScrollToOneFinger).toHaveBeenLastCalledWith(7);
    expect(native.keepToOneFinger).not.toHaveBeenCalled();
  });

  it("tries again while the list's native view is not there yet", async () => {
    vi.useFakeTimers();
    const native = { keepToOneFinger: vi.fn(), keepScrollToOneFinger: vi.fn() };
    native.keepScrollToOneFinger.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const { keepScrollToOneFinger } = await loadPager(native);
    const told = watch(keepScrollToOneFinger({ nativeTag: 9 }));
    await vi.advanceTimersByTimeAsync(300);
    expect(told.value).toBe(true);
    expect(native.keepScrollToOneFinger).toHaveBeenCalledTimes(2);
  });

  it("carries on in a binary that cannot", async () => {
    const older = { keepToOneFinger: vi.fn(async () => true) };
    const { keepScrollToOneFinger } = await loadPager(older);
    await expect(keepScrollToOneFinger({ nativeTag: 7 })).resolves.toBe(false);
    expect(older.keepToOneFinger).not.toHaveBeenCalled();

    const none = await loadPager(null);
    await expect(none.keepScrollToOneFinger({ nativeTag: 7 })).resolves.toBe(false);
    await expect(none.keepScrollToOneFinger(null)).resolves.toBe(false);
  });

  it("leaves the tab pager's rule as it was", async () => {
    const native = { keepToOneFinger: vi.fn(async () => true), keepScrollToOneFinger: vi.fn(async () => true) };
    const { keepPagerToOneFinger } = await loadPager(native);
    await expect(keepPagerToOneFinger({ nativeTag: 3 })).resolves.toBe(true);
    expect(native.keepToOneFinger).toHaveBeenCalledWith(3);
    expect(native.keepScrollToOneFinger).not.toHaveBeenCalled();
  });
});
