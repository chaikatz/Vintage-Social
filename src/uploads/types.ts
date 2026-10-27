/**
 * The shapes the post outbox works in.
 *
 * `PostDraft` is what compose hands over when Share is tapped: every
 * choice frozen, and the id minted once for the whole compose session, so
 * that every step after it (two uploads keyed by the id, one insert keyed
 * by the id) can be repeated safely. `PendingPost` is what Home draws.
 * `OutboxJob` is what is written to disk after every step, so a post can
 * pick up where it stopped after the app is closed.
 */

export interface PostDraft {
  id: string; // client UUID, minted ONCE per compose session
  userId: string;
  kind: "photo" | "video";
  /** Photo: the baked JPEG (filterBaked true) or the unbaked source. Video: the clip as picked. */
  sourceUri: string;
  sourceWidth: number | null;
  sourceHeight: number | null;
  durationSeconds: number | null; // video
  filterId: string;
  filterBaked: boolean; // photo: the pixels already carry the film (true also for None)
  bakeVideo: boolean; // video: run the native bake in the job (canBakeVideo() && !demo)
  showDateStamp: boolean;
  caption: string;
  takenAt: string | null;
  location: string | null;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  tagIds: string[];
  assetId: string | null; // Darkroom: markDeveloped(assetId) once the server confirms
  author: { id: string; username: string; full_name: string | null; avatar_url: string | null }; // for the pending card
}

export type PendingState =
  | "queued"
  | "preparing"
  | "developing"
  | "uploading"
  | "saving"
  | "waiting-network"
  | "waiting-foreground"
  | "failed"
  | "done";

export interface PendingPost {
  id: string;
  draft: PostDraft;
  state: PendingState;
  progress: number | null;
  error: string | null;
  previewUri: string;
  createdAt: number;
  /**
   * Additions to the shared contract, for the pending card only. The
   * poster frame or grid thumbnail once the job has made it, and whether
   * `previewUri` already carries the film (an unbaked one is drawn with the
   * play-time overlay, the way an unbaked post is).
   */
  previewThumbUri: string | null;
  previewBaked: boolean;
  /**
   * Whether Discard may be offered: true while nothing can have been
   * published yet (the insert has never been sent and the job is still
   * preparing or uploading), and whenever the post has failed. Once the
   * insert has gone out the post may exist, and `discardPost` asks the
   * server before it removes anything.
   */
  canDiscard: boolean;
}

/** Where a job has got to. Each is written to disk once it is reached. */
export type JobStep = "prepare" | "upload" | "insert" | "follow-up" | "done";

export interface PreparedMedia {
  width: number | null;
  height: number | null;
  /** Seconds, already held to the database's 1 to 60. Video only. */
  duration: number | null;
  /** Whether the uploaded media carries the film in its pixels (`filter_baked`). */
  baked: boolean;
  ext: string;
  contentType: string;
}

export interface OutboxJob {
  v: 1;
  /** Bumped on every write; when a crash leaves two copies, the higher one is the newer. */
  rev: number;
  id: string;
  createdAt: number;
  draft: PostDraft;
  step: JobStep;
  /**
   * The job's files: a bare name is a file in the job's own folder, which
   * is resolved again at every launch because iOS may move the app's
   * container between versions. Anything with a scheme (a browser blob, a
   * source that could not be copied) is kept as it is.
   */
  files: { source: string | null; media: string | null; thumb: string | null };
  prepared: PreparedMedia | null;
  uploaded: { media: boolean; thumb: boolean };
  /** An insert was sent at least once, so the post may exist even if no reply came. */
  insertTried: boolean;
  /** Set when the job gave up, so a relaunch shows Retry and Discard rather than trying forever. */
  failed: { message: string; at: number } | null;
  finishedAt: number | null;
}
