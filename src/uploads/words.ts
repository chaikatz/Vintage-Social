import type { PendingState, PostDraft } from "./types";

/**
 * What the pending card says, kept apart from the card so it can be
 * tested and stays in one voice: plain, in the present tense, no
 * exclamation marks, typographer's punctuation.
 */

export function percent(progress: number | null | undefined): number | null {
  if (progress == null || !Number.isFinite(progress)) return null;
  return Math.round(Math.min(1, Math.max(0, progress)) * 100);
}

/** The one line under a pending post: what it is doing, and how far along. */
export function stateLine(state: PendingState, progress: number | null, kind: PostDraft["kind"]): string {
  const pct = percent(progress);
  const amount = pct == null ? "" : ` ${pct}%`;
  switch (state) {
    case "queued":
      // One post goes up at a time; this one has not started.
      return "Waiting its turn";
    case "preparing":
      return kind === "video" ? "Preparing the clip…" : "Preparing the photograph…";
    case "developing":
      return `Developing the clip…${amount}`;
    case "uploading":
      return `Uploading…${amount}`;
    case "saving":
      return "Saving…";
    case "waiting-network":
      return "Waiting for a connection";
    case "waiting-foreground":
      return "Will finish when VINTAGE is open";
    case "failed":
      return "Couldn’t post.";
    case "done":
      return "Posted";
  }
}

/**
 * How much of the whole post is done, for the progress rule: developing a
 * clip is most of the wait, the upload is most of a photograph's. The
 * rule only ever moves forward through a post, whatever step it is on.
 * Null for the states that are not moving (queued, waiting, failed).
 */
export function overallProgress(state: PendingState, progress: number | null, kind: PostDraft["kind"]): number | null {
  const p = progress == null || !Number.isFinite(progress) ? 0 : Math.min(1, Math.max(0, progress));
  const video = kind === "video";
  switch (state) {
    case "preparing":
      return video ? 0.02 : 0.05;
    case "developing":
      return 0.02 + p * 0.58;
    case "uploading":
      return video ? 0.6 + p * 0.36 : 0.1 + p * 0.85;
    case "saving":
      return video ? 0.97 : 0.96;
    case "done":
      return 1;
    default:
      return null;
  }
}

/** What VoiceOver reads for the card as a whole. */
export function accessibilityLine(state: PendingState, progress: number | null, kind: PostDraft["kind"]): string {
  const what = kind === "video" ? "Your clip" : "Your photograph";
  const pct = percent(progress);
  switch (state) {
    case "developing":
      return pct == null ? `${what}, developing` : `${what}, developing, ${pct} percent`;
    case "uploading":
      return pct == null ? `${what}, uploading` : `${what}, uploading, ${pct} percent`;
    case "failed":
      return `${what} couldn’t be posted`;
    case "done":
      return `${what} is posted`;
    default:
      return `${what}, ${stateLine(state, null, kind).replace(/…$/, "").toLowerCase()}`;
  }
}

/** Why a post gave up, for the line under "Couldn’t post." */
export type FailureReason = "develop" | "prepare" | "too-large" | "upload" | "save" | "unconfirmed" | "signed-out";

export function failureWords(reason: FailureReason, kind: PostDraft["kind"]): string {
  switch (reason) {
    case "develop":
      return "The clip wouldn’t develop.";
    case "prepare":
      return kind === "video" ? "The clip couldn’t be read." : "The photograph couldn’t be read.";
    case "too-large":
      // Developed again, the same clip comes out the same size, so the
      // useful advice is a shorter one rather than another go.
      return "The clip is too large to post. Try a shorter one.";
    case "upload":
      return kind === "video" ? "The clip didn’t upload." : "The photograph didn’t upload.";
    case "save":
      return "The post wasn’t saved.";
    case "unconfirmed":
      // The insert went out and no answer came back: it may well be up.
      return "It may have been saved. Retry to check.";
    case "signed-out":
      return "Sign in again to post this.";
  }
}
