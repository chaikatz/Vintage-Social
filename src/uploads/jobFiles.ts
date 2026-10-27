import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import type { JobStep, OutboxJob, PostDraft } from "./types";

/**
 * The outbox on disk: Documents/outbox/<post id>/, holding job.json and the
 * job's own copies of its media.
 *
 * Documents, not the cache folder or tmp: iOS empties those when space
 * runs low, and both the image manipulator's output and the baked clip are
 * written there. A post that is still going up must not lose its picture
 * to that. The files are removed when the job is discarded, when the member
 * signs out, and at the launch after it has finished.
 *
 * In the browser there is no file system worth the name, so the outbox
 * keeps its jobs in memory only and every function here does nothing.
 */

const ROOT = "outbox";
const JOB = "job.json";
const JOB_NEXT = "job.next.json";

/** Ids are client UUIDs; anything else is refused rather than used as a folder name. */
const SAFE_ID = /^[A-Za-z0-9-]{8,64}$/;

export function isSafeJobId(id: unknown): id is string {
  return typeof id === "string" && SAFE_ID.test(id);
}

export function outboxOnDisk(): boolean {
  return Platform.OS !== "web";
}

function rootDir(): Directory {
  return new Directory(Paths.document, ROOT);
}

function jobDir(id: string): Directory {
  return new Directory(Paths.document, ROOT, id);
}

/** True for a reference that is already a full address rather than a name in the job's folder. */
function isAbsolute(ref: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith("/");
}

/** The address of one of the job's files, for whoever needs to read it now. */
export function resolveJobFile(id: string, ref: string | null): string | null {
  if (!ref) return null;
  if (isAbsolute(ref) || !outboxOnDisk()) return ref;
  return new File(Paths.document, ROOT, id, ref).uri;
}

function ensureJobDir(id: string): Directory {
  const root = rootDir();
  if (!root.exists) root.create({ intermediates: true, idempotent: true });
  const dir = jobDir(id);
  if (!dir.exists) dir.create({ idempotent: true });
  return dir;
}

function extensionOf(uri: string, fallback: string): string {
  const ext = uri.split(/[?#]/)[0].split("/").pop()?.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
}

/**
 * Copy the draft's source into the job's folder and return its name there.
 *
 * The Darkroom deletes its developed copy as soon as compose closes, and
 * the picker's file lives in tmp, so the job takes its own copy before
 * the screen goes. On APFS a copy is a clone: no bytes are duplicated
 * until one side changes. A source that is not a local file (a browser
 * blob, a remote demo picture) is kept by its address instead.
 */
export function copySourceIntoJob(id: string, sourceUri: string, kind: "photo" | "video"): string {
  if (!outboxOnDisk() || !sourceUri.startsWith("file:")) return sourceUri;
  ensureJobDir(id);
  const name = `source.${extensionOf(sourceUri, kind === "video" ? "mov" : "jpg")}`;
  const target = new File(Paths.document, ROOT, id, name);
  if (target.exists) target.delete();
  new File(sourceUri).copy(target);
  return name;
}

/**
 * Bring a file a step produced (in the cache folder or tmp) into the job's
 * folder under `name`, and return the name. Moved where it can be, copied
 * where it cannot or where the caller still needs the original (`"copy"`);
 * anything that is not a local file is kept by address.
 */
export function adoptIntoJob(id: string, producedUri: string, name: string, mode: "move" | "copy" = "move"): string {
  if (!outboxOnDisk() || !producedUri.startsWith("file:")) return producedUri;
  ensureJobDir(id);
  const target = new File(Paths.document, ROOT, id, name);
  if (target.uri === new File(producedUri).uri) return name;
  if (target.exists) target.delete();
  const produced = new File(producedUri);
  if (mode === "copy") {
    produced.copy(target);
    return name;
  }
  try {
    produced.move(target);
  } catch {
    produced.copy(target);
    try {
      produced.delete();
    } catch {
      // Left in the cache folder, which iOS clears on its own.
    }
  }
  return name;
}

/** Delete one of the job's own files; a full address (not ours) is left alone. */
export function removeJobFile(id: string, ref: string | null): void {
  if (!ref || !outboxOnDisk() || isAbsolute(ref)) return;
  try {
    const f = new File(Paths.document, ROOT, id, ref);
    if (f.exists) f.delete();
  } catch {
    // Gone with the folder later.
  }
}

/** Size in bytes of a file by address, or 0 when it cannot be read. */
export function fileBytes(uri: string | null): number {
  if (!uri || !outboxOnDisk() || !uri.startsWith("file:")) return 0;
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

export function fileExists(uri: string | null): boolean {
  if (!uri) return false;
  if (!outboxOnDisk() || !uri.startsWith("file:")) return true;
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

/**
 * Write the job. File.write is not atomic, so a crash halfway through
 * would leave half a job: the new copy is written beside the old one
 * first, then swapped in. Whatever moment it stops at, one complete copy
 * is on disk, and `readJob` takes the newer of the two by `rev`.
 */
export function writeJob(job: OutboxJob): void {
  if (!outboxOnDisk()) return;
  ensureJobDir(job.id);
  const next = new File(Paths.document, ROOT, job.id, JOB_NEXT);
  if (next.exists) next.delete();
  next.create();
  next.write(JSON.stringify(job));
  const current = new File(Paths.document, ROOT, job.id, JOB);
  if (current.exists) current.delete();
  next.move(current);
}

function readOne(file: File): OutboxJob | null {
  try {
    return file.exists ? parseJob(JSON.parse(file.textSync())) : null;
  } catch {
    return null;
  }
}

export function readJob(id: string): OutboxJob | null {
  if (!outboxOnDisk() || !isSafeJobId(id)) return null;
  const a = readOne(new File(Paths.document, ROOT, id, JOB));
  const b = readOne(new File(Paths.document, ROOT, id, JOB_NEXT));
  if (a && b) return b.rev > a.rev ? b : a;
  return a ?? b;
}

/** The ids of every job folder on disk. */
export function listJobIds(): string[] {
  if (!outboxOnDisk()) return [];
  try {
    const root = rootDir();
    if (!root.exists) return [];
    return root
      .list()
      .filter((entry): entry is Directory => entry instanceof Directory)
      .map((dir) => dir.uri.replace(/\/+$/, "").split("/").pop() ?? "")
      .filter((name) => name.length > 0);
  } catch {
    return [];
  }
}

export function deleteJob(id: string): void {
  if (!outboxOnDisk() || !isSafeJobId(id)) return;
  try {
    const dir = jobDir(id);
    if (dir.exists) dir.delete();
  } catch {
    // Tried again at the next launch's sweep.
  }
}

/** Everything the outbox ever kept on this phone. */
export function deleteAllJobs(): void {
  if (!outboxOnDisk()) return;
  try {
    const root = rootDir();
    if (root.exists) root.delete();
  } catch {
    // Each folder on its own, then.
    for (const id of listJobIds()) deleteJob(id);
  }
}

const STEPS: readonly JobStep[] = ["prepare", "upload", "insert", "follow-up", "done"];

function str(v: unknown): v is string {
  return typeof v === "string";
}
function strOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function parseDraft(raw: unknown): PostDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const author = d.author as Record<string, unknown> | undefined;
  if (!isSafeJobId(d.id) || !str(d.userId) || (d.kind !== "photo" && d.kind !== "video") || !str(d.sourceUri)) return null;
  if (!author || !str(author.id) || !str(author.username)) return null;
  return {
    id: d.id,
    userId: d.userId,
    kind: d.kind,
    sourceUri: d.sourceUri,
    sourceWidth: numOrNull(d.sourceWidth),
    sourceHeight: numOrNull(d.sourceHeight),
    durationSeconds: numOrNull(d.durationSeconds),
    filterId: str(d.filterId) ? d.filterId : "none",
    filterBaked: d.filterBaked === true,
    bakeVideo: d.bakeVideo === true,
    showDateStamp: d.showDateStamp === true,
    caption: str(d.caption) ? d.caption : "",
    takenAt: strOrNull(d.takenAt),
    location: strOrNull(d.location),
    lat: numOrNull(d.lat),
    lng: numOrNull(d.lng),
    placeId: strOrNull(d.placeId),
    tagIds: Array.isArray(d.tagIds) ? d.tagIds.filter(str) : [],
    assetId: strOrNull(d.assetId),
    author: {
      id: author.id,
      username: author.username,
      full_name: strOrNull(author.full_name),
      avatar_url: strOrNull(author.avatar_url),
    },
  };
}

/** A job read back from disk, checked field by field: a file from another build is not trusted blindly. */
export function parseJob(raw: unknown): OutboxJob | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  if (j.v !== 1 || !isSafeJobId(j.id)) return null;
  const draft = parseDraft(j.draft);
  if (!draft || draft.id !== j.id) return null;
  if (!STEPS.includes(j.step as JobStep)) return null;
  const files = (j.files ?? {}) as Record<string, unknown>;
  const uploaded = (j.uploaded ?? {}) as Record<string, unknown>;
  const p = j.prepared as Record<string, unknown> | null | undefined;
  const failed = j.failed as Record<string, unknown> | null | undefined;
  return {
    v: 1,
    rev: numOrNull(j.rev) ?? 0,
    id: j.id,
    createdAt: numOrNull(j.createdAt) ?? Date.now(),
    draft,
    step: j.step as JobStep,
    files: { source: strOrNull(files.source), media: strOrNull(files.media), thumb: strOrNull(files.thumb) },
    prepared:
      p && typeof p === "object" && str(p.ext) && str(p.contentType)
        ? {
            width: numOrNull(p.width),
            height: numOrNull(p.height),
            duration: numOrNull(p.duration),
            baked: p.baked === true,
            ext: p.ext,
            contentType: p.contentType,
          }
        : null,
    uploaded: { media: uploaded.media === true, thumb: uploaded.thumb === true },
    insertTried: j.insertTried === true,
    failed: failed && str(failed.message) ? { message: failed.message, at: numOrNull(failed.at) ?? 0 } : null,
    finishedAt: numOrNull(j.finishedAt),
  };
}
