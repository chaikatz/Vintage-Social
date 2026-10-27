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

/**
 * An upload that has sent nothing for this long, while it could have, is
 * stuck. This is the only limit: there is no overall deadline, because an
 * upload that is still moving, however slowly, is closer to done than a
 * fresh one, and every new attempt starts again from the first byte. A
 * server that takes the whole body and never answers is caught here too,
 * since nothing more is sent after the last byte.
 */
const STALL_MS = 60_000;
/**
 * The same, for a task created while the app was away and that has not
 * sent a byte. iOS treats a background-session task created from the
 * background as discretionary and may hold it for Wi-Fi and power; once
 * the app is back in front a new task, created now, is not held back.
 */
const DEFERRED_START_MS = 5_000;
const TICK_MS = 1000;

/** Storage refused the file. `status` is the HTTP status; `statusCode` is what storage said in the body, when it said. */
export class StorageUploadError extends Error {
  readonly status: number;
  readonly statusCode: string | number | undefined;
  readonly body: string;
  constructor(status: number, body: string) {
    // Worded to match none of isTransient's patterns: the status alone
    // decides whether it is worth another go.
    let message = `Storage refused the file (HTTP ${status})`;
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
 *
 * Storage says so with a 401 or 403. PostgREST's error reaches the insert
 * as the parsed body with no status at all: `{ code: "PGRST303", message:
 * "JWT expired" }` (PGRST301 on older servers). That happens when the
 * phone's clock runs behind, so supabase-js still believes the token is
 * good and would never refresh it by itself.
 */
export function isExpiredAuth(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { status?: unknown; statusCode?: unknown; message?: unknown; code?: unknown };
  const code = Number(e.statusCode ?? e.status ?? NaN);
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";
  if (code === 401 || code === 403) return /jwt|exp"? claim|token|expired/.test(message);
  if (Number.isFinite(code)) return false;
  return /^PGRST30[13]$/.test(String(e.code ?? "")) || /jwt expired/.test(message);
}

/**
 * The session could not be read because the keychain is locked: the
 * phone is, and iOS has woken the app to finish a background upload. The
 * session is kept in SecureStore with its default "when unlocked"
 * protection, so every read throws "User interaction is not allowed."
 * until the member unlocks the phone. supabase-js reads it before each
 * request, so the insert fails the same way, wrapped by postgrest-js into
 * an error whose message carries SecureStore's.
 *
 * Nothing is wrong with the post. It waits for the app to be open.
 */
export function isSessionUnavailable(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { message?: unknown; code?: unknown; cause?: unknown };
  const text = [e.message, (e.cause as { message?: unknown } | undefined)?.message]
    .filter((m): m is string => typeof m === "string")
    .join(" ");
  // Only the locked phone's own signal: any other keychain failure (a
  // missing entitlement, a corrupt item) would never clear by waiting, and
  // must surface as a failure the member can act on.
  return /user interaction is not allowed|errSecInteractionNotAllowed|-25308/i.test(text);
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
   * Hand the task to a background session, which carries on while the app
   * is away and waits out a lost connection instead of failing. Only the
   * post outbox wants that: it shows the wait on the pending card. A
   * screen waiting on an upload (an avatar's Save) needs the foreground
   * session, which fails at once with no connection so it can say so.
   */
  background?: boolean;
  /**
   * Whether the clock that bounds the upload should run right now. The
   * outbox answers false while the app is in the background or the phone
   * has no connection: a background session simply waits then, and that
   * wait is not the upload being slow.
   */
  clockRunning?: () => boolean;
  /** Override the stall limits (tests). */
  stallMs?: number;
  deferredStartMs?: number;
}

export interface StorageUploadResult {
  path: string;
  bytes: number;
  /** Storage already had it: an earlier attempt landed before its reply was lost. */
  alreadyThere: boolean;
}

/**
 * A task iOS was holding back, given up so that a new one can start from
 * the foreground. Not a failure of the upload, and not counted as one.
 */
export class UploadRestart extends Error {
  constructor() {
    super("The upload is starting again from the foreground");
    this.name = "UploadRestart";
  }
}

/**
 * URLSession errors that another attempt cannot change: a malformed or
 * unsupported address, a file that is missing or unreadable, and the
 * file-handling errors (-3000 to -3007).
 */
function isPermanentUrlError(code: number): boolean {
  return code === -1000 || code === -1002 || code === -1100 || code === -1102 || (code <= -3000 && code >= -3007);
}

/**
 * What a rejected upload task means. Storage's refusals come back as a
 * resolved status, so a rejection is always the connection itself:
 * expo-file-system rejects with "Unable to upload the file: '<NSError
 * description>'", which names the NSURLErrorDomain code. The code decides,
 * not the description: the description of -997 ("Lost connection to
 * background transfer service"), -1020 or -1200 matches no phrase
 * isTransient knows, and is in the phone's language besides. Anything
 * that is not a permanent error comes back worded as a network error, so
 * the caller's own limit on attempts bounds it.
 */
export function classifyUploadRejection(err: unknown): unknown {
  const e = (err ?? {}) as { message?: unknown; code?: unknown };
  const message = typeof e.message === "string" ? e.message : String(err);
  const urlCode = /NSURLErrorDomain Code=(-?\d+)/.exec(message)?.[1];
  if (urlCode != null) {
    if (isPermanentUrlError(Number(urlCode))) return err;
  } else if (e.code !== "ERR_FILESYSTEM_CANNOT_UPLOAD") {
    // Not from URLSession at all (a module missing from the build, a bad
    // argument): as it is.
    return err;
  }
  return Object.assign(new Error(`Network error: ${message}`), { cause: err, urlCode: urlCode == null ? null : Number(urlCode) });
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
 * upload stalls, a network error when the connection failed, an
 * `UploadRestart` when a task created while the app was away never
 * started, or an AbortError when `signal` fires.
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
  const stallLimit = options.stallMs ?? STALL_MS;
  const clockRunning = options.clockRunning ?? (() => true);
  const url = `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${bucket}/${path}`;
  const stop = perfStart(`upload ${bucket}`);

  // Active time only: the ticks while the clock is paused do not count,
  // and a gap longer than a couple of ticks (the app was suspended, so
  // the timer was too) is not counted as time spent either.
  let active = 0;
  let lastProgressAt = 0;
  let progressed = false;
  // Created while the app was away (or offline): see DEFERRED_START_MS.
  const createdPaused = !clockRunning();
  const deferredLimit = options.deferredStartMs ?? DEFERRED_START_MS;
  const task = LegacyFileSystem.createUploadTask(
    url,
    fileUri,
    {
      httpMethod: "POST",
      uploadType: LegacyFileSystem.FileSystemUploadType.BINARY_CONTENT,
      sessionType: options.background
        ? LegacyFileSystem.FileSystemSessionType.BACKGROUND
        : LegacyFileSystem.FileSystemSessionType.FOREGROUND,
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
      progressed = true;
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
      // Made while the app was away and still not started now that it is
      // back: iOS is holding it. A task made now, in front, is not held.
      if (createdPaused && !progressed && active > deferredLimit) fail(new UploadRestart());
      else if (active - lastProgressAt > stallLimit) fail(new TimeoutError("The upload"));
    }, TICK_MS);
    onAbort = () => fail(abortError());
    signal?.addEventListener("abort", onAbort);
  });

  try {
    const upload = task.uploadAsync().catch((err: unknown) => {
      throw classifyUploadRejection(err);
    });
    const result = await Promise.race([upload, watchdog]);
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
