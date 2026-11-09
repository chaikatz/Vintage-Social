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

/** "june", "june and tomas", "june, tomas and ansel". */
function namesInWords(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * What is said when the post went up but tags did not all go on.
 *
 * `refused`: the members the database would not let be tagged (no longer
 * a member, or a block between the two since the post was composed); the
 * others are on the post, and those are named, by the names chosen in
 * compose where the draft has them. Null `refused`: the tags could not be
 * sent at all. Nothing is promised that the app cannot do: a post's tags
 * cannot be changed once it is up.
 */
export function tagFailureWords(
  draft: Pick<PostDraft, "kind" | "tagIds" | "tagNames">,
  refused: readonly string[] | null,
): { title: string; body: string } {
  const what = draft.kind === "video" ? "The clip" : "The photograph";
  if (!refused) return { title: "Posted, but the tags didn’t take", body: `${what} is up, but its tags may not all be on it.` };
  const named = refused.map((id) => draft.tagNames?.[id]).filter((name): name is string => Boolean(name));
  const unnamed = refused.length - named.length;
  const who =
    named.length === 0
      ? unnamed === 1
        ? "One member you tagged"
        : `${unnamed} members you tagged`
      : namesInWords(unnamed === 0 ? named : [...named, unnamed === 1 ? "one other member" : `${unnamed} other members`]);
  const tagged = new Set(draft.tagIds).size;
  return refused.length >= tagged
    ? { title: "Posted, but the tags didn’t take", body: `${what} is up. ${who} couldn’t be tagged.` }
    : { title: "Posted, but not every tag took", body: `${what} is up with your other tags. ${who} couldn’t be tagged.` };
}
