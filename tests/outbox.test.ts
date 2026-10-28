import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InfiniteData } from "@tanstack/react-query";
import type { PostRow, PostWithAuthor } from "@/types/db";
import type { PendingPost, PostDraft } from "@/uploads";

/**
 * The post outbox, end to end in node: the state machine, the order of
 * the network writes, what is kept on disk, and what the card is told.
 *
 * Everything native is faked at the module boundary: the file system (an
 * in-memory tree behind the same File/Directory/Paths API), the native
 * upload task, Supabase, NetInfo, AppState, the photo preparer and the
 * video bake. The outbox, its disk format, the storage upload, uploadFile
 * and createPost all run for real against those fakes.
 */

type UploadRecord = {
  url: string;
  fileUri: string;
  options: { httpMethod?: string; uploadType?: number; sessionType?: number; headers?: Record<string, string> };
  callback?: (p: { totalBytesSent: number; totalBytesExpectedToSend: number }) => void;
  cancelled: boolean;
};
type UploadResult = { status: number; body: string; headers: Record<string, string> };

const h = vi.hoisted(() => {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const calls: string[] = [];
  const uploads: UploadRecord[] = [];
  const inserts: Record<string, unknown>[] = [];
  const removed: string[] = [];

  const okUpload = async (r: UploadRecord): Promise<UploadResult> => {
    const size = files.get(r.fileUri)?.length ?? 0;
    r.callback?.({ totalBytesSent: Math.floor(size / 2), totalBytesExpectedToSend: size });
    r.callback?.({ totalBytesSent: size, totalBytesExpectedToSend: size });
    return { status: 200, body: JSON.stringify({ Key: "ok" }), headers: {} };
  };

  const state = {
    demo: false,
    online: true,
    signedIn: true,
    sessionUser: "u1",
    tokenVersion: 0,
    expiresIn: 3600,
    postExists: false,
    postCheckFails: false,
    locked: false,
    counter: 0,
    appListeners: [] as ((s: string) => void)[],
    netListeners: [] as ((s: { isConnected: boolean }) => void)[],
    authListeners: [] as ((e: string) => void)[],
    uploadBehavior: null as null | ((r: UploadRecord) => Promise<UploadResult>),
    insertBehavior: null as null | ((row: unknown, signal: AbortSignal) => Promise<{ error: unknown }>),
    bake: null as null | ((uri: string, filter: unknown, opts?: { onProgress?: (f: number) => void }) => Promise<unknown>),
  };

  const defaultBake = async (_uri: string, _filter: unknown, opts?: { onProgress?: (f: number) => void }) => {
    opts?.onProgress?.(0.4);
    opts?.onProgress?.(1);
    const uri = `file:///tmp/baked-${++state.counter}.mp4`;
    files.set(uri, "v".repeat(5000));
    return { uri, width: 1080, height: 1920, duration: 60.6, bytes: 5000, bitrate: 3_000_000 };
  };

  const norm = (u: string) => u.replace(/\/+$/, "");
  const join = (parts: unknown[]) =>
    parts
      .map((p) => (typeof p === "string" ? p : (p as { uri: string }).uri))
      .join("/")
      // Runs of slashes collapse, except the three after the scheme.
      .replace(/^file:\/+|\/{2,}/g, (run) => (run.startsWith("file:") ? "file:///" : "/"));

  class FakeFile {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = norm(join(parts));
    }
    get exists() {
      return files.has(this.uri);
    }
    get size() {
      return files.get(this.uri)?.length ?? 0;
    }
    textSync() {
      const t = files.get(this.uri);
      if (t == null) throw new Error("No such file");
      return t;
    }
    write(content: string) {
      files.set(this.uri, content);
    }
    create() {
      if (files.has(this.uri)) throw new Error("File exists");
      files.set(this.uri, "");
    }
    delete() {
      if (!files.has(this.uri)) throw new Error("No such file");
      files.delete(this.uri);
    }
    copy(dest: FakeFile) {
      if (!files.has(this.uri)) throw new Error("No such file");
      if (files.has(dest.uri)) throw new Error("Destination exists");
      files.set(dest.uri, files.get(this.uri)!);
    }
    move(dest: FakeFile) {
      this.copy(dest);
      files.delete(this.uri);
      this.uri = dest.uri;
    }
  }

  class FakeDirectory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = `${norm(join(parts))}/`;
    }
    private get key() {
      return norm(this.uri);
    }
    get exists() {
      return dirs.has(this.key);
    }
    create() {
      dirs.add(this.key);
    }
    delete() {
      const k = this.key;
      if (!dirs.has(k)) throw new Error("No such directory");
      for (const d of [...dirs]) if (d === k || d.startsWith(`${k}/`)) dirs.delete(d);
      for (const f of [...files.keys()]) if (f.startsWith(`${k}/`)) files.delete(f);
    }
    list() {
      const k = this.key;
      const child = (p: string) => p.startsWith(`${k}/`) && !p.slice(k.length + 1).includes("/");
      return [
        ...[...dirs].filter(child).map((d) => new FakeDirectory(d)),
        ...[...files.keys()].filter(child).map((f) => new FakeFile(f)),
      ];
    }
  }

  /** What SecureStore throws for a keychain read while the phone is locked. */
  const keychainError = () =>
    Object.assign(
      new Error("Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: User interaction is not allowed."),
      { code: "ERR_KEY_CHAIN" },
    );

  return { files, dirs, calls, uploads, inserts, removed, state, okUpload, defaultBake, keychainError, FakeFile, FakeDirectory };
});

vi.mock("react-native", () => ({
  Platform: { OS: "ios", select: (o: Record<string, unknown>) => o.ios ?? o.default },
  AppState: {
    currentState: "active",
    addEventListener: (_type: string, fn: (s: string) => void) => {
      h.state.appListeners.push(fn);
      return { remove: () => (h.state.appListeners = h.state.appListeners.filter((f) => f !== fn)) };
    },
  },
  Alert: { alert: () => undefined },
}));

vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (fn: (s: { isConnected: boolean }) => void) => {
      h.state.netListeners.push(fn);
      fn({ isConnected: h.state.online });
      return () => (h.state.netListeners = h.state.netListeners.filter((f) => f !== fn));
    },
    fetch: async () => ({ isConnected: h.state.online }),
  },
}));

vi.mock("expo-file-system", () => ({
  File: h.FakeFile,
  Directory: h.FakeDirectory,
  Paths: {
    get document() {
      return new h.FakeDirectory("file:///docs");
    },
    get cache() {
      return new h.FakeDirectory("file:///cache");
    },
  },
}));

vi.mock("expo-file-system/legacy", () => ({
  FileSystemUploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  FileSystemSessionType: { BACKGROUND: 0, FOREGROUND: 1 },
  createUploadTask: (url: string, fileUri: string, options: UploadRecord["options"], callback?: UploadRecord["callback"]) => {
    const record: UploadRecord = { url, fileUri, options, callback, cancelled: false };
    h.uploads.push(record);
    return {
      uploadAsync: async () => {
        const bucket = url.split("/storage/v1/object/")[1].split("/")[0];
        h.calls.push(`upload:${bucket}`);
        return (h.state.uploadBehavior ?? h.okUpload)(record);
      },
      cancelAsync: async () => {
        record.cancelled = true;
      },
    };
  },
}));

vi.mock("expo-image-manipulator", () => ({}));
vi.mock("expo-image", () => ({ Image: { prefetch: vi.fn(async () => true) } }));
vi.mock("expo-modules-core", () => ({ requireOptionalNativeModule: () => null }));

vi.mock("expo-video-thumbnails", () => ({
  getThumbnailAsync: vi.fn(async (clip: string) => {
    if (!h.files.has(clip)) throw new Error("No clip");
    const uri = `file:///cache/frame-${++h.state.counter}.jpg`;
    h.files.set(uri, "f".repeat(2000));
    return { uri, width: 1080, height: 1920 };
  }),
}));

vi.mock("@/media/nativeMedia", () => ({
  prepareImage: vi.fn(async (uri: string, opts: { maxSide: number; thumbSide?: number }) => {
    h.calls.push("prepare");
    if (!h.files.has(uri)) throw new Error("The file couldn’t be read");
    const n = ++h.state.counter;
    const out = `file:///cache/prepared-${n}.jpg`;
    h.files.set(out, "p".repeat(3000));
    const result: Record<string, unknown> = { uri: out, width: 1152, height: 1440 };
    if (opts.thumbSide) {
      const thumb = `file:///cache/thumb-${n}.jpg`;
      h.files.set(thumb, "t".repeat(300));
      result.thumb = { uri: thumb, width: 384, height: 480 };
    }
    return result;
  }),
}));

vi.mock("@/filters/bakeVideo", async () => {
  const actual = await vi.importActual<typeof import("@/filters/bakeVideo")>("@/filters/bakeVideo");
  return {
    ...actual,
    bakeVideo: vi.fn((uri: string, filter: unknown, opts?: { onProgress?: (f: number) => void }) =>
      (h.state.bake ?? h.defaultBake)(uri, filter, opts),
    ),
    inspectVideo: vi.fn(async () => null),
  };
});

vi.mock("@/lib/env", () => ({
  isDemoMode: () => h.state.demo,
  isSupabaseConfigured: () => true,
  requireEnv: () => ({ supabaseUrl: "https://proj.supabase.co/", supabaseAnonKey: "anon-key" }),
}));

vi.mock("@/lib/supabase", () => {
  const session = () => ({
    access_token: `tok-${h.state.tokenVersion}`,
    expires_at: Math.floor(Date.now() / 1000) + h.state.expiresIn,
    user: { id: h.state.sessionUser },
  });
  return {
    supabase: {
      auth: {
        getSession: vi.fn(async () => {
          // What SecureStore throws for a read while the phone is locked.
          if (h.state.locked) throw h.keychainError();
          return { data: { session: h.state.signedIn ? session() : null }, error: null };
        }),
        refreshSession: vi.fn(async () => {
          h.state.tokenVersion += 1;
          h.state.expiresIn = 3600;
          return { data: { session: session() }, error: null };
        }),
        onAuthStateChange: vi.fn((cb: (e: string) => void) => {
          h.state.authListeners.push(cb);
          return { data: { subscription: { unsubscribe: () => undefined } } };
        }),
      },
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => ({
          abortSignal: (signal: AbortSignal) => {
            h.calls.push(`insert:${table}`);
            h.inserts.push(row);
            // supabase-js reads the session before the request; postgrest-js
            // turns the throw into an error with no status.
            if (h.state.locked) {
              return Promise.resolve({ error: { message: `Error: ${h.keychainError().message}`, details: "", hint: "", code: "" } });
            }
            return (h.state.insertBehavior ?? (async () => ({ error: null })))(row, signal);
          },
        }),
        select: () => {
          const chain = {
            eq: () => chain,
            abortSignal: () => chain,
            maybeSingle: async () => {
              h.calls.push(`select:${table}`);
              if (h.state.postCheckFails) return { data: null, error: { message: "TypeError: Network request failed", code: "" } };
              return { data: h.state.postExists ? { id: "x" } : null, error: null };
            },
          };
          return chain;
        },
      }),
      storage: {
        from: (bucket: string) => ({
          getPublicUrl: (key: string) => ({ data: { publicUrl: `https://cdn.test/${bucket}/${key}` } }),
          remove: async (keys: string[]) => {
            h.removed.push(...keys.map((k) => `${bucket}/${k}`));
            return { data: [], error: null };
          },
        }),
      },
    },
  };
});

vi.mock("@/lib/queryClient", async () => {
  const { QueryClient } = await import("@tanstack/react-query");
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }) };
});

vi.mock("@/api/tags", () => ({
  tagMembers: vi.fn(async () => {
    h.calls.push("tags");
  }),
}));
vi.mock("@/darkroom/posted", () => ({ markDeveloped: vi.fn() }));
vi.mock("@/utils/reverseGeocode", () => ({ rememberPlace: vi.fn(async () => undefined) }));
vi.mock("@/utils/alert", () => ({ showAlert: vi.fn() }));
vi.mock("@/demo/photos", () => ({ DEMO_PREFIX: "demo:" }));
vi.mock("@/demo/photoAssets", () => ({ PHOTOS: {} }));
vi.mock("@/demo/store", () => ({ demoFetchPost: vi.fn(() => null), demoCreatePost: vi.fn() }));

const {
  __outboxTesting,
  clampDuration,
  discardPost,
  enqueuePost,
  forgetOutbox,
  holdPost,
  notePostDeleted,
  notePostsInFeed,
  retryPost,
  setOutboxProfileRefresher,
  startOutbox,
} = await import("@/uploads/outbox");
const { getPendingPosts, subscribePendingPosts, pendingNeedsTop } = await import("@/uploads/store");
const { parseJob, readJob } = await import("@/uploads/jobFiles");
const { stateLine, overallProgress, accessibilityLine } = await import("@/uploads/words");
const { prependToFeed, prependToList, placeConfirmedPost } = await import("@/uploads/feedCache");
const { InfiniteQueryObserver, QueryClient, QueryObserver } = await import("@tanstack/react-query");
const { Image } = await import("expo-image");
const VideoThumbnails = await import("expo-video-thumbnails");
const { uploadToStorage, StorageUploadError, UploadRestart, isExpiredAuth, isSessionUnavailable } = await import(
  "@/uploads/storageUpload"
);
const { uploadFile } = await import("@/api/media");
const { queryClient } = await import("@/lib/queryClient");
const { supabase } = await import("@/lib/supabase");
const { tagMembers } = await import("@/api/tags");
const { markDeveloped } = await import("@/darkroom/posted");
const { rememberPlace } = await import("@/utils/reverseGeocode");
const { showAlert } = await import("@/utils/alert");
const { bakeVideo } = await import("@/filters/bakeVideo");
const demoStore = await import("@/demo/store");
const { isTransient, withTimeout, TimeoutError } = await import("@/utils/retry");

let seq = 0;
function newId(): string {
  seq += 1;
  return `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

function photoDraft(over: Partial<PostDraft> = {}): PostDraft {
  const id = over.id ?? newId();
  const sourceUri = over.sourceUri ?? `file:///picker/${id}.jpg`;
  h.files.set(sourceUri, "s".repeat(4000));
  return {
    id,
    userId: "u1",
    kind: "photo",
    sourceUri,
    sourceWidth: 1200,
    sourceHeight: 1500,
    durationSeconds: null,
    filterId: "cassette",
    filterBaked: true,
    bakeVideo: false,
    showDateStamp: true,
    caption: "  Leith, at dusk  ",
    takenAt: "2026-06-14T18:22:00.000Z",
    location: "Leith",
    lat: 55.975,
    lng: -3.17,
    placeId: "place-1",
    tagIds: ["u2"],
    assetId: "asset-1",
    author: { id: "u1", username: "june", full_name: "June", avatar_url: null },
    ...over,
  };
}

function videoDraft(over: Partial<PostDraft> = {}): PostDraft {
  const id = over.id ?? newId();
  const sourceUri = `file:///tmp/picked-${id}.mov`;
  h.files.set(sourceUri, "m".repeat(9000));
  return photoDraft({
    id,
    kind: "video",
    sourceUri,
    sourceWidth: 1080,
    sourceHeight: 1920,
    durationSeconds: 61,
    filterId: "seventy",
    filterBaked: false,
    bakeVideo: true,
    tagIds: [],
    assetId: null,
    ...over,
  });
}

const idle = () => __outboxTesting.idle();
const jobPath = (id: string, name: string) => `file:///docs/outbox/${id}/${name}`;
const count = (call: string) => h.calls.filter((c) => c === call).length;

async function waitUntil(check: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 0));
  expect(check()).toBe(true);
}

function setOnline(online: boolean): void {
  h.state.online = online;
  for (const fn of [...h.state.netListeners]) fn({ isConnected: online });
}

function setAppState(next: string): void {
  for (const fn of [...h.state.appListeners]) fn(next);
}

const refusal = (statusCode: string, message: string): UploadResult => ({
  status: 400,
  body: JSON.stringify({ statusCode, error: "Refused", message }),
  headers: {},
});

const existing: PostWithAuthor = {
  id: "older-post",
  author_id: "u3",
  media_type: "photo",
  media_path: "u3/older-post.jpg",
  thumb_path: "u3/older-post.jpg",
  width: 1000,
  height: 1000,
  duration_seconds: null,
  filter_id: "none",
  filter_baked: true,
  show_date_stamp: false,
  caption: "",
  taken_at: null,
  location: null,
  lat: null,
  lng: null,
  place_id: null,
  like_count: 3,
  comment_count: 0,
  created_at: "2026-10-01T00:00:00.000Z",
  removed_at: null,
  removed_by: null,
  author: { id: "u3", username: "tomas", full_name: null, avatar_url: null },
};

function seedCaches(): void {
  queryClient.setQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"], { pages: [[existing]], pageParams: [0] });
  const { author: _a, ...row } = existing;
  queryClient.setQueryData<PostRow[]>(["user-posts", "u1"], [row]);
}

// A test on fake timers that fails before its own `finally` would leave them
// on for every test after it, each of which would then time out as well.
afterEach(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  forgetOutbox();
  __outboxTesting.relaunch();
  h.files.clear();
  h.dirs.clear();
  h.calls.length = 0;
  h.uploads.length = 0;
  h.inserts.length = 0;
  h.removed.length = 0;
  Object.assign(h.state, {
    demo: false,
    online: true,
    signedIn: true,
    sessionUser: "u1",
    tokenVersion: 0,
    expiresIn: 3600,
    postExists: false,
    postCheckFails: false,
    locked: false,
    uploadBehavior: null,
    insertBehavior: null,
    bake: null,
  });
  h.state.appListeners = [];
  h.state.netListeners = [];
  h.state.authListeners = [];
  vi.clearAllMocks();
  queryClient.clear();
  setOutboxProfileRefresher(null);
  __outboxTesting.setDoneGraceMs(0);
  __outboxTesting.setSleep(async (_ms, signal) => {
    if (signal?.aborted) throw Object.assign(new Error("Cancelled"), { name: "AbortError" });
  });
  startOutbox();
});

describe("a photograph, start to finish", () => {
  it("copies the source, persists the job and shows the card before anything goes up", async () => {
    const draft = photoDraft();
    await enqueuePost(draft);
    expect(h.files.get(jobPath(draft.id, "source.jpg"))).toBe(h.files.get(draft.sourceUri));
    expect(readJob(draft.id)).toMatchObject({ id: draft.id, step: "prepare", files: { source: "source.jpg" } });
    expect(getPendingPosts()).toHaveLength(1);
    expect(getPendingPosts()[0]).toMatchObject({
      id: draft.id,
      state: "preparing",
      previewUri: jobPath(draft.id, "source.jpg"),
      previewBaked: true,
    });
    expect(h.uploads).toHaveLength(0);
    await idle();
  });

  it("uploads both files natively, inserts last, then tags, and hands over to the feed", async () => {
    seedCaches();
    const refresh = vi.fn(async () => true);
    setOutboxProfileRefresher(refresh);
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();

    // Both uploads before the insert, the tags after it.
    const media = h.calls.indexOf("upload:media");
    const thumb = h.calls.indexOf("upload:thumbnails");
    const insert = h.calls.indexOf("insert:posts");
    const tags = h.calls.indexOf("tags");
    expect(media).toBeGreaterThan(-1);
    expect(thumb).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(Math.max(media, thumb));
    expect(tags).toBeGreaterThan(insert);
    expect(count("insert:posts")).toBe(1);

    // One decode for the feed copy and its thumbnail.
    expect(count("prepare")).toBe(1);

    const up = h.uploads.find((u) => u.url.includes("/object/media/"))!;
    expect(up.url).toBe(`https://proj.supabase.co/storage/v1/object/media/u1/${draft.id}.jpg`);
    expect(up.fileUri).toBe(jobPath(draft.id, "media.jpg"));
    expect(up.options).toMatchObject({
      httpMethod: "POST",
      uploadType: 0, // BINARY_CONTENT
      sessionType: 0, // BACKGROUND
      headers: {
        authorization: "Bearer tok-0",
        apikey: "anon-key",
        "content-type": "image/jpeg",
        "x-upsert": "false",
        "cache-control": "max-age=31536000",
      },
    });
    const upThumb = h.uploads.find((u) => u.url.includes("/object/thumbnails/"))!;
    expect(upThumb.url).toBe(`https://proj.supabase.co/storage/v1/object/thumbnails/u1/${draft.id}.jpg`);

    expect(h.inserts[0]).toEqual({
      id: draft.id,
      author_id: "u1",
      media_type: "photo",
      media_path: `u1/${draft.id}.jpg`,
      thumb_path: `u1/${draft.id}.jpg`,
      width: 1152,
      height: 1440,
      duration_seconds: null,
      filter_id: "cassette",
      filter_baked: true,
      show_date_stamp: true,
      caption: "Leith, at dusk",
      taken_at: "2026-06-14T18:22:00.000Z",
      location: "Leith",
      lat: 55.975,
      lng: -3.17,
      place_id: "place-1",
    });

    expect(tagMembers).toHaveBeenCalledWith(draft.id, "u1", ["u2"]);
    expect(markDeveloped).toHaveBeenCalledWith("asset-1");
    expect(rememberPlace).toHaveBeenCalledWith({ lat: 55.975, lng: -3.17 });
    expect(refresh).toHaveBeenCalledTimes(1);

    // The server's row, drawn from the files already on the phone.
    const feed = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!;
    expect(feed.pages[0].map((p) => p.id)).toEqual([draft.id, "older-post"]);
    expect(feed.pages[0][0]).toMatchObject({
      media_path: jobPath(draft.id, "source.jpg"),
      thumb_path: jobPath(draft.id, "thumb.jpg"),
      filter_baked: true,
      like_count: 0,
      comment_count: 0,
      author: { id: "u1", username: "june" },
    });
    // Marked stale, not refetched: the offset paging stays where it was.
    expect(queryClient.getQueryState(["feed", "u1"])?.isInvalidated).toBe(true);
    const grid = queryClient.getQueryData<PostRow[]>(["user-posts", "u1"])!;
    expect(grid.map((p) => p.id)).toEqual([draft.id, "older-post"]);
    expect("author" in grid[0]).toBe(false);

    expect(getPendingPosts()).toHaveLength(0);
    expect(readJob(draft.id)).toMatchObject({ step: "done", uploaded: { media: true, thumb: true }, failed: null });
    // Kept until the next launch, so the feed row can go on drawing from them.
    expect(h.files.has(jobPath(draft.id, "media.jpg"))).toBe(true);
    expect(h.files.has(jobPath(draft.id, "thumb.jpg"))).toBe(true);
  });

  it("refreshes a token about to expire, once, before the uploads", async () => {
    h.state.expiresIn = 120;
    await enqueuePost(photoDraft());
    await idle();
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(h.uploads.map((u) => u.options.headers?.authorization)).toEqual(["Bearer tok-1", "Bearer tok-1"]);
  });

  it("clears a finished job at the next launch", async () => {
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(true);
    __outboxTesting.relaunch();
    startOutbox();
    await idle();
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect([...h.files.keys()].some((k) => k.includes(draft.id) && k.startsWith("file:///docs"))).toBe(false);
  });
});

describe("a clip, start to finish", () => {
  it("develops with progress, uploads with progress, and posts the developed clip", async () => {
    const seen: [string, number | null][] = [];
    const stop = subscribePendingPosts(() => {
      const p = getPendingPosts()[0];
      if (p) seen.push([p.state, p.progress]);
    });
    const draft = videoDraft();
    await enqueuePost(draft);
    await idle();
    stop();

    expect(seen).toContainEqual(["developing", 0.4]);
    expect(seen.some(([s, p]) => s === "uploading" && p != null && p > 0 && p < 1)).toBe(true);
    expect(bakeVideo).toHaveBeenCalledWith(
      jobPath(draft.id, "source.mov"),
      expect.objectContaining({ id: "seventy" }),
      expect.objectContaining({ jobId: draft.id }),
    );
    expect(h.inserts[0]).toMatchObject({
      media_type: "video",
      media_path: `u1/${draft.id}.mp4`,
      thumb_path: `u1/${draft.id}.jpg`,
      width: 1080,
      height: 1920,
      // 60.6 s measured on the developed file, held to the column's 1–60.
      duration_seconds: 60,
      filter_baked: true,
    });
    const up = h.uploads.find((u) => u.url.includes("/object/media/"))!;
    expect(up.fileUri).toBe(jobPath(draft.id, "media.mp4"));
    expect(up.options.headers?.["content-type"]).toBe("video/mp4");
    // The source copy goes once it has been developed.
    expect(h.files.has(jobPath(draft.id, "source.mov"))).toBe(false);
    expect(h.files.has(jobPath(draft.id, "media.mp4"))).toBe(true);
  });

  it("waits for the app to be open when the bake was interrupted, then develops it again", async () => {
    let first = true;
    h.state.bake = async (uri, filter, opts) => {
      if (first) {
        first = false;
        // The member went to another app; the native side stops the bake.
        setAppState("background");
        throw Object.assign(new Error("The app left the foreground"), { code: "E_BAKE_INTERRUPTED" });
      }
      return h.defaultBake(uri, filter, opts);
    };
    const draft = videoDraft();
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "waiting-foreground" });
    expect(stateLine("waiting-foreground", null, "video")).toBe("Will finish when VINTAGE is open");
    expect(h.uploads).toHaveLength(0);

    setAppState("active");
    await idle();
    expect(bakeVideo).toHaveBeenCalledTimes(2);
    expect(count("insert:posts")).toBe(1);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("does not start a bake with the app in the background", async () => {
    setAppState("background");
    await enqueuePost(videoDraft());
    await idle();
    expect(bakeVideo).not.toHaveBeenCalled();
    expect(getPendingPosts()[0].state).toBe("waiting-foreground");
    setAppState("active");
    await idle();
    expect(bakeVideo).toHaveBeenCalledTimes(1);
    expect(count("insert:posts")).toBe(1);
  });

  it("never posts the original when the clip will not develop", async () => {
    h.state.bake = async () => {
      throw new Error("The export failed");
    };
    const draft = videoDraft();
    await enqueuePost(draft);
    await idle();
    expect(bakeVideo).toHaveBeenCalledTimes(3);
    expect(h.uploads).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The clip wouldn’t develop." });
  });

  it("posts a clip a build cannot develop as recorded, unbaked, with the length held to 1–60", async () => {
    const draft = videoDraft({ bakeVideo: false, durationSeconds: 61 });
    await enqueuePost(draft);
    await idle();
    expect(bakeVideo).not.toHaveBeenCalled();
    expect(h.inserts[0]).toMatchObject({
      media_path: `u1/${draft.id}.mov`,
      filter_baked: false,
      duration_seconds: 60,
    });
    expect(h.uploads.find((u) => u.url.includes("/object/media/"))!.options.headers?.["content-type"]).toBe(
      "video/quicktime",
    );
  });
});

describe("failures and retries", () => {
  it("tries a dropped upload again and goes on", async () => {
    let n = 0;
    h.state.uploadBehavior = async (r) => {
      if (r.url.includes("/object/media/") && n++ === 0) return { status: 503, body: "<html>busy</html>", headers: {} };
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:media")).toBe(2);
    // The thumbnail landed the first time and is not sent again.
    expect(count("upload:thumbnails")).toBe(1);
    expect(count("insert:posts")).toBe(1);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("stops at a refusal with Retry and Discard, and Retry finishes it", async () => {
    h.state.uploadBehavior = async (r) =>
      r.url.includes("/object/media/") ? refusal("403", "new row violates row-level security policy") : h.okUpload(r);
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(count("upload:media")).toBe(1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The photograph didn’t upload." });
    expect(stateLine("failed", null, "photo")).toBe("Couldn’t post.");
    expect(readJob(draft.id)?.failed?.message).toBe("The photograph didn’t upload.");
    expect(h.inserts).toHaveLength(0);

    h.state.uploadBehavior = null;
    retryPost(draft.id);
    await idle();
    expect(count("insert:posts")).toBe(1);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("never inserts the post when an upload ultimately fails, so nobody is notified", async () => {
    h.state.uploadBehavior = async (r) =>
      r.url.includes("/object/thumbnails/") ? { status: 502, body: "", headers: {} } : h.okUpload(r);
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:thumbnails")).toBe(4);
    expect(count("upload:media")).toBe(1);
    expect(h.inserts).toHaveLength(0);
    expect(tagMembers).not.toHaveBeenCalled();
    expect(markDeveloped).not.toHaveBeenCalled();
    expect(getPendingPosts()[0].state).toBe("failed");
  });

  it("counts a storage 409 and a Postgres 23505 as done", async () => {
    seedCaches();
    h.state.uploadBehavior = async () => refusal("409", "The resource already exists");
    h.state.insertBehavior = async () => ({
      error: { code: "23505", message: 'duplicate key value violates unique constraint "posts_pkey"' },
    });
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(count("upload:media")).toBe(1);
    expect(count("insert:posts")).toBe(1);
    expect(readJob(draft.id)?.step).toBe("done");
    expect(getPendingPosts()).toHaveLength(0);
    const feed = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!;
    expect(feed.pages[0][0].id).toBe(draft.id);
  });

  it("asks for a new token when storage says the old one expired", async () => {
    let first = true;
    h.state.uploadBehavior = async (r) => {
      if (first && r.url.includes("/object/media/")) {
        first = false;
        return refusal("403", "jwt expired");
      }
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    const mediaTries = h.uploads.filter((u) => u.url.includes("/object/media/"));
    expect(mediaTries.map((u) => u.options.headers?.authorization)).toEqual(["Bearer tok-0", "Bearer tok-1"]);
    expect(count("insert:posts")).toBe(1);
  });

  it("ignores the same post enqueued twice", async () => {
    const draft = photoDraft();
    await Promise.all([enqueuePost(draft), enqueuePost(draft)]);
    await enqueuePost(draft);
    await idle();
    expect(count("upload:media")).toBe(1);
    expect(count("insert:posts")).toBe(1);
  });

  it("refuses a draft without a usable id", async () => {
    await expect(enqueuePost(photoDraft({ id: "../../etc" }))).rejects.toThrow();
    expect(getPendingPosts()).toHaveLength(0);
  });
});

describe("surviving the app", () => {
  it("resumes from job.json after a relaunch without uploading again", async () => {
    // The app is closed while the insert is out.
    h.state.insertBehavior = () => new Promise(() => undefined);
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => count("insert:posts") === 1);
    __outboxTesting.relaunch();

    const saved = readJob(draft.id)!;
    expect(saved).toMatchObject({ step: "insert", uploaded: { media: true, thumb: true }, insertTried: true });
    expect(saved.files).toEqual({ source: "source.jpg", media: "media.jpg", thumb: "thumb.jpg" });

    h.state.insertBehavior = null;
    const uploadsBefore = h.uploads.length;
    startOutbox();
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "saving" });
    await idle();
    expect(h.uploads.length).toBe(uploadsBefore);
    expect(count("insert:posts")).toBe(2);
    expect(readJob(draft.id)?.step).toBe("done");
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("waits for a connection during the upload instead of failing, and says so", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.uploadBehavior = async (r) => {
      await gate;
      return h.okUpload(r);
    };
    setOnline(false);
    const draft = photoDraft();
    await enqueuePost(draft);
    // A background session takes the uploads and holds them until there is a network.
    await waitUntil(() => h.uploads.length === 2);
    expect(getPendingPosts()[0].state).toBe("waiting-network");
    expect(stateLine("waiting-network", null, "photo")).toBe("Waiting for a connection");

    setOnline(true);
    expect(getPendingPosts()[0].state).toBe("uploading");
    release();
    await idle();
    expect(count("insert:posts")).toBe(1);
  });

  it("holds the insert while offline and resumes it on reconnect", async () => {
    setOnline(false);
    await enqueuePost(photoDraft());
    await idle();
    expect(getPendingPosts()[0].state).toBe("waiting-network");
    expect(h.inserts).toHaveLength(0);

    setOnline(true);
    await idle();
    expect(count("insert:posts")).toBe(1);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("drops a job that belongs to someone no longer signed in here", async () => {
    h.state.sessionUser = "someone-else";
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(h.uploads).toHaveLength(0);
    expect(getPendingPosts()).toHaveLength(0);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
  });
});

describe("discarding and forgetting", () => {
  it("discard deletes the files and removes what reached storage", async () => {
    h.state.uploadBehavior = async (r) =>
      r.url.includes("/object/thumbnails/") ? refusal("403", "new row violates row-level security policy") : h.okUpload(r);
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0].state).toBe("failed");

    await discardPost(draft.id);
    expect(getPendingPosts()).toHaveLength(0);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect([...h.files.keys()].some((k) => k.startsWith(`file:///docs/outbox/${draft.id}`))).toBe(false);
    expect([...h.removed].sort()).toEqual([`media/u1/${draft.id}.jpg`, `thumbnails/u1/${draft.id}.jpg`]);
    // Nothing was inserted, so there was no post to ask about.
    expect(h.calls).not.toContain("select:posts");
  });

  it("discards a refused insert, once the server says the post is not there", async () => {
    h.state.insertBehavior = async () => ({ error: { code: "42501", message: "new row violates row-level security policy" } });
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The post wasn’t saved." });
    await discardPost(draft.id);
    expect(h.calls).toContain("select:posts");
    expect([...h.removed].sort()).toEqual([`media/u1/${draft.id}.jpg`, `thumbnails/u1/${draft.id}.jpg`]);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("forgetOutbox cancels what is in flight and deletes every job and file", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.uploadBehavior = async (r) => {
      await gate;
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await enqueuePost(photoDraft());
    await waitUntil(() => h.uploads.length === 2);

    forgetOutbox();
    expect(getPendingPosts()).toHaveLength(0);
    expect(h.dirs.has("file:///docs/outbox")).toBe(false);
    expect([...h.files.keys()].some((k) => k.startsWith("file:///docs/outbox"))).toBe(false);
    expect(h.uploads.every((u) => u.cancelled)).toBe(true);

    release();
    await idle();
    expect(h.inserts).toHaveLength(0);
  });

  it("forgets when auth says the session has left the phone", async () => {
    h.state.insertBehavior = () => new Promise(() => undefined);
    await enqueuePost(photoDraft());
    await waitUntil(() => count("insert:posts") === 1);
    for (const fn of h.state.authListeners) fn("SIGNED_OUT");
    expect(getPendingPosts()).toHaveLength(0);
    expect(h.dirs.has("file:///docs/outbox")).toBe(false);
  });
});

describe("demo mode", () => {
  it("uploads nothing and goes straight to the demo store", async () => {
    h.state.demo = true;
    seedCaches();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(h.uploads).toHaveLength(0);
    expect(demoStore.demoCreatePost).toHaveBeenCalledTimes(1);
    expect(vi.mocked(demoStore.demoCreatePost).mock.calls[0][0]).toMatchObject({
      id: draft.id,
      media_path: jobPath(draft.id, "media.jpg"),
      thumb_path: jobPath(draft.id, "thumb.jpg"),
    });
    const feed = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!;
    expect(feed.pages[0][0]).toMatchObject({ id: draft.id, location: "Leith" });
    expect(getPendingPosts()).toHaveLength(0);
  });
});

describe("the pieces", () => {
  it("speaks in the house voice", () => {
    expect(stateLine("developing", 0.4, "video")).toBe("Developing the clip… 40%");
    expect(stateLine("uploading", 0.62, "photo")).toBe("Uploading… 62%");
    expect(stateLine("uploading", null, "photo")).toBe("Uploading…");
    expect(stateLine("preparing", null, "photo")).toBe("Preparing the photograph…");
    expect(stateLine("saving", null, "video")).toBe("Saving…");
    for (const s of ["queued", "preparing", "developing", "uploading", "saving", "waiting-network", "waiting-foreground", "failed", "done"] as const) {
      expect(stateLine(s, 0.5, "photo")).not.toMatch(/!|'/);
    }
    expect(accessibilityLine("uploading", 0.62, "photo")).toBe("Your photograph, uploading, 62 percent");
  });

  it("moves the rule forward only, through every step", () => {
    const order = ["preparing", "developing", "uploading", "saving", "done"] as const;
    const at = order.map((s) => overallProgress(s, 0, "video")!);
    for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1]);
    expect(overallProgress("developing", 1, "video")).toBeLessThanOrEqual(overallProgress("uploading", 0, "video")!);
    expect(overallProgress("waiting-network", 0.5, "photo")).toBeNull();
  });

  it("holds a clip's length to what the database accepts", () => {
    expect(clampDuration(60.6)).toBe(60);
    expect(clampDuration(61)).toBe(60);
    expect(clampDuration(0.4)).toBe(1);
    expect(clampDuration(12.4)).toBe(12);
    expect(clampDuration(0)).toBeNull();
    expect(clampDuration(null)).toBeNull();
  });

  it("does not trust a job file it cannot read", () => {
    expect(parseJob(null)).toBeNull();
    expect(parseJob({ v: 2 })).toBeNull();
    expect(parseJob({ v: 1, id: "../x", step: "prepare", draft: {} })).toBeNull();
    const good = {
      v: 1,
      rev: 3,
      id: "00000000-0000-4000-8000-000000000999",
      createdAt: 1,
      step: "upload",
      draft: { ...photoDraft({ id: "00000000-0000-4000-8000-000000000999" }) },
      files: { source: "source.jpg", media: "media.jpg", thumb: "thumb.jpg" },
      prepared: { width: 1, height: 1, duration: null, baked: true, ext: "jpg", contentType: "image/jpeg" },
      uploaded: { media: true },
    };
    expect(parseJob(good)).toMatchObject({ step: "upload", uploaded: { media: true, thumb: false }, failed: null });
    expect(parseJob({ ...good, step: "teleport" })).toBeNull();
  });

  it("prepends once, whatever is already in the caches", () => {
    const row = { ...existing, id: "new" };
    const data = { pages: [[existing], [{ ...existing, id: "p2" }]], pageParams: [0, 1] };
    const once = prependToFeed(data, row)!;
    expect(once.pages[0].map((p) => p.id)).toEqual(["new", "older-post"]);
    expect(once.pages[1]).toBe(data.pages[1]);
    expect(prependToFeed(once, row)).toBe(once);
    expect(prependToFeed(undefined, row)).toBeUndefined();
    expect(prependToList([existing], row)!.map((p) => p.id)).toEqual(["new", "older-post"]);
    expect(prependToList(undefined, row)).toBeUndefined();
  });

  it("lets a slow upload that is still moving finish, and calls off one that has stopped", async () => {
    vi.useFakeTimers();
    try {
      h.files.set("file:///docs/slow.mp4", "b".repeat(1000));
      // 0.3 Mbps for a 48 MiB clip is about 22 minutes; here, 50 minutes of
      // steady progress, a few bytes every 30 s.
      h.state.uploadBehavior = (r) =>
        new Promise((resolve) => {
          let sent = 0;
          const t = setInterval(() => {
            sent += 10;
            r.callback?.({ totalBytesSent: sent, totalBytesExpectedToSend: 1000 });
            if (sent >= 1000) {
              clearInterval(t);
              resolve({ status: 200, body: "{}", headers: {} });
            }
          }, 30_000);
        });
      const slow = uploadToStorage("media", "u1/slow.mp4", "file:///docs/slow.mp4", "video/mp4", { accessToken: "tok" });
      await vi.advanceTimersByTimeAsync(100 * 30_000 + 2000);
      await expect(slow).resolves.toMatchObject({ alreadyThere: false });

      h.state.uploadBehavior = () => new Promise(() => undefined);
      const stuck = uploadToStorage("media", "u1/stuck.mp4", "file:///docs/slow.mp4", "video/mp4", { accessToken: "tok" }).catch(
        (e: unknown) => e,
      );
      await vi.advanceTimersByTimeAsync(59_000);
      expect(h.uploads.at(-1)?.cancelled).toBe(false);
      await vi.advanceTimersByTimeAsync(3000);
      expect(await stuck).toBeInstanceOf(TimeoutError);
      expect(h.uploads.at(-1)?.cancelled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("treats what URLSession says about a lost network as transient", () => {
    expect(isTransient(new Error("The network connection was lost."))).toBe(true);
    expect(isTransient(new Error("A server with the specified hostname could not be found."))).toBe(true);
    expect(isTransient(new TimeoutError("The upload"))).toBe(true);
    expect(isTransient({ statusCode: "403", message: "new row violates row-level security policy" })).toBe(false);
  });

  it("bounds a request and calls it off", async () => {
    let aborted = false;
    await expect(
      withTimeout(5, (signal) => {
        signal.addEventListener("abort", () => (aborted = true));
        return new Promise(() => undefined);
      }),
    ).rejects.toThrow(/timed out/);
    expect(aborted).toBe(true);
    await expect(withTimeout(1000, async () => 7)).resolves.toBe(7);
  });

  it("routes an avatar through the native upload with a short cache and upsert, in the foreground", async () => {
    h.files.set("file:///cache/avatar.jpg", "a".repeat(100));
    await uploadFile("avatars", "u1/avatar.jpg", "file:///cache/avatar.jpg", "image/jpeg", { upsert: true });
    expect(h.uploads).toHaveLength(1);
    expect(h.uploads[0].url).toBe("https://proj.supabase.co/storage/v1/object/avatars/u1/avatar.jpg");
    expect(h.uploads[0].options.headers).toMatchObject({ "x-upsert": "true", "cache-control": "max-age=3600" });
    // A foreground session, which fails at once offline instead of waiting.
    expect(h.uploads[0].options.sessionType).toBe(1);
  });

  it("says a word about tags that did not take, and still finishes the post", async () => {
    vi.mocked(tagMembers).mockRejectedValueOnce({ code: "42501", message: "new row violates row-level security policy" });
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(showAlert).toHaveBeenCalledWith("Posted, but the tags didn’t take", expect.stringContaining("is up"));
    expect(readJob(draft.id)?.step).toBe("done");
  });
});

// ---------------------------------------------------------------------------
// Review follow-ups
// ---------------------------------------------------------------------------

const interrupted = () => Object.assign(new Error("The bake stopped"), { code: "E_BAKE_INTERRUPTED" });
const nativeUploadError = (code: number, description: string) =>
  Object.assign(
    new Error(`Unable to upload the file: 'Error Domain=NSURLErrorDomain Code=${code} "${description}" UserInfo={}'`),
    { code: "ERR_FILESYSTEM_CANNOT_UPLOAD" },
  );
/** Every insert commits, and every reply is lost on the way back. */
function insertsLandButRepliesAreLost(): void {
  h.state.insertBehavior = async () => {
    h.state.postExists = true;
    return { error: { message: "TypeError: Network request failed", details: "", hint: "", code: "" } };
  };
}

describe("a bake stopped with the app in front", () => {
  it("develops again at once rather than waiting for an 'active' that already came", async () => {
    let n = 0;
    h.state.bake = async (uri, filter, opts) => {
      // The media server reset under the open app, or the member's return
      // was heard before the native stop.
      if (n++ === 0) throw interrupted();
      return h.defaultBake(uri, filter, opts);
    };
    const seen: string[] = [];
    const stop = subscribePendingPosts(() => seen.push(getPendingPosts()[0]?.state ?? "gone"));
    await enqueuePost(videoDraft());
    await idle();
    stop();
    expect(bakeVideo).toHaveBeenCalledTimes(2);
    expect(seen).not.toContain("waiting-foreground");
    expect(seen).not.toContain("failed");
    expect(count("insert:posts")).toBe(1);
  });

  it("does not loop on a source that keeps stopping with the app open", async () => {
    h.state.bake = async () => {
      throw interrupted();
    };
    await enqueuePost(videoDraft());
    await idle();
    // Two taken again uncounted, then the three counted tries of any bake.
    expect(bakeVideo).toHaveBeenCalledTimes(5);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The clip wouldn’t develop." });
  });
});

describe("a bake that cannot come out differently", () => {
  it("fails at once when the developed clip is over the cap, with words that help", async () => {
    h.state.bake = async () => {
      throw Object.assign(new Error("The developed clip is 61.0 MB, over the 48.2 MB that can be posted"), {
        code: "E_BAKE_TOO_LARGE",
      });
    };
    await enqueuePost(videoDraft());
    await idle();
    expect(bakeVideo).toHaveBeenCalledTimes(1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The clip is too large to post. Try a shorter one." });
    expect(h.uploads).toHaveLength(0);
  });

  it("fails at once when the clip cannot be read", async () => {
    h.state.bake = async () => {
      throw Object.assign(new Error("The file has no video track"), { code: "E_BAKE_INPUT" });
    };
    await enqueuePost(videoDraft());
    await idle();
    expect(bakeVideo).toHaveBeenCalledTimes(1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The clip couldn’t be read." });
  });
});

describe("a bake code folded into the message", () => {
  it("still fails at once, as the code alone would", async () => {
    h.state.bake = async () => {
      throw new Error("E_BAKE_TOO_LARGE: The developed clip is 61.0 MB, over the 48.2 MB that can be posted");
    };
    await enqueuePost(videoDraft());
    await idle();
    expect(bakeVideo).toHaveBeenCalledTimes(1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The clip is too large to post. Try a shorter one." });
  });
});

describe("discarding while the post is being published", () => {
  it("refuses, with words, once the insert is out and has not failed, and the post goes up whole", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.insertBehavior = async () => {
      await gate;
      return { error: null };
    };
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => count("insert:posts") === 1);
    await discardPost(draft.id);
    expect(showAlert).toHaveBeenCalledWith("It’s on its way", expect.stringContaining("being posted now"));
    expect([...h.removed]).toHaveLength(0);
    release();
    await idle();
    expect(h.inserts).toHaveLength(1);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("holds the insert while “Discard this post?” is open, and a Discard then publishes nothing", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.uploadBehavior = async (r) => {
      await gate;
      return h.okUpload(r);
    };
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => h.uploads.length === 2);
    holdPost(draft.id, true);
    release();
    // Both files are up, but the question is still open: nothing is inserted.
    await new Promise((r) => setTimeout(r, 600));
    expect(count("insert:posts")).toBe(0);
    expect(getPendingPosts()[0].canDiscard).toBe(true);
    await discardPost(draft.id);
    holdPost(draft.id, false);
    await idle();
    expect(h.inserts).toHaveLength(0);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("lets the post go on when the member keeps it", async () => {
    const draft = photoDraft();
    holdPost(draft.id, true);
    await enqueuePost(draft);
    holdPost(draft.id, true);
    await waitUntil(() => readJob(draft.id)?.uploaded.media === true && readJob(draft.id)?.uploaded.thumb === true);
    await new Promise((r) => setTimeout(r, 400));
    expect(count("insert:posts")).toBe(0);
    holdPost(draft.id, false);
    await idle();
    expect(h.inserts).toHaveLength(1);
  });

  it("says so when the post was published while the question was open", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.insertBehavior = async () => {
      await gate;
      return { error: null };
    };
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => count("insert:posts") === 1);
    release();
    await waitUntil(() => readJob(draft.id)?.step === "follow-up" || readJob(draft.id)?.step === "done");
    await discardPost(draft.id);
    expect(showAlert).toHaveBeenCalledWith("It was posted after all", expect.stringContaining("wasn’t discarded"));
  });

  it("offers Discard to a post waiting for a connection with its files already up", async () => {
    const draft = photoDraft();
    h.state.uploadBehavior = async (r) => {
      const out = await h.okUpload(r);
      if (r.url.includes("/object/media/")) setOnline(false);
      return out;
    };
    await enqueuePost(draft);
    await waitUntil(() => getPendingPosts()[0]?.state === "waiting-network");
    expect(count("insert:posts")).toBe(0);
    expect(getPendingPosts()[0].canDiscard).toBe(true);
  });
});

describe("a keychain that stays unreadable with the app in front", () => {
  it("ends in a failure with Retry, not a wait for an app that is already open", async () => {
    h.state.insertBehavior = async () => ({
      error: { message: `Error: ${h.keychainError().message}`, details: "", hint: "", code: "" },
    });
    await enqueuePost(photoDraft());
    await idle();
    const post = getPendingPosts()[0];
    expect(post.state).toBe("failed");
    expect(post.canDiscard).toBe(true);
  });
});

describe("the feed already fetching when the post is confirmed", () => {
  const page = (n: number, prefix = "p") =>
    Array.from({ length: n }, (_, i) => ({ ...existing, id: `${prefix}${i}` }));

  it("puts the row back after a next page lands, and only then says it is in the feed", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const observer = new InfiniteQueryObserver<PostWithAuthor[], Error, InfiniteData<PostWithAuthor[]>, string[], number>(qc, {
      queryKey: ["feed", "u1"],
      queryFn: async ({ pageParam }) => {
        if (pageParam === 0) return page(12);
        await gate;
        return page(3, "q");
      },
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.length < 12 ? undefined : pages.length),
    });
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    const next = observer.fetchNextPage();
    await Promise.resolve();

    let settled: boolean | null = null;
    const placed = placeConfirmedPost(qc, "u1", { ...existing, id: "NEW" }).then((v) => (settled = v));
    await Promise.resolve();
    expect(settled).toBeNull();

    release();
    await next;
    await placed;
    const ids = qc.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!.pages.flat().map((p) => p.id);
    expect(ids[0]).toBe("NEW");
    expect(ids).toContain("q0");
    expect(settled).toBe(true);
    // Stale again, so the next ordinary refetch swaps in the stored row.
    expect(qc.getQueryState(["feed", "u1"])?.isInvalidated).toBe(true);
    unsubscribe();
  });

  it("keeps the card until a pull to refresh that was already out has landed", async () => {
    let release!: () => void;
    let gate: Promise<void> = Promise.resolve();
    const observer = new InfiniteQueryObserver<PostWithAuthor[], Error, InfiniteData<PostWithAuthor[]>, string[], number>(
      queryClient,
      {
        queryKey: ["feed", "u1"],
        queryFn: async () => {
          await gate;
          // Read before the post existed.
          return [existing];
        },
        initialPageParam: 0,
        getNextPageParam: () => undefined,
      },
    );
    const unsubscribe = observer.subscribe(() => undefined);
    await observer.refetch();
    gate = new Promise<void>((r) => (release = r));
    const refresh = observer.refetch();

    const draft = photoDraft({ tagIds: [] });
    await enqueuePost(draft);
    await waitUntil(() => readJob(draft.id)?.step === "done");
    // The refresh has not landed: the card is still listed (Home hides it, as its row is there).
    expect(getPendingPosts().map((p) => p.id)).toEqual([draft.id]);
    expect(queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!.pages[0][0].id).toBe(draft.id);

    release();
    await refresh;
    await waitUntil(() => getPendingPosts().length === 0);
    const ids = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!.pages.flat().map((p) => p.id);
    expect(ids).toEqual([draft.id, "older-post"]);
    unsubscribe();
  });
});

describe("an insert that landed with every reply lost", () => {
  it("says it may have been saved rather than that it wasn’t", async () => {
    insertsLandButRepliesAreLost();
    await enqueuePost(photoDraft());
    await idle();
    expect(count("insert:posts")).toBe(4);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "It may have been saved. Retry to check.", canDiscard: true });
  });

  it("on Discard, asks first, and finds it posted: follow-ups run, storage is left alone, and the member is told", async () => {
    seedCaches();
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(tagMembers).not.toHaveBeenCalled();

    await discardPost(draft.id);
    await idle();
    expect(h.calls).toContain("select:posts");
    expect(h.removed).toEqual([]);
    expect(showAlert).toHaveBeenCalledWith("It was posted after all", expect.stringContaining("You can delete it from the post."));
    expect(readJob(draft.id)?.step).toBe("done");
    expect(tagMembers).toHaveBeenCalledWith(draft.id, "u1", ["u2"]);
    expect(markDeveloped).toHaveBeenCalledWith("asset-1");
    const feed = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!;
    expect(feed.pages[0][0].id).toBe(draft.id);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("on Discard with no answer to the question, keeps the post and says so", async () => {
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    h.state.postCheckFails = true;

    await discardPost(draft.id);
    expect(showAlert).toHaveBeenCalledWith("Not discarded yet", expect.stringContaining("couldn’t check"));
    expect(h.removed).toEqual([]);
    expect(h.files.has(jobPath(draft.id, "media.jpg"))).toBe(true);
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "failed" });
    expect(readJob(draft.id)?.step).toBe("insert");
  });

  it("is never sent again while Discard is asking", async () => {
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    const inserts = count("insert:posts");
    const asking = discardPost(draft.id);
    retryPost(draft.id);
    await asking;
    await idle();
    // The check found it posted; the follow-ups ran, the insert was not repeated.
    expect(count("insert:posts")).toBe(inserts);
    expect(readJob(draft.id)?.step).toBe("done");
  });

  it("ignores a Retry while Discard is asking, so no answer leaves the post just as it was", async () => {
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    const inserts = count("insert:posts");
    h.state.postCheckFails = true;
    const asking = discardPost(draft.id);
    retryPost(draft.id);
    await asking;
    await idle();
    expect(count("insert:posts")).toBe(inserts);
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "failed" });
    expect(readJob(draft.id)?.failed).not.toBeNull();
  });

  it("hands over to its row when the feed has it from the server", async () => {
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0].state).toBe("failed");
    notePostsInFeed(["older-post", draft.id]);
    await idle();
    expect(readJob(draft.id)?.step).toBe("done");
    expect(tagMembers).toHaveBeenCalledTimes(1);
    expect(count("insert:posts")).toBe(4);
  });
});

describe("a post the member deleted", () => {
  const jobFiles = (id: string) => [...h.files.keys()].filter((f) => f.startsWith(`file:///docs/outbox/${id}/`));

  it("lets go of a job that never heard its insert land, so Retry can never post it again", async () => {
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "failed", error: "It may have been saved. Retry to check." });
    const inserts = count("insert:posts");

    // Deleted from the profile grid, where the server's row was showing.
    h.state.postExists = false;
    notePostDeleted(draft.id);
    expect(getPendingPosts()).toHaveLength(0);
    expect(readJob(draft.id)).toBeNull();
    expect(jobFiles(draft.id)).toEqual([]);

    retryPost(draft.id);
    notePostsInFeed([draft.id]);
    await discardPost(draft.id);
    await idle();
    expect(count("insert:posts")).toBe(inserts);
    expect(h.calls).not.toContain("select:posts");
    // Storage is left as it is for every deleted post.
    expect(h.removed).toEqual([]);
    expect(tagMembers).not.toHaveBeenCalled();
    expect(showAlert).not.toHaveBeenCalled();
  });

  it("is let go after a relaunch too, and stays gone", async () => {
    insertsLandButRepliesAreLost();
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    __outboxTesting.relaunch();
    startOutbox();
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "failed" });
    const inserts = count("insert:posts");

    notePostDeleted(draft.id);
    __outboxTesting.relaunch();
    startOutbox();
    await idle();
    expect(getPendingPosts()).toHaveLength(0);
    expect(count("insert:posts")).toBe(inserts);
  });

  it("stops a job still at work where it is, and inserts nothing", async () => {
    const draft = photoDraft();
    await enqueuePost(draft);
    holdPost(draft.id, true);
    await waitUntil(() => readJob(draft.id)?.uploaded.media === true && readJob(draft.id)?.uploaded.thumb === true);
    notePostDeleted(draft.id);
    holdPost(draft.id, false);
    await idle();
    expect(h.inserts).toHaveLength(0);
    expect(getPendingPosts()).toHaveLength(0);
    expect(readJob(draft.id)).toBeNull();
  });

  it("sends no insert again while the delete is out, so a retry cannot put the post back", async () => {
    // The first insert's reply is lost, and the retry waits out its backoff
    // while the member deletes the post from its row on the server.
    let wake!: () => void;
    const backoff = new Promise<void>((r) => (wake = r));
    __outboxTesting.setSleep(() => backoff);
    h.state.insertBehavior = async () => ({ error: { message: "TypeError: Network request failed", details: "", hint: "", code: "" } });
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => count("insert:posts") === 1);

    // As deletePost does: held before the delete is sent, and dropped once it is done.
    holdPost(draft.id, true);
    wake();
    await new Promise((r) => setTimeout(r, 400));
    expect(count("insert:posts")).toBe(1);
    notePostDeleted(draft.id);
    await idle();
    expect(count("insert:posts")).toBe(1);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("places nothing in the feed when an insert that was already out answers afterwards", async () => {
    seedCaches();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let sent: AbortSignal | undefined;
    h.state.insertBehavior = async (_row, signal) => {
      sent = signal;
      await gate;
      return { error: null };
    };
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => count("insert:posts") === 1);
    notePostDeleted(draft.id);
    // Called off, so a request that has not reached the server yet never does.
    expect(sent?.aborted).toBe(true);
    release();
    await idle();
    const feed = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!;
    expect(feed.pages.flat().map((p) => p.id)).toEqual(["older-post"]);
    expect(queryClient.getQueryData<PostRow[]>(["user-posts", "u1"])!.map((p) => p.id)).toEqual(["older-post"]);
    expect(getPendingPosts()).toHaveLength(0);
    expect(tagMembers).not.toHaveBeenCalled();
  });

  it("leaves every other post alone, and an id it never held is no matter", async () => {
    seedCaches();
    const kept = photoDraft({ tagIds: [] });
    await enqueuePost(kept);
    notePostDeleted("00000000-0000-4000-8000-ffffffffffff");
    await idle();
    expect(h.inserts).toHaveLength(1);
    expect(readJob(kept.id)?.step).toBe("done");
    // A post deleted earlier in the run keeps no later one out of the feed or the grid.
    const feed = queryClient.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!;
    expect(feed.pages.flat().map((p) => p.id)).toContain(kept.id);
    expect(queryClient.getQueryData<PostRow[]>(["user-posts", "u1"])!.map((p) => p.id)).toContain(kept.id);
  });

  it("is never put back into the feed or the grid by a read that lands after the delete", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const page = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ ...existing, id: `${prefix}${i}` }));
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const observer = new InfiniteQueryObserver<PostWithAuthor[], Error, InfiniteData<PostWithAuthor[]>, string[], number>(qc, {
      queryKey: ["feed", "u1"],
      queryFn: async ({ pageParam }) => {
        if (pageParam === 0) return page(12, "p");
        await gate;
        return page(3, "q");
      },
      initialPageParam: 0,
      getNextPageParam: (last, pages) => (last.length < 12 ? undefined : pages.length),
    });
    // The grid is read again too, as the Post tab does when it comes to the front.
    const { author: _a, ...row } = existing;
    let gridGated = false;
    const grid = new QueryObserver<PostRow[], Error>(qc, {
      queryKey: ["user-posts", "u1"],
      queryFn: async () => {
        if (!gridGated) return [];
        await gate;
        return [{ ...row, id: "g0" }];
      },
    });
    const unsubscribe = observer.subscribe(() => undefined);
    const unsubscribeGrid = grid.subscribe(() => undefined);
    await observer.refetch();
    await grid.refetch();
    gridGated = true;
    const next = observer.fetchNextPage();
    const regrid = grid.refetch();
    await Promise.resolve();

    const placed = placeConfirmedPost(qc, "u1", { ...existing, id: "DELETED-1" });
    // The member deletes it before the next page lands; the screens drop it.
    notePostDeleted("DELETED-1");
    qc.setQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"], (data) =>
      data && { ...data, pages: data.pages.map((p) => p.filter((row) => row.id !== "DELETED-1")) },
    );
    qc.setQueryData<PostRow[]>(["user-posts", "u1"], (list) => list?.filter((row) => row.id !== "DELETED-1"));

    release();
    await next;
    await regrid;
    await new Promise((r) => setTimeout(r, 0));
    expect(await placed).toBe(false);
    const ids = qc.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!.pages.flat().map((p) => p.id);
    expect(ids).not.toContain("DELETED-1");
    expect(ids).toContain("q0");
    const gridIds = qc.getQueryData<PostRow[]>(["user-posts", "u1"])!.map((p) => p.id);
    expect(gridIds).not.toContain("DELETED-1");
    expect(gridIds).toContain("g0");

    // Nor placed at all once deleted.
    expect(await placeConfirmedPost(qc, "u1", { ...existing, id: "DELETED-1" })).toBe(false);
    expect(qc.getQueryData<InfiniteData<PostWithAuthor[]>>(["feed", "u1"])!.pages.flat().map((p) => p.id)).not.toContain("DELETED-1");
    expect(qc.getQueryData<PostRow[]>(["user-posts", "u1"])!.map((p) => p.id)).not.toContain("DELETED-1");
    unsubscribe();
    unsubscribeGrid();
  });
});

describe("the token and the transport", () => {
  it("refreshes the session when PostgREST says the JWT expired, and saves the post", async () => {
    let first = true;
    h.state.insertBehavior = async () => {
      if (!first) return { error: null };
      first = false;
      return { error: { code: "PGRST303", message: "JWT expired", details: null, hint: null } };
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(supabase.auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(count("insert:posts")).toBe(2);
    expect(getPendingPosts()).toHaveLength(0);
    expect(isExpiredAuth({ code: "PGRST301", message: "JWT expired" })).toBe(true);
    expect(isExpiredAuth({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
    expect(isExpiredAuth({ status: 400, code: "PGRST301", message: "JWT expired" })).toBe(false);
  });

  it("takes a lost background-transfer connection (-997) as a dropped connection, not a refusal", async () => {
    let n = 0;
    h.state.uploadBehavior = async (r) => {
      if (r.url.includes("/object/media/") && n++ === 0) throw nativeUploadError(-997, "Lost connection to background transfer service");
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:media")).toBe(2);
    expect(count("insert:posts")).toBe(1);
  });

  it("reads the error code, not the words, so a phone in French is retried too", async () => {
    let n = 0;
    h.state.uploadBehavior = async (r) => {
      if (r.url.includes("/object/media/") && n++ < 2) throw nativeUploadError(-1005, "La connexion réseau a été perdue.");
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:media")).toBe(3);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("stops at once for an upload error no retry can change", async () => {
    h.state.uploadBehavior = async (r) => {
      if (r.url.includes("/object/media/")) throw nativeUploadError(-1002, "unsupported URL");
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:media")).toBe(1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The photograph didn’t upload." });
  });

  it("does not retry a gateway’s HTML refusal as if it were a dropped connection", async () => {
    h.state.uploadBehavior = async (r) =>
      r.url.includes("/object/media/") ? { status: 413, body: "<html>Request Entity Too Large</html>", headers: {} } : h.okUpload(r);
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:media")).toBe(1);
    expect(getPendingPosts()[0].state).toBe("failed");
    expect(isTransient(new StorageUploadError(413, "<html></html>"))).toBe(false);
    expect(isTransient(new StorageUploadError(503, ""))).toBe(true);
    expect(isTransient(new Error("Upload failed with HTTP 413"))).toBe(false);
    expect(isTransient({ message: "TypeError: Load failed" })).toBe(true);
    // Worded so that no pattern for a dropped connection can ever take it for one.
    expect(new StorageUploadError(413, "<html></html>").message).toBe("Storage refused the file (HTTP 413)");
    expect(new StorageUploadError(413, "").message).not.toMatch(/load failed/i);
  });

  it("fails an avatar at once with no connection, where a background session would wait", async () => {
    h.files.set("file:///cache/avatar.jpg", "a".repeat(100));
    h.state.uploadBehavior = async () => {
      throw nativeUploadError(-1009, "The Internet connection appears to be offline.");
    };
    const err = await uploadFile("avatars", "u1/avatar-1.jpg", "file:///cache/avatar.jpg", "image/jpeg", { retry: false }).catch(
      (e: unknown) => e,
    );
    expect(isTransient(err)).toBe(true);
    expect(h.uploads[0].options.sessionType).toBe(1);
  });

  it("restarts from the foreground a task made while the app was away that never started", async () => {
    vi.useFakeTimers();
    try {
      h.files.set("file:///docs/held.jpg", "h".repeat(100));
      h.state.uploadBehavior = () => new Promise(() => undefined);
      let running = false;
      const held = uploadToStorage("media", "u1/held.jpg", "file:///docs/held.jpg", "image/jpeg", {
        accessToken: "tok",
        background: true,
        clockRunning: () => running,
      }).catch((e: unknown) => e);
      // Away for a minute: the clock does not run.
      await vi.advanceTimersByTimeAsync(60_000);
      expect(h.uploads.at(-1)?.cancelled).toBe(false);
      running = true;
      await vi.advanceTimersByTimeAsync(7000);
      expect(await held).toBeInstanceOf(UploadRestart);
      expect(h.uploads.at(-1)?.cancelled).toBe(true);

      // One made in front gets the ordinary stall limit.
      const inFront = uploadToStorage("media", "u1/front.jpg", "file:///docs/held.jpg", "image/jpeg", {
        accessToken: "tok",
        clockRunning: () => true,
      }).catch((e: unknown) => e);
      await vi.advanceTimersByTimeAsync(7000);
      expect(h.uploads.at(-1)?.cancelled).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(await inFront).toBeInstanceOf(TimeoutError);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not count those restarts against the post", async () => {
    let n = 0;
    h.state.uploadBehavior = async (r) => {
      if (r.url.includes("/object/media/")) {
        n += 1;
        if (n <= 5) throw new UploadRestart();
        // After them, a connection that drops three times still has all of its tries.
        if (n <= 8) throw nativeUploadError(-1005, "The network connection was lost.");
      }
      return h.okUpload(r);
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("upload:media")).toBe(9);
    expect(count("insert:posts")).toBe(1);
    expect(getPendingPosts()).toHaveLength(0);
  });
});

describe("the phone locked while the post goes up", () => {
  it("waits for the app to be open when the insert can’t read the keychain, then saves it", async () => {
    setAppState("background");
    h.state.locked = true;
    // The background upload finished with the phone locked; iOS woke the app.
    const draft = photoDraft({ tagIds: [] });
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ state: "waiting-foreground", error: null });
    expect(readJob(draft.id)?.failed).toBeNull();

    h.state.locked = false;
    setAppState("active");
    await idle();
    expect(readJob(draft.id)?.step).toBe("done");
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("waits the same way when the upload’s token can’t be read", async () => {
    setAppState("background");
    h.state.locked = true;
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(h.uploads).toHaveLength(0);
    expect(getPendingPosts()[0].state).toBe("waiting-foreground");
    h.state.locked = false;
    setAppState("active");
    await idle();
    expect(count("insert:posts")).toBe(1);
  });

  it("tries again at once, uncounted, when the keychain refuses with the app in front", async () => {
    let n = 0;
    h.state.insertBehavior = async () => {
      if (n++ === 0) return { error: { message: `Error: ${h.keychainError().message}`, details: "", hint: "", code: "" } };
      return { error: null };
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("insert:posts")).toBe(2);
    expect(getPendingPosts()).toHaveLength(0);
  });

  it("does not take a session it can’t see in the background for a sign-out", async () => {
    setAppState("background");
    h.state.signedIn = false;
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(getPendingPosts()[0].state).toBe("waiting-foreground");
    // In front, with nobody signed in, it is a sign-out after all.
    setAppState("active");
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "Sign in again to post this." });
  });

  it("recognises SecureStore’s refusals and nothing else", () => {
    expect(isSessionUnavailable(h.keychainError())).toBe(true);
    // As postgrest-js passes it on: SecureStore's message, with the locked phone's cause in it.
    expect(
      isSessionUnavailable({
        message: "Error: Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: User interaction is not allowed.",
        code: "",
      }),
    ).toBe(true);
    // Any other keychain failure would never clear by waiting: it is not this.
    expect(isSessionUnavailable({ message: "Calling the 'getValueWithKeyAsync' function has failed\n→ Caused by: A required entitlement isn't present.", code: "ERR_KEY_CHAIN" })).toBe(false);
    expect(isSessionUnavailable(new Error("The network connection was lost."))).toBe(false);
    expect(isSessionUnavailable({ code: "42501", message: "new row violates row-level security policy" })).toBe(false);
  });
});

describe("withdrawing a post before it is published", () => {
  it("offers Discard until the insert has gone out, and again if it fails", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.insertBehavior = async () => {
      await gate;
      return { error: { code: "42501", message: "new row violates row-level security policy" } };
    };
    const draft = photoDraft();
    await enqueuePost(draft);
    expect(getPendingPosts()[0]).toMatchObject({ state: "preparing", canDiscard: true });
    await waitUntil(() => count("insert:posts") === 1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "saving", canDiscard: false });
    release();
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", canDiscard: true });
  });

  it("cancels an upload under way, deletes the files and what reached storage, and never inserts", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.uploadBehavior = async (r) => {
      if (r.url.includes("/object/thumbnails/")) return h.okUpload(r);
      await gate;
      return h.okUpload(r);
    };
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => readJob(draft.id)?.uploaded.thumb === true);
    expect(getPendingPosts()[0]).toMatchObject({ state: "uploading", canDiscard: true });

    await discardPost(draft.id);
    expect(h.uploads.find((u) => u.url.includes("/object/media/"))?.cancelled).toBe(true);
    expect(getPendingPosts()).toHaveLength(0);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect([...h.removed].sort()).toEqual([`media/u1/${draft.id}.jpg`, `thumbnails/u1/${draft.id}.jpg`]);
    expect(h.calls).not.toContain("select:posts");
    release();
    await idle();
    expect(h.inserts).toHaveLength(0);
  });

  it("cancels a bake under way", async () => {
    let started!: () => void;
    const begun = new Promise<void>((r) => (started = r));
    h.state.bake = (_uri, _filter, opts) =>
      new Promise((_, reject) => {
        started();
        (opts as { signal?: AbortSignal }).signal?.addEventListener("abort", () =>
          reject(Object.assign(new Error("The bake was cancelled"), { name: "AbortError", code: "E_BAKE_CANCELLED" })),
        );
      });
    const draft = videoDraft();
    await enqueuePost(draft);
    await begun;
    expect(getPendingPosts()[0]).toMatchObject({ state: "developing", canDiscard: true });
    await discardPost(draft.id);
    await idle();
    expect(getPendingPosts()).toHaveLength(0);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect(h.uploads).toHaveLength(0);
    expect(h.inserts).toHaveLength(0);
  });

  it("leaves no poster frame behind when discarded while the frame is cut", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let frameUri = "";
    vi.mocked(VideoThumbnails.getThumbnailAsync).mockImplementationOnce(async () => {
      await gate;
      frameUri = "file:///cache/frame-late.jpg";
      h.files.set(frameUri, "f".repeat(2000));
      return { uri: frameUri, width: 1080, height: 1920 };
    });
    const draft = videoDraft();
    await enqueuePost(draft);
    await waitUntil(() => vi.mocked(VideoThumbnails.getThumbnailAsync).mock.calls.length === 1);
    await discardPost(draft.id);
    release();
    await idle();
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect([...h.files.keys()].some((k) => k.startsWith(`file:///docs/outbox/${draft.id}`))).toBe(false);
    expect(h.files.has(frameUri)).toBe(false);
    // Nor is a poster made from it once the post has gone.
    const { prepareImage } = await import("@/media/nativeMedia");
    expect(vi.mocked(prepareImage).mock.calls.some(([uri]) => uri === frameUri)).toBe(false);
  });
});

describe("what the card says, and where Home shows it", () => {
  it("says a post behind another is waiting its turn", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    h.state.uploadBehavior = async (r) => {
      await gate;
      return h.okUpload(r);
    };
    const first = photoDraft();
    await enqueuePost(first);
    await waitUntil(() => h.uploads.length === 2);
    const second = videoDraft();
    await enqueuePost(second);
    const card = getPendingPosts().find((p) => p.id === second.id)!;
    expect(card).toMatchObject({ state: "queued", progress: null, canDiscard: true });
    expect(stateLine("queued", null, "video")).toBe("Waiting its turn");
    expect(overallProgress("queued", 0.5, "video")).toBeNull();
    expect(accessibilityLine("queued", null, "photo")).toBe("Your photograph, waiting its turn");
    release();
    await idle();
    expect(count("insert:posts")).toBe(2);
  });

  it("warms the image cache with the stored photograph and thumbnail once posted", async () => {
    const draft = photoDraft();
    await enqueuePost(draft);
    await idle();
    expect(Image.prefetch).toHaveBeenCalledWith(
      [`https://cdn.test/media/u1/${draft.id}.jpg`, `https://cdn.test/thumbnails/u1/${draft.id}.jpg`],
      "memory-disk",
    );
  });

  it("leaves a clip’s player alone", async () => {
    await enqueuePost(videoDraft());
    await idle();
    expect(Image.prefetch).not.toHaveBeenCalled();
  });

  it("takes Home to the top for a new card, and for one that failed out of sight, and not otherwise", () => {
    const seen = new Map<string, PendingPost["state"]>();
    expect(pendingNeedsTop(seen, [{ id: "a", state: "preparing" }], false)).toBe(true);
    expect(pendingNeedsTop(seen, [{ id: "a", state: "uploading" }], true)).toBe(false);
    expect(pendingNeedsTop(seen, [{ id: "a", state: "failed" }], false)).toBe(true);
    // Still failed: no reason to move the member again.
    expect(pendingNeedsTop(seen, [{ id: "a", state: "failed" }], false)).toBe(false);
    // Failed while Home is in view: the member can see it already.
    expect(pendingNeedsTop(seen, [{ id: "b", state: "preparing" }], true)).toBe(true);
    expect(pendingNeedsTop(seen, [{ id: "a", state: "failed" }, { id: "b", state: "failed" }], true)).toBe(false);
  });
});

describe("an insert refused for its token after one that went unanswered", () => {
  const jwtExpired = { error: { code: "PGRST303", message: "JWT expired", details: null, hint: null } };

  it("says it may have been saved, since the unanswered one may be the one that landed", async () => {
    let n = 0;
    h.state.insertBehavior = async () => {
      if (n++ === 0) {
        // Landed, and the reply was lost on the way back.
        h.state.postExists = true;
        return { error: { message: "TypeError: Network request failed", details: "", hint: "", code: "" } };
      }
      // A clock running behind: every later token is refused.
      return jwtExpired;
    };
    await enqueuePost(photoDraft());
    await idle();
    expect(count("insert:posts")).toBe(4);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "It may have been saved. Retry to check." });
  });

  it("still says it wasn’t saved when every attempt was refused", async () => {
    h.state.insertBehavior = async () => jwtExpired;
    await enqueuePost(photoDraft());
    await idle();
    expect(count("insert:posts")).toBe(4);
    expect(getPendingPosts()[0]).toMatchObject({ state: "failed", error: "The post wasn’t saved." });
  });

  it("does not know how an insert ended before a relaunch, and says so if it then fails", async () => {
    h.state.insertBehavior = () => new Promise(() => undefined);
    const draft = photoDraft();
    await enqueuePost(draft);
    await waitUntil(() => count("insert:posts") === 1);
    __outboxTesting.relaunch();
    h.state.insertBehavior = async () => jwtExpired;
    startOutbox();
    await idle();
    expect(getPendingPosts()[0]).toMatchObject({ id: draft.id, state: "failed", error: "It may have been saved. Retry to check." });
  });
});

describe("nothing of a discarded post is kept", () => {
  const cacheCopies = () => [...h.files.keys()].filter((k) => /^file:\/\/\/cache\/(prepared|thumb)-/.test(k));

  it("deletes the prepared photograph and thumbnail that arrive after the discard", async () => {
    const { prepareImage } = await import("@/media/nativeMedia");
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // A decode already under way: it read the source before the discard
    // deleted it, and hands back its files afterwards.
    vi.mocked(prepareImage).mockImplementationOnce(async () => {
      await gate;
      h.files.set("file:///cache/prepared-late.jpg", "p".repeat(3000));
      h.files.set("file:///cache/thumb-late.jpg", "t".repeat(300));
      return {
        uri: "file:///cache/prepared-late.jpg",
        width: 1152,
        height: 1440,
        thumb: { uri: "file:///cache/thumb-late.jpg", width: 384, height: 480 },
      };
    });
    const draft = photoDraft({ sourceWidth: 4000, sourceHeight: 3000 });
    await enqueuePost(draft);
    await waitUntil(() => vi.mocked(prepareImage).mock.calls.length === 1);
    expect(getPendingPosts()[0]).toMatchObject({ state: "preparing", canDiscard: true });
    await discardPost(draft.id);
    release();
    await idle();
    expect(cacheCopies()).toEqual([]);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect(h.uploads).toHaveLength(0);
  });

  it("deletes a developed clip that finishes just as it is discarded", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let baked = "";
    // A bake past the point where it can still be called off.
    h.state.bake = async (uri, filter, opts) => {
      await gate;
      const out = (await h.defaultBake(uri, filter, opts)) as { uri: string };
      baked = out.uri;
      return out;
    };
    const draft = videoDraft();
    await enqueuePost(draft);
    await waitUntil(() => vi.mocked(bakeVideo).mock.calls.length === 1);
    await discardPost(draft.id);
    release();
    await idle();
    expect(baked).not.toBe("");
    expect(h.files.has(baked)).toBe(false);
    expect(h.dirs.has(`file:///docs/outbox/${draft.id}`)).toBe(false);
    expect(h.uploads).toHaveLength(0);
  });
});

describe("Home, read from the source", () => {
  const root = path.resolve(import.meta.dirname, "..");
  /** Without comments, so prose that names what is not done is not taken as doing it. */
  const home = readFileSync(path.join(root, "app/(tabs)/index.tsx"), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("tells the card whether Home is in front, so a hidden Home says nothing aloud", () => {
    const card = /<PendingPostCard[\s\S]*?\/>/.exec(home)?.[0] ?? "";
    expect(card).toMatch(/focused=\{focused\}/);
    expect(home).toMatch(/const focused = useIsFocused\(\)/);
  });

  it("hides any card whose row the feed has, whatever its state, and tells the outbox", () => {
    expect(home).toMatch(/!inFeed\.has\(p\.id\)/);
    expect(home).not.toMatch(/p\.state === "done" && inFeed/);
    expect(home).toMatch(/notePostsInFeed\(postIds\)/);
  });

  it("takes the list to the top for a new card, without the refetch onHomeAgain brings", () => {
    const effect = /pendingNeedsTop\([\s\S]*?\}\s*,\s*\[pending, focused\]\)/.exec(home)?.[0] ?? "";
    expect(effect).toMatch(/listRef\.current\?\.scrollToOffset\(\{ offset: 0, animated: false \}\)/);
    expect(effect).not.toMatch(/refetch/);
  });
});
