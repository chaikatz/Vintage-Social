/**
 * Publishing runs through several steps that can each fail in their own
 * way, and Supabase's own message is frequently the same regardless of
 * which one did: "new row violates row-level security policy" is what you
 * get from a refused storage upload and from a refused posts insert alike.
 * That sent us looking at the wrong table once already.
 *
 * So every step is named, and the name travels with the error: the alert
 * says which step failed, and the development log carries the step, the
 * Supabase status/code, and the original error.
 */

export type PublishStep =
  | "render"
  | "poster-frame"
  | "resize"
  | "media-upload"
  | "thumbnail-upload"
  | "post-insert";

const STEP_LABELS: Record<PublishStep, string> = {
  render: "baking the filter",
  "poster-frame": "making the poster frame",
  resize: "resizing the photograph",
  "media-upload": "uploading the photograph",
  "thumbnail-upload": "uploading the thumbnail",
  "post-insert": "saving the post",
};

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
  ) {
    super(`Failed while ${STEP_LABELS[step]}: ${errorDetail(cause)}`);
    this.name = "PublishStepError";
  }
}

/**
 * Run one step of publishing, tagging anything it throws with the step's
 * name. In development the failure is also logged with its step before it
 * is re-thrown, so the console says where it happened without needing the
 * alert text.
 */
export async function publishStep<T>(
  step: PublishStep,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    // __DEV__ is a React Native global and is absent under plain node.
    if (typeof __DEV__ === "undefined" || __DEV__) {
      console.error(`[publish] step "${step}" failed:`, errorDetail(err), err);
    }
    throw new PublishStepError(step, err);
  }
}

/** What to put in the "Couldn't publish" alert. */
export function describePublishFailure(err: unknown): string {
  if (err instanceof PublishStepError) return err.message;
  return err instanceof Error ? err.message : String(err);
}
