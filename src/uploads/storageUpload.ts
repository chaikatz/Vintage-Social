import * as LegacyFileSystem from "expo-file-system/legacy";
import { File } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import { requireEnv } from "@/lib/env";
import { TimeoutError, abortError, withTimeout } from "@/utils/retry";
import { perfStart, shortId } from "@/utils/perf";

/**
 * One file into Storage, streamed from disk by the phone itself.
 *
 * The old path read the whole file into JavaScript, let fetch copy it, and
 * then React Native's networking turned it into base64 on the JS thread
 * before native decoded it again: seconds of a blocked thread and well
 * over a hundred megabytes of memory for a clip, and no progress to show.
 * Here the file never enters JavaScript. expo-file-system's upload task
 * hands it to URLSession, which reads it from disk, reports progress, and,
 * in a background session, carries on while the app is away and waits out
 * a lost connection on its own instead of failing.
 *
 * This is the same request storage-js makes: a POST of the raw bytes to
 * /storage/v1/object/{bucket}/{path} with the member's access token and the
 * anon key. Going around supabase-js means setting those headers here, and
 * keeping the token fresh here too.
 */

/** Post media and thumbnails live at keys that never change, so caches may keep them for a year. */
export const IMMUTABLE_CACHE_SECONDS = 31_536_000;
/** What storage-js sends by default; kept for anything that is overwritten in place (avatars). */
export const SHORT_CACHE_SECONDS = 3600;

/** A token this close to expiry is refreshed before an upload is handed to URLSession, which keeps the headers it was given. */
const REFRESH_MARGIN_MS = 5 * 60_000;
/** Even when a refresh fails, a token with this much left is still worth trying. */
const STILL_USABLE_MS = 30_000;
const AUTH_TIMEOUT_MS = 15_000;

/** The slowest uplink we plan for, in bytes per second (about 0.4 Mbps). */
const FLOOR_BYTES_PER_SECOND = 48_000;
/** An upload that has sent nothing for this long, while it could have, is stuck. */
const STALL_MS = 60_000;
const TICK_MS = 1000;

/**
 * How long an upload of this size may run, counting only the time it could
 * actually make progress (see `clockRunning`). Generous on purpose: a slow
 * uplink must still be able to finish, and a real stall is caught sooner
 * by the stall limit.
 */
export function uploadDeadlineMs(bytes: number): number {
  return 45_000 + Math.ceil(Math.max(0, bytes) / FLOOR_BYTES_PER_SECOND) * 1000;
}

/** Storage refused the file. `status` is the HTTP status; `statusCode` is what storage said in the body, when it said. */
export class StorageUploadError extends Error {
  readonly status: number;
  readonly statusCode: string | number | undefined;
  readonly body: string;
  constructor(status: number, body: string) {
    let message = `Upload failed with HTTP ${status}`;
    let statusCode: string | number | undefined;
    try {
      const json = JSON.parse(body) as { statusCode?: string | number; message?: string; error?: string };
      if (json && typeof json === "object") {
        statusCode = json.statusCode;
        message = json.message || json.error || message;
      }
    } catch {
      // A gateway's HTML error page: the status alone says enough.
    }
    super(message);
    this.name = "StorageUploadError";
    this.status = status;
    this.statusCode = statusCode;
    this.body = body;
  }
}

/** Nobody is signed in on this phone, so there is no one to upload as. */
export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotSignedInError";
  }
}

/**
 * A refusal because the access token had run out. The next attempt asks
 * for a new one first; URLSession would otherwise go on sending the old.
 */
export function isExpiredAuth(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown };
  const code = Number(e.statusCode ?? e.status ?? NaN);
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (code === 401 || code === 403) && /jwt|exp"? claim|token|expired/.test(message);
}

/** A storage answer that means the object is already there: for a key named by a fresh post id, that is success. */
export function isAlreadyStored(status: number, body: string): boolean {
  return (status === 400 || status === 409) && /already exists|duplicate/i.test(body);
}

/**
 * A current access token for the native request.
 *
 * supabase-js refreshes a token only when it is within ninety seconds of
 * expiry, and only for its own requests. A URLSession task keeps the
 * headers it started with, and a background one may not run for a while,
 * so a token is refreshed here when it has less than five minutes left.
 */
export async function freshAccessToken(force = false): Promise<string> {
  const { data, error } = await withTimeout(AUTH_TIMEOUT_MS, () => supabase.auth.getSession(), {
    what: "Reading the session",
  });
  if (error) throw error;
  let session = data.session;
  if (!session) throw new NotSignedInError();
  const expiresAtMs = (session.expires_at ?? 0) * 1000;
  if (force || !session.expires_at || expiresAtMs - Date.now() < REFRESH_MARGIN_MS) {
    const refreshed = await withTimeout(AUTH_TIMEOUT_MS, () => supabase.auth.refreshSession(), {
      what: "Refreshing the session",
    }).catch((err: unknown) => ({ data: { session: null }, error: err }));
    if (refreshed.data.session) {
      session = refreshed.data.session;
    } else if (force || expiresAtMs - Date.now() < STILL_USABLE_MS) {
      throw refreshed.error ?? new NotSignedInError();
    }
  }
  return session.access_token;
}

export interface StorageUploadOptions {
  /** Overwrite what is there. Only avatars at a fixed key want this. */
  upsert?: boolean;
  cacheControlSeconds?: number;
  /** A token already fetched for this batch, so two parallel uploads do not refresh twice. */
  accessToken?: string;
  onProgress?: (sentBytes: number, totalBytes: number) => void;
  signal?: AbortSignal;
  /**
   * Whether the clock that bounds the upload should run right now. The
   * outbox answers false while the app is in the background or the phone
   * has no connection: a background session simply waits then, and that
   * wait is not the upload being slow.
   */
  clockRunning?: () => boolean;
  /** Override the size-scaled limit (tests). */
  deadlineMs?: number;
  stallMs?: number;
}

export interface StorageUploadResult {
  path: string;
  bytes: number;
  /** Storage already had it: an earlier attempt landed before its reply was lost. */
  alreadyThere: boolean;
}

function fileSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Upload `fileUri` to `bucket/path` natively. Resolves when Storage has
 * the object (including when it already did), rejects with a
 * `StorageUploadError` carrying the status, a `TimeoutError` when the
 * upload stalls or overruns, or an AbortError when `signal` fires.
 */
export async function uploadToStorage(
  bucket: string,
  path: string,
  fileUri: string,
  contentType: string,
  options: StorageUploadOptions = {},
): Promise<StorageUploadResult> {
  const { signal, upsert = false } = options;
  if (signal?.aborted) throw abortError();
  const { supabaseUrl, supabaseAnonKey } = requireEnv();
  const token = options.accessToken ?? (await freshAccessToken());
  if (signal?.aborted) throw abortError();

  const bytes = fileSize(fileUri);
  const deadline = options.deadlineMs ?? uploadDeadlineMs(bytes);
  const stallLimit = options.stallMs ?? STALL_MS;
  const clockRunning = options.clockRunning ?? (() => true);
  const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${path}`;
  const stop = perfStart(`upload ${bucket}`);

  // Active time only: the ticks while the clock is paused do not count,
  // and a gap longer than a couple of ticks (the app was suspended, so
  // the timer was too) is not counted as time spent either.
  let active = 0;
  let lastProgressAt = 0;
  const task = LegacyFileSystem.createUploadTask(
    url,
    fileUri,
    {
      httpMethod: "POST",
      uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: LegacyFileSystem.FileSystemSessionType.BACKGROUND,
      headers: {
        authorization: `Bearer ${token}`,
        apikey: supabaseAnonKey,
        "content-type": contentType,
        "x-upsert": upsert ? "true" : "false",
        "cache-control": `max-age=${options.cacheControlSeconds ?? IMMUTABLE_CACHE_SECONDS}`,
      },
    },
    (progress) => {
      lastProgressAt = active;
      options.onProgress?.(progress.totalBytesSent, progress.totalBytesExpectedToSend || bytes);
    },
  );

  let tick: ReturnType<typeof setInterval> | undefined;
  let onAbort: (() => void) | undefined;
  const watchdog = new Promise<never>((_, reject) => {
    let settled = false;
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
      task.cancelAsync().catch(() => undefined);
    };
    let last = Date.now();
    tick = setInterval(() => {
      const t = Date.now();
      const dt = Math.min(t - last, TICK_MS * 2);
      last = t;
      if (!clockRunning()) return;
      active += dt;
      if (active > deadline || active - lastProgressAt > stallLimit) fail(new TimeoutError("The upload"));
    }, TICK_MS);
    onAbort = () => fail(abortError());
    signal?.addEventListener("abort", onAbort);
  });

  try {
    const result = await Promise.race([task.uploadAsync(), watchdog]);
    // A cancelled task resolves with nothing.
    if (!result) throw abortError();
    if (result.status >= 200 && result.status < 300) {
      stop({ bytes, path: shortId(path.split("/").pop()) });
      return { path, bytes, alreadyThere: false };
    }
    if (!upsert && isAlreadyStored(result.status, result.body ?? "")) {
      stop({ bytes, alreadyThere: true });
      return { path, bytes, alreadyThere: true };
    }
    throw new StorageUploadError(result.status, result.body ?? "");
  } finally {
    if (tick) clearInterval(tick);
    if (onAbort) signal?.removeEventListener("abort", onAbort);
  }
}
