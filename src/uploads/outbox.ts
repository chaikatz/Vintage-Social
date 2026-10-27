import { AppState, Platform, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import * as VideoThumbnails from "expo-video-thumbnails";
import { File } from "expo-file-system";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import { queryClient } from "@/lib/queryClient";
import { uploadFile } from "@/api/media";
import { createPost, ownPostExists, type NewPost } from "@/api/posts";
import { tagMembers } from "@/api/tags";
import { prepareImage } from "@/media/nativeMedia";
import { bakeVideo, inspectVideo, isInterruptedBake } from "@/filters/bakeVideo";
import { getFilter } from "@/filters/presets";
import { markDeveloped } from "@/darkroom/posted";
import { rememberPlace } from "@/utils/reverseGeocode";
import { showAlert } from "@/utils/alert";
import { ownedPath } from "@/utils/storagePath";
import { abortError, backoffDelay, isAbortError, isTransient, withTimeout } from "@/utils/retry";
import { perfLog, perfStart, shortId } from "@/utils/perf";
import { NotSignedInError, freshAccessToken, isExpiredAuth } from "./storageUpload";
import * as disk from "./jobFiles";
import { setPendingPosts } from "./store";
import { confirmedRow, placeConfirmedPost } from "./feedCache";
import { failureWords, type FailureReason } from "./words";
import type { JobStep, OutboxJob, PendingPost, PendingState, PostDraft } from "./types";

/**
 * The post outbox: what happens after Share.
 *
 * Compose hands over a frozen draft and goes straight back to Home. The
 * outbox takes its own copy of the media, writes the job to disk, and works
 * through it here, one job at a time:
 *
 *   1. prepare: the photograph sized for the feed with its grid thumbnail
 *      from one decode; or the clip developed natively, then a poster frame
 *      cut from the developed clip.
 *   2. upload: the media and the thumbnail side by side, streamed from
 *      disk by the phone.
 *   3. insert: the posts row. This is the moment the post exists, and the
 *      moment followers are told (an AFTER INSERT trigger), so it comes
 *      strictly after both files are in storage, and nothing that can fail
 *      for a reason the member could fix comes after it.
 *   4. follow-up: tags (which notify too, so after the row), the
 *      Darkroom's record, the place, the profile count. Each best-effort.
 *
 * Every step can run again without harm, because the post id was chosen
 * once on the phone: storage says an object already exists (409) and
 * PostgreSQL says the row already exists (23505) when an earlier attempt
 * landed and only its reply was lost, and both mean done. The job is
 * written after every step, so after the app is closed it resumes where
 * it stopped: at launch, when the app comes back to the front, and when
 * the connection returns.
 *
 * What it will not do: upload a clip whose development failed as if it had
 * worked. A failed bake is tried again, and after that the post waits with
 * Retry and Discard. Nor does it ever show "Couldn’t publish" for a lost
 * connection: the card says it is waiting for one, and carries on.
 */

const FEED_MAX = 1440;
const THUMB_SIDE = 480;
const PHOTO_QUALITY = 0.9;
const POSTER_QUALITY = 0.85;
/** What the storage project is assumed to accept; a larger file would fail only after the whole upload. */
const STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;
/** Tries of a network step before the post gives up and offers Retry. Time offline does not count. */
const MAX_NETWORK_ATTEMPTS = 4;
/** Tries of local work (a decode, a bake) before the same. */
const MAX_LOCAL_ATTEMPTS = 3;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;
const TAG_ATTEMPTS = 3;
const TAG_TIMEOUT_MS = 15_000;
/** How long "Posted" stays on the card when the feed is not there to take its place. */
const DONE_GRACE_MS = 1500;
/** A finished job's files are kept this long at most within one run, and never past the next launch. */
const FINISHED_KEEP_MS = 24 * 60 * 60 * 1000;

/** The job cannot go on until something outside it changes. Not a failure, and not counted as one. */
class WaitFor extends Error {
  constructor(readonly reason: "network" | "foreground") {
    super(reason === "network" ? "Waiting for a connection" : "Waiting for the app to be open");
    this.name = "WaitFor";
  }
}

/** A refusal no retry will change. */
class GiveUp extends Error {
  constructor(readonly reason: FailureReason) {
    super(reason);
    this.name = "GiveUp";
  }
}

interface Live {
  job: OutboxJob;
  /** Why the job is paused. Not written to disk: a relaunch looks again. */
  waiting: "network" | "foreground" | null;
  running: boolean;
  /** Fraction through the current step, while one is measurable. */
  progress: number | null;
  reportedPct: number | null;
  /** Failed tries of the current step. */
  attempts: number;
  /** Storage refused the token: ask auth for a new one before the next upload. */
  forceRefresh: boolean;
  /** The post exists; its card has handed over to the feed's row. */
  retired: boolean;
  /** Discarded or forgotten: anything still in flight for it must stop and write nothing. */
  gone: boolean;
  ctl: AbortController | null;
  span: ((extra?: Record<string, unknown>) => number) | null;
}

const jobs = new Map<string, Live>();
let started = false;
let generation = 0;
let online = true;
let appState: AppStateStatus = (AppState.currentState as AppStateStatus | null) ?? "active";
let pumpPromise: Promise<void> | null = null;
let pumpGeneration = -1;
let unsubscribers: (() => void)[] = [];
let profileRefresher: (() => Promise<unknown>) | null = null;

const config = {
  sleep: (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError());
      const t = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(abortError());
      };
      signal?.addEventListener("abort", onAbort);
    }),
  doneGraceMs: DONE_GRACE_MS,
};

// ---------------------------------------------------------------------------
// Conditions
// ---------------------------------------------------------------------------

function demo(): boolean {
  return isDemoMode();
}

/** A video can only be developed with the app in front: AVFoundation stops an export in the background. */
function inForeground(): boolean {
  return appState !== "background";
}

/** The upload's clock runs only while it could be making progress. */
function clockRunning(): boolean {
  return online && appState !== "background" && appState !== "inactive";
}

function connected(): boolean {
  return demo() || online;
}

// ---------------------------------------------------------------------------
// What Home sees
// ---------------------------------------------------------------------------

function resolve(job: OutboxJob, ref: string | null): string | null {
  return disk.resolveJobFile(job.id, ref);
}

function visibleState(live: Live): PendingState {
  const { job } = live;
  if (job.failed) return "failed";
  if (job.step === "follow-up" || job.step === "done") return "done";
  if (live.waiting === "foreground") return "waiting-foreground";
  if (live.waiting === "network") return "waiting-network";
  // A background upload goes on waiting for the network by itself; the
  // card says what it is waiting for rather than that it is uploading.
  if (!connected() && (job.step === "upload" || job.step === "insert")) return "waiting-network";
  switch (job.step) {
    case "prepare":
      return job.draft.kind === "video" && job.draft.bakeVideo ? "developing" : "preparing";
    case "upload":
      return "uploading";
    default:
      return "saving";
  }
}

/** The picture the card draws: the job's own copy, and for a clip the developed one once it exists. */
function preview(job: OutboxJob): { uri: string; thumb: string | null; baked: boolean } {
  const source = resolve(job, job.files.source);
  const media = resolve(job, job.files.media);
  const thumb = resolve(job, job.files.thumb);
  if (job.draft.kind === "photo") {
    return { uri: source ?? media ?? job.draft.sourceUri, thumb, baked: job.draft.filterBaked };
  }
  const developed = Boolean(job.prepared?.baked && media);
  return { uri: (developed ? media : source ?? media) ?? job.draft.sourceUri, thumb, baked: developed };
}

function publish(): void {
  const list: PendingPost[] = [];
  for (const live of jobs.values()) {
    if (live.gone || live.retired) continue;
    const state = visibleState(live);
    const look = preview(live.job);
    list.push({
      id: live.job.id,
      draft: live.job.draft,
      state,
      progress: state === "developing" || state === "uploading" ? live.progress : null,
      error: live.job.failed?.message ?? null,
      previewUri: look.uri,
      createdAt: live.job.createdAt,
      previewThumbUri: look.thumb,
      previewBaked: look.baked,
    });
  }
  list.sort((a, b) => b.createdAt - a.createdAt);
  setPendingPosts(list);
}

/** Progress, passed on a whole percent at a time: a byte count per callback would re-render Home for nothing. */
function setProgress(live: Live, fraction: number): void {
  const clamped = Math.min(1, Math.max(0, fraction));
  const pct = Math.floor(clamped * 100);
  live.progress = clamped;
  if (pct === live.reportedPct) return;
  live.reportedPct = pct;
  publish();
}

function persist(live: Live): void {
  if (live.gone) return;
  live.job.rev += 1;
  try {
    disk.writeJob(live.job);
  } catch {
    // The post goes on; only a relaunch at this exact step would repeat
    // work, and every step is safe to repeat.
    perfLog("outbox write failed", { id: shortId(live.job.id) });
  }
}

function newLive(job: OutboxJob): Live {
  return {
    job,
    waiting: null,
    running: false,
    progress: null,
    reportedPct: null,
    attempts: 0,
    forceRefresh: false,
    retired: false,
    gone: false,
    ctl: null,
    span: null,
  };
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

function nextRunnable(): Live | null {
  let best: Live | null = null;
  for (const live of jobs.values()) {
    if (live.gone || live.running || live.waiting || live.job.failed || live.job.step === "done") continue;
    if (!best || live.job.createdAt < best.job.createdAt) best = live;
  }
  return best;
}

/**
 * One job at a time, oldest first. Calling it while it runs is a no-op:
 * the loop picks up new work itself. A loop left over from before a
 * sign-out stops at its next turn, and a new one starts only after it, so
 * two never run side by side.
 */
function pump(): Promise<void> {
  if (pumpPromise && pumpGeneration === generation) return pumpPromise;
  if (pumpPromise) return pumpPromise.then(() => pump());
  const gen = generation;
  const run = async (): Promise<void> => {
    // Let the assignment below happen before anything can finish.
    await null;
    try {
      while (gen === generation) {
        const next = nextRunnable();
        if (!next) break;
        await runJob(next);
      }
    } finally {
      if (pumpPromise === promise) pumpPromise = null;
    }
  };
  const promise = run();
  pumpPromise = promise;
  pumpGeneration = gen;
  return promise;
}

/**
 * Whether the job is the signed-in member's. The outbox is forgotten at
 * sign-out; this catches a job left by a member whose session ended while
 * the app was not running to hear it. No answer at all (no network, a
 * session still restoring) is not a reason to drop anyone's post.
 */
async function belongsToSignedInMember(live: Live): Promise<boolean> {
  if (demo()) return true;
  try {
    const { data } = await withTimeout(10_000, () => supabase.auth.getSession());
    const uid = data.session?.user?.id;
    return !uid || uid === live.job.draft.userId;
  } catch {
    return true;
  }
}

function drop(live: Live): void {
  live.gone = true;
  jobs.delete(live.job.id);
  disk.deleteJob(live.job.id);
  publish();
}

async function runJob(live: Live): Promise<void> {
  const gen = generation;
  const ctl = new AbortController();
  live.ctl = ctl;
  live.running = true;
  const alive = () => !live.gone && gen === generation && !ctl.signal.aborted;
  publish();
  try {
    if (!(await belongsToSignedInMember(live))) {
      if (alive()) drop(live);
      return;
    }
    while (alive() && live.job.step !== "done") {
      const step = live.job.step;
      try {
        await runStep(live, step, ctl.signal);
        if (!alive()) return;
        live.attempts = 0;
        live.progress = null;
        live.reportedPct = null;
        live.forceRefresh = live.forceRefresh && step !== "upload";
        persist(live);
        publish();
      } catch (err) {
        if (!alive()) return;
        if (decide(live, step, err) === "stop") return;
        live.attempts += 1;
        live.progress = null;
        live.reportedPct = null;
        publish();
        await config.sleep(backoffDelay(live.attempts + 1, RETRY_BASE_MS, RETRY_MAX_MS), ctl.signal).catch(() => undefined);
      }
    }
  } finally {
    live.running = false;
    if (live.ctl === ctl) live.ctl = null;
    // Never leave a job the loop would pick straight up again.
    if (!live.gone && gen === generation && !live.job.failed && !live.waiting && live.job.step !== "done" && !ctl.signal.aborted) {
      live.waiting = "network";
    }
    publish();
  }
}

function reasonFor(live: Live, step: JobStep): FailureReason {
  if (step === "prepare") return live.job.draft.kind === "video" && live.job.draft.bakeVideo ? "develop" : "prepare";
  if (step === "upload") return "upload";
  return "save";
}

function fail(live: Live, reason: FailureReason, step: JobStep, err?: unknown): "stop" {
  live.job.failed = { message: failureWords(reason, live.job.draft.kind), at: Date.now() };
  persist(live);
  const e = err as { statusCode?: unknown; status?: unknown; code?: unknown } | undefined;
  perfLog("post failed", {
    id: shortId(live.job.id),
    step,
    reason,
    status: e?.statusCode ?? e?.status ?? null,
    code: typeof e?.code === "string" ? e.code : null,
  });
  return "stop";
}

/** After a step threw: wait, try again, or give up. */
function decide(live: Live, step: JobStep, err: unknown): "retry" | "stop" {
  if (err instanceof WaitFor) {
    live.waiting = err.reason;
    return "stop";
  }
  if (err instanceof GiveUp) return fail(live, err.reason, step, err);
  if (err instanceof NotSignedInError) return fail(live, "signed-out", step, err);
  // The app left the front mid-bake. Not a failure of the bake: it runs
  // again from the start once the app is active.
  if (step === "prepare" && live.job.draft.kind === "video" && isInterruptedBake(err)) {
    live.waiting = "foreground";
    return "stop";
  }
  const lastTry = live.attempts + 1 >= (step === "prepare" ? MAX_LOCAL_ATTEMPTS : MAX_NETWORK_ATTEMPTS);
  if (step === "prepare") return lastTry ? fail(live, reasonFor(live, step), step, err) : "retry";
  if (isExpiredAuth(err)) {
    live.forceRefresh = true;
    return lastTry ? fail(live, reasonFor(live, step), step, err) : "retry";
  }
  if (isTransient(err) || isAbortError(err)) {
    // No connection is not a try that failed: wait for one.
    if (!connected()) {
      live.waiting = "network";
      return "stop";
    }
    return lastTry ? fail(live, reasonFor(live, step), step, err) : "retry";
  }
  // A refusal (a policy, a constraint, a file too large): another go would
  // be refused the same way.
  return fail(live, reasonFor(live, step), step, err);
}

async function runStep(live: Live, step: JobStep, signal: AbortSignal): Promise<void> {
  switch (step) {
    case "prepare":
      return prepareStep(live, signal);
    case "upload":
      return uploadStep(live, signal);
    case "insert":
      return insertStep(live, signal);
    case "follow-up":
      return followUpStep(live, signal);
    case "done":
      return;
  }
}

// ---------------------------------------------------------------------------
// 1. Prepare
// ---------------------------------------------------------------------------

/** The database holds a clip's length to 1–60 s; the picker can round 60.6 s up to 61. */
export function clampDuration(seconds: number | null | undefined): number | null {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(60, Math.max(1, Math.round(seconds)));
}

function videoType(uri: string): { ext: string; contentType: string } {
  const ext = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase();
  return ext === "mov" ? { ext: "mov", contentType: "video/quicktime" } : { ext: "mp4", contentType: "video/mp4" };
}

async function prepareStep(live: Live, signal: AbortSignal): Promise<void> {
  const { job } = live;
  const d = job.draft;
  // The browser review runs on the demo store with nothing to upload: the
  // picture it was given is the post.
  if (demo() && Platform.OS === "web") {
    job.files.media = job.files.source ?? d.sourceUri;
    job.files.thumb = null;
    job.prepared = {
      width: d.sourceWidth,
      height: d.sourceHeight,
      duration: d.kind === "video" ? clampDuration(d.durationSeconds) : null,
      baked: d.kind === "photo" ? d.filterBaked : false,
      ...(d.kind === "video" ? videoType(d.sourceUri) : { ext: "jpg", contentType: "image/jpeg" }),
    };
    job.step = "upload";
    return;
  }
  if (d.kind === "photo") await preparePhoto(live);
  else await prepareVideo(live, signal);
  job.step = "upload";
}

function sourceOf(job: OutboxJob): string {
  const source = resolve(job, job.files.source) ?? job.draft.sourceUri;
  if (!disk.fileExists(source)) throw new GiveUp("prepare");
  return source;
}

async function preparePhoto(live: Live): Promise<void> {
  const { job } = live;
  // Made already, before a relaunch: nothing to do again.
  if (job.prepared && disk.fileExists(resolve(job, job.files.media)) && disk.fileExists(resolve(job, job.files.thumb))) {
    return;
  }
  const source = sourceOf(job);
  const stop = perfStart("prepare photo");
  const out = await prepareImage(source, { maxSide: FEED_MAX, quality: PHOTO_QUALITY, thumbSide: THUMB_SIDE });
  if (live.gone) return;
  const thumb = out.thumb ?? (await prepareImage(out.uri, { maxSide: THUMB_SIDE, quality: 0.8 }));
  if (live.gone) return;
  // A preparer that handed the source straight back must not have it moved away.
  const keep = (uri: string) => (uri === source ? "copy" : "move");
  job.files.media = disk.adoptIntoJob(job.id, out.uri, "media.jpg", keep(out.uri));
  job.files.thumb = disk.adoptIntoJob(job.id, thumb.uri, "thumb.jpg", keep(thumb.uri));
  job.prepared = {
    width: out.width,
    height: out.height,
    duration: null,
    baked: job.draft.filterBaked,
    ext: "jpg",
    contentType: "image/jpeg",
  };
  stop({
    id: shortId(job.id),
    width: out.width,
    height: out.height,
    bytes: disk.fileBytes(resolve(job, job.files.media)),
    via: (out as { via?: unknown }).via ?? null,
  });
}

async function devInspect(uri: string | null): Promise<Record<string, unknown> | null> {
  if (!uri || typeof __DEV__ === "undefined" || !__DEV__) return null;
  const info = await inspectVideo(uri).catch(() => null);
  return info ? { ...info } : null;
}

async function prepareVideo(live: Live, signal: AbortSignal): Promise<void> {
  const { job } = live;
  const d = job.draft;
  const developedAlready = job.prepared?.baked === true && disk.fileExists(resolve(job, job.files.media));
  if (d.bakeVideo && !developedAlready) {
    if (!inForeground()) throw new WaitFor("foreground");
    const source = sourceOf(job);
    const stop = perfStart("video bake");
    const sourceInfo = await devInspect(source);
    const out = await bakeVideo(source, getFilter(d.filterId), {
      jobId: job.id,
      signal,
      onProgress: (fraction) => {
        if (!live.gone) setProgress(live, fraction);
      },
    });
    if (live.gone) return;
    job.files.media = disk.adoptIntoJob(job.id, out.uri, "media.mp4");
    const bytes = out.bytes || disk.fileBytes(resolve(job, job.files.media));
    stop({
      id: shortId(job.id),
      width: out.width,
      height: out.height,
      duration: out.duration,
      bytes,
      bitrate: out.bitrate,
      source: sourceInfo,
      output: await devInspect(resolve(job, job.files.media)),
    });
    if (bytes > STORAGE_LIMIT_BYTES) throw new GiveUp("too-large");
    job.prepared = {
      width: out.width,
      height: out.height,
      duration: clampDuration(out.duration || d.durationSeconds),
      baked: true,
      ext: "mp4",
      contentType: "video/mp4",
    };
    // The developed clip is the post now. The source copy was the bulk of
    // the job's disk; it goes as soon as it has done its work.
    if (job.files.source && job.files.source !== job.files.media) {
      disk.removeJobFile(job.id, job.files.source);
      job.files.source = null;
    }
    // Written before the poster is cut, so a relaunch does not develop it twice.
    persist(live);
    publish();
  } else if (!d.bakeVideo) {
    // A build that cannot develop video posts the clip as recorded, with
    // the film applied at play time, as it always has. Nothing is changed
    // about it, so it must already fit.
    const source = sourceOf(job);
    if (disk.fileBytes(source) > STORAGE_LIMIT_BYTES) throw new GiveUp("too-large");
    job.files.media = job.files.source ?? source;
    job.prepared = {
      width: d.sourceWidth,
      height: d.sourceHeight,
      duration: clampDuration(d.durationSeconds),
      baked: false,
      ...videoType(source),
    };
  }
  if (!job.files.thumb || !disk.fileExists(resolve(job, job.files.thumb))) {
    job.files.thumb = await makePoster(job);
  }
}

/**
 * The poster frame: what the grid draws and what a card shows until the
 * clip starts. Cut from the clip that will be posted, so it matches what
 * plays, and kept at feed size. A clip without one still posts.
 */
async function makePoster(job: OutboxJob): Promise<string | null> {
  const clip = resolve(job, job.files.media);
  if (!clip) return null;
  try {
    const frame = await VideoThumbnails.getThumbnailAsync(clip, { time: 500 });
    const poster = await prepareImage(frame.uri, { maxSide: FEED_MAX, quality: POSTER_QUALITY });
    const name = disk.adoptIntoJob(job.id, poster.uri, "thumb.jpg");
    if (frame.uri !== poster.uri && frame.uri.startsWith("file:")) {
      try {
        const raw = new File(frame.uri);
        if (raw.exists) raw.delete();
      } catch {
        // In the cache folder; iOS clears it.
      }
    }
    return name;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 2. Upload
// ---------------------------------------------------------------------------

function mediaKey(job: OutboxJob): string {
  return ownedPath(job.draft.userId, `${job.id}.${job.prepared?.ext ?? "jpg"}`);
}

function thumbKey(job: OutboxJob): string {
  return ownedPath(job.draft.userId, `${job.id}.jpg`);
}

async function uploadStep(live: Live, signal: AbortSignal): Promise<void> {
  const { job } = live;
  if (demo()) {
    job.step = "insert";
    return;
  }
  const media = resolve(job, job.files.media);
  const thumb = resolve(job, job.files.thumb);
  // Files gone missing (they live in Documents, so this would be unusual):
  // make them again rather than post without them.
  if (!job.prepared || !disk.fileExists(media) || (job.files.thumb && !disk.fileExists(thumb))) {
    if (job.draft.kind === "photo") job.prepared = null;
    job.step = "prepare";
    return;
  }
  // The browser has no background session to wait for a connection.
  if (Platform.OS === "web" && !online) throw new WaitFor("network");

  const accessToken = Platform.OS === "web" ? undefined : await freshAccessToken(live.forceRefresh);
  const parts: { which: "media" | "thumb"; bucket: "media" | "thumbnails"; key: string; uri: string; type: string }[] = [];
  if (!job.uploaded.media) {
    parts.push({ which: "media", bucket: "media", key: mediaKey(job), uri: media!, type: job.prepared.contentType });
  }
  if (thumb && !job.uploaded.thumb) {
    parts.push({ which: "thumb", bucket: "thumbnails", key: thumbKey(job), uri: thumb, type: "image/jpeg" });
  }
  const totals = parts.map((p) => Math.max(1, disk.fileBytes(p.uri)));
  const total = totals.reduce((a, b) => a + b, 0);
  const sent = parts.map(() => 0);
  const report = () => setProgress(live, sent.reduce((a, b) => a + b, 0) / total);

  // Side by side: the same host, so one connection carries both. Settled
  // together, so a failure of one never leaves the other still running
  // into the next attempt.
  const results = await Promise.allSettled(
    parts.map(async (part, i) => {
      await uploadFile(part.bucket, part.key, part.uri, part.type, {
        retry: false,
        signal,
        accessToken,
        clockRunning,
        onProgress: (bytes) => {
          if (live.gone) return;
          sent[i] = Math.min(bytes, totals[i]);
          report();
        },
      });
      if (live.gone) return;
      sent[i] = totals[i];
      job.uploaded[part.which] = true;
      persist(live);
      report();
    }),
  );
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
  job.step = "insert";
}

// ---------------------------------------------------------------------------
// 3. Insert
// ---------------------------------------------------------------------------

function newPostFor(job: OutboxJob): NewPost {
  const d = job.draft;
  const prepared = job.prepared!;
  const local = demo();
  const hasThumb = Boolean(job.files.thumb) && (local || job.uploaded.thumb);
  return {
    id: d.id,
    author_id: d.userId,
    media_type: d.kind,
    // The demo store keeps the phone's own file; a real post its storage key.
    media_path: local ? resolve(job, job.files.media) ?? d.sourceUri : mediaKey(job),
    thumb_path: hasThumb ? (local ? resolve(job, job.files.thumb) : thumbKey(job)) : null,
    width: prepared.width,
    height: prepared.height,
    duration_seconds: d.kind === "video" ? prepared.duration : null,
    filter_id: d.filterId,
    filter_baked: prepared.baked,
    show_date_stamp: d.showDateStamp,
    caption: d.caption.trim(),
    taken_at: d.takenAt,
    location: d.location?.trim() || null,
    lat: d.lat,
    lng: d.lng,
    place_id: d.placeId,
  };
}

async function insertStep(live: Live, signal: AbortSignal): Promise<void> {
  const { job } = live;
  if (!job.prepared) {
    job.step = "prepare";
    return;
  }
  if (!connected()) throw new WaitFor("network");
  if (!job.insertTried) {
    job.insertTried = true;
    persist(live);
  }
  const stop = perfStart("insert");
  await createPost(newPostFor(job), { signal });
  if (live.gone) return;
  stop({ id: shortId(job.id), kind: job.draft.kind });
  job.step = "follow-up";
  persist(live);
  confirm(live);
}

/** The server has it: the feed's row takes the card's place, drawn from the files already on the phone. */
function confirm(live: Live): void {
  const { job } = live;
  if (job.prepared) {
    const look = preview(job);
    // A photograph keeps the very file the card was drawing, so the image
    // cache already has it decoded; a clip the developed file and poster.
    const mediaUri = job.draft.kind === "photo" ? look.uri : resolve(job, job.files.media) ?? look.uri;
    try {
      placeConfirmedPost(
        queryClient,
        job.draft.userId,
        confirmedRow({
          draft: job.draft,
          prepared: job.prepared,
          mediaUri,
          thumbUri: resolve(job, job.files.thumb),
          createdAt: new Date().toISOString(),
        }),
      );
    } catch {
      // The next refetch shows it all the same.
    }
  }
  live.span?.({ id: shortId(job.id), kind: job.draft.kind });
  live.span = null;
  publish();
  setTimeout(() => {
    live.retired = true;
    publish();
  }, config.doneGraceMs);
}

// ---------------------------------------------------------------------------
// 4. Follow-up
// ---------------------------------------------------------------------------

async function followUpStep(live: Live, signal: AbortSignal): Promise<void> {
  const { job } = live;
  const d = job.draft;
  // Developed from the Darkroom: it remembers, on this phone, that this
  // one has been shared, takes it off the shelf, and moves the room on.
  if (d.assetId) {
    try {
      markDeveloped(d.assetId);
    } catch {
      // Best-effort: a repeat later, never the post.
    }
  }
  // The town it was taken in, learned now so the places view already knows.
  if (d.lat != null && d.lng != null) {
    rememberPlace({ lat: d.lat, lng: d.lng }).catch(() => undefined);
  }
  // post_count is bumped by a trigger and lives on the profile row.
  try {
    profileRefresher?.().catch(() => undefined);
  } catch {
    // As above.
  }
  if (d.tagIds.length > 0) await sendTags(live, signal);
  if (live.gone) return;
  job.step = "done";
  job.finishedAt = Date.now();
}

/**
 * The tags ride behind the post, because each one notifies the member
 * tagged. A duplicate means an earlier attempt landed. Their failure is
 * worth a word but never the photograph, which is already up.
 */
async function sendTags(live: Live, signal: AbortSignal): Promise<void> {
  const d = live.job.draft;
  for (let attempt = 1; ; attempt++) {
    try {
      await withTimeout(TAG_TIMEOUT_MS, () => tagMembers(d.id, d.userId, d.tagIds), { signal, what: "Tagging" });
      return;
    } catch (err) {
      if (signal.aborted || live.gone) throw abortError();
      if ((err as { code?: unknown }).code === "23505") return;
      if (isTransient(err)) {
        if (!connected()) throw new WaitFor("network");
        if (attempt < TAG_ATTEMPTS) {
          await config.sleep(backoffDelay(attempt + 1, RETRY_BASE_MS, RETRY_MAX_MS), signal);
          continue;
        }
      }
      showAlert(
        "Posted, but the tags didn’t take",
        `${d.kind === "video" ? "The clip" : "The photograph"} is up. You can try tagging again later.`,
      );
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// The public surface
// ---------------------------------------------------------------------------

/**
 * Copies the draft's source into the outbox (app Documents/outbox/<id>/),
 * persists the job, and starts the runner. Resolves quickly (a file copy and
 * a small JSON write): the caller navigates right after.
 *
 * The same id twice (a second tap that got through) is ignored. Rejects
 * only when the job could not be kept at all, which is the one case
 * compose should say something about.
 */
export async function enqueuePost(draft: PostDraft): Promise<void> {
  if (!disk.isSafeJobId(draft.id)) throw new Error("This post has no id.");
  if (!started) startOutbox();
  if (jobs.has(draft.id) || disk.readJob(draft.id)) return;
  const stop = perfStart("enqueue");
  const job: OutboxJob = {
    v: 1,
    rev: 0,
    id: draft.id,
    createdAt: Date.now(),
    draft: { ...draft, tagIds: [...draft.tagIds], author: { ...draft.author } },
    step: "prepare",
    files: { source: null, media: null, thumb: null },
    prepared: null,
    uploaded: { media: false, thumb: false },
    insertTried: false,
    failed: null,
    finishedAt: null,
  };
  try {
    job.files.source = disk.copySourceIntoJob(job.id, draft.sourceUri, draft.kind);
    job.rev = 1;
    disk.writeJob(job);
  } catch (err) {
    disk.deleteJob(job.id);
    throw err;
  }
  const live = newLive(job);
  live.span = perfStart("enqueue → done");
  jobs.set(job.id, live);
  stop({ id: shortId(job.id), kind: draft.kind });
  publish();
  void pump();
}

export { usePendingPosts } from "./store";

/** Try a failed post again from the step it stopped at; also nudges one that is waiting. */
export function retryPost(id: string): void {
  const live = jobs.get(id);
  if (!live || live.gone) return;
  if (live.job.failed) {
    live.job.failed = null;
    live.attempts = 0;
    persist(live);
  }
  live.waiting = null;
  publish();
  void pump();
}

/**
 * Give up on a post that has not gone up: its files on the phone, and
 * whatever of it already reached storage, which nothing would ever point
 * at. Unless the row might exist: an insert that timed out may have
 * landed, and a post must never lose its photograph, so then storage is
 * asked first and left alone on any doubt.
 */
export async function discardPost(id: string): Promise<void> {
  const live = jobs.get(id);
  if (!live || live.gone) return;
  const { job } = live;
  // It is posted; there is nothing left to discard.
  if (job.step === "follow-up" || job.step === "done") return;
  live.gone = true;
  try {
    live.ctl?.abort();
  } catch {
    // Already stopped.
  }
  jobs.delete(id);
  publish();
  disk.deleteJob(id);
  if (demo()) return;
  const mayHaveUploaded = job.uploaded.media || job.uploaded.thumb || job.step === "upload" || job.step === "insert";
  if (!mayHaveUploaded) return;
  if (job.insertTried && (await ownPostExists(id, job.draft.userId))) return;
  const remove = (bucket: "media" | "thumbnails", key: string) =>
    withTimeout(15_000, () => supabase.storage.from(bucket).remove([key])).catch(() => undefined);
  await Promise.all([
    job.prepared ? remove("media", mediaKey(job)) : Promise.resolve(undefined),
    remove("thumbnails", thumbKey(job)),
  ]);
}

function loadFromDisk(): void {
  for (const id of disk.listJobIds()) {
    if (!disk.isSafeJobId(id) || jobs.has(id)) continue;
    const job = disk.readJob(id);
    if (!job) {
      disk.deleteJob(id);
      continue;
    }
    // Finished in an earlier run. Its files were kept so the feed could
    // draw the new post from them until this launch; nothing needs them now.
    if (job.step === "done") {
      disk.deleteJob(id);
      continue;
    }
    const live = newLive(job);
    // Posted already, with only the follow-ups left: no card for it.
    if (job.step === "follow-up") live.retired = true;
    jobs.set(id, live);
  }
}

function sweepFinished(): void {
  const now = Date.now();
  for (const live of [...jobs.values()]) {
    if (live.running || live.job.step !== "done") continue;
    if (live.job.finishedAt != null && now - live.job.finishedAt > FINISHED_KEEP_MS) {
      jobs.delete(live.job.id);
      disk.deleteJob(live.job.id);
    }
  }
}

function listen(): void {
  const subs: (() => void)[] = [];
  try {
    const sub = AppState.addEventListener("change", (next) => {
      const was = appState;
      appState = next;
      if (next === "active" && was !== "active") startOutbox();
      else publish();
    });
    subs.push(() => sub.remove());
  } catch {
    // No app state to follow (a test, an odd host): launch alone resumes.
  }
  try {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const next = state.isConnected !== false;
      const was = online;
      online = next;
      if (next && !was) startOutbox();
      else if (next !== was) publish();
    });
    subs.push(unsubscribe);
  } catch {
    // As above.
  }
  // Heard here as well as in the session provider: a session refused at
  // launch says SIGNED_OUT once, possibly before any screen is listening.
  if (!demo()) {
    try {
      const { data } = supabase.auth.onAuthStateChange((event) => {
        if (event === "SIGNED_OUT") forgetOutbox();
      });
      subs.push(() => data.subscription.unsubscribe());
    } catch {
      // As above.
    }
  }
  unsubscribers = subs;
}

/** Idempotent: resumes persisted jobs. Called once from app/_layout.tsx, and again on AppState active and on reconnect. */
export function startOutbox(): void {
  try {
    if (!started) {
      started = true;
      listen();
      loadFromDisk();
    }
    sweepFinished();
    // Anything paused gets another look: the condition it waited on may
    // have changed, and if not it simply waits again.
    for (const live of jobs.values()) {
      if (!live.running) live.waiting = null;
    }
    publish();
    void pump();
  } catch {
    // Posting must never be what keeps the app from starting.
  }
}

/** Sign-out: cancel and delete every job and file. */
export function forgetOutbox(): void {
  generation += 1;
  for (const live of jobs.values()) {
    live.gone = true;
    try {
      live.ctl?.abort();
    } catch {
      // Already stopped.
    }
  }
  jobs.clear();
  try {
    disk.deleteAllJobs();
  } catch {
    // Nothing more to do; the next launch's sweep tries again.
  }
  publish();
}

/**
 * The session provider's profile re-read, handed over by Home (the outbox
 * lives outside React and cannot ask for it). Returns the way to let go.
 */
export function setOutboxProfileRefresher(refresh: (() => Promise<unknown>) | null): () => void {
  profileRefresher = refresh;
  return () => {
    if (profileRefresher === refresh) profileRefresher = null;
  };
}

/** Test hooks: no timers, a simulated relaunch, and a way to wait for the runner to settle. */
export const __outboxTesting = {
  setSleep(sleep: (ms: number, signal?: AbortSignal) => Promise<void>): void {
    config.sleep = sleep;
  },
  setDoneGraceMs(ms: number): void {
    config.doneGraceMs = ms;
  },
  async idle(): Promise<void> {
    for (let i = 0; i < 100 && pumpPromise; i++) await pumpPromise;
    // Let anything the last step scheduled (a store update) land.
    await new Promise((r) => setTimeout(r, 0));
  },
  /** What a relaunch leaves: the disk, and nothing in memory. */
  relaunch(): void {
    generation += 1;
    for (const live of jobs.values()) {
      live.gone = true;
      live.ctl?.abort();
    }
    for (const unsubscribe of unsubscribers) unsubscribe();
    unsubscribers = [];
    jobs.clear();
    started = false;
    online = true;
    appState = "active";
    publish();
  },
  job(id: string): OutboxJob | null {
    return jobs.get(id)?.job ?? null;
  },
};
