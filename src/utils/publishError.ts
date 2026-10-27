/**
 * Publishing runs through several steps that can each fail in their own
 * way, and Supabase's own message is frequently the same regardless of
 * which one did: "new row violates row-level security policy" is what you
 * get from a refused storage upload and from a refused posts insert alike.
 * That sent us looking at the wrong table once already.
 *
 * So every step is named, and the name travels with the error: the pending
 * post on Home says which step failed, and the development log carries the
 * step, the Supabase status/code, and the original error.
 */

export type PublishStep =
  | "render"
  | "poster-frame"
  | "resize"
  | "media-upload"
  | "thumbnail-upload"
  | "post-insert";

/** What is being posted, so a step can be named in the member's own terms. */
export type PublishMedia = "photo" | "video";

/**
 * Each step as a member would say it. A clip is not a photograph, so a clip
 * that failed to go up is named as a clip, and its thumbnail as the poster
 * frame it is. Steps that are the same for both read the same.
 */
const STEP_LABELS: Record<PublishStep, Record<PublishMedia, string>> = {
  render: { photo: "baking the filter", video: "developing the clip" },
  "poster-frame": { photo: "making the poster frame", video: "making the poster frame" },
  resize: { photo: "resizing the photograph", video: "resizing the poster frame" },
  "media-upload": { photo: "uploading the photograph", video: "uploading the clip" },
  "thumbnail-upload": { photo: "uploading the thumbnail", video: "uploading the poster frame" },
  "post-insert": { photo: "saving the post", video: "saving the post" },
};

/** A step's name for the member, for a photograph unless told it is a clip. */
export function stepLabel(step: PublishStep, media: PublishMedia = "photo"): string {
  return STEP_LABELS[step][media];
}

/** The bits of a Supabase error worth showing. Both PostgrestError and
 * StorageError are plain objects, so this reads them defensively. */
export function errorDetail(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const parts = [
    e.statusCode != null ? `status ${String(e.statusCode)}` : null,
    typeof e.code === "string" && e.code ? `code ${e.code}` : null,
    typeof e.hint === "string" && e.hint ? `hint: ${e.hint}` : null,
  ].filter(Boolean);
  const message =
    typeof e.message === "string" && e.message ? e.message : String(err);
  return parts.length > 0 ? `${message} (${parts.join(", ")})` : message;
}

export class PublishStepError extends Error {
  constructor(
    readonly step: PublishStep,
    readonly cause: unknown,
    readonly media: PublishMedia = "photo",
  ) {
    super(`Failed while ${stepLabel(step, media)}: ${errorDetail(cause)}`);
    this.name = "PublishStepError";
  }
}

/**
 * Run one step of publishing, tagging anything it throws with the step's
 * name. In development the failure is also logged with its step before it
 * is re-thrown, so the console says where it happened without needing the
 * alert text. `media` only changes the words: a clip's upload is named as
 * a clip's.
 */
export async function publishStep<T>(
  step: PublishStep,
  fn: () => Promise<T>,
  media: PublishMedia = "photo",
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // __DEV__ is a React Native global and is absent under plain node.
    if (typeof __DEV__ === "undefined" || __DEV__) {
      console.error(`[publish] step "${step}" (${media}) failed:`, errorDetail(err), err);
    }
    throw new PublishStepError(step, err, media);
  }
}

/**
 * The words for a post that did not go up: the step that failed, in the
 * member's terms, and Supabase's own detail. The pending card on Home
 * shows it under "Couldn’t post"; compose no longer publishes, so it is
 * never the text of an alert there.
 */
export function describePublishFailure(err: unknown): string {
  if (err instanceof PublishStepError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
