import type { PendingPost, PendingState, PostDraft } from "@/uploads/types";
import { accessibilityLine, percent, stateLine } from "@/uploads/words";

/**
 * What the pending card offers, and what it tells VoiceOver, kept apart
 * from the card so it can be tested without a phone. The words themselves
 * are the outbox's (`@/uploads/words`); this only decides which of them
 * are said, and when.
 */

/**
 * Discard is offered for as long as nothing of the post can have been
 * published, and again once it has failed. A post shared offline, or the
 * wrong photograph, would otherwise wait for the connection and then
 * notify every follower, with nothing on the card to stop it. Once the
 * insert has been tried the row may exist, and the outbox says so by
 * turning `canDiscard` off.
 */
export function offersDiscard(pending: Pick<PendingPost, "state" | "canDiscard">): boolean {
  return pending.state === "failed" || pending.canDiscard === true;
}

/** Retry only follows a failure; anything else is already on its way, or waiting for its turn. */
export function offersRetry(pending: Pick<PendingPost, "state">): boolean {
  return pending.state === "failed";
}

/**
 * Whether a pending clip may play its picture. Not while it is being
 * prepared or developed, and not while it waits behind another post,
 * which may be developing a clip of its own: the bake needs the phone's
 * video decoder more than the card does. Nor once it has failed.
 */
export function clipMayPlay(state: PendingState): boolean {
  return state !== "preparing" && state !== "developing" && state !== "queued" && state !== "failed";
}

export interface StatusAccessibility {
  role: "progressbar" | "text";
  label: string;
  value?: { min: number; max: number; now: number };
}

/**
 * The state line as VoiceOver and TalkBack read it.
 *
 * The percent is said once, as the progress bar's value. The label leaves
 * it out: with it in both, iOS read "uploading, 62 percent, 62%". A post
 * that has failed or gone up is no longer in progress, so it is read as
 * plain text rather than as a bar that has stopped.
 */
export function statusAccessibility(
  state: PendingState,
  progress: number | null,
  kind: PostDraft["kind"],
): StatusAccessibility {
  const moving = state !== "failed" && state !== "done";
  const pct = moving ? percent(progress) : null;
  return {
    role: moving ? "progressbar" : "text",
    label: accessibilityLine(state, null, kind),
    value: pct == null ? undefined : { min: 0, max: 100, now: pct },
  };
}

/**
 * What is said aloud when the state changes, or null for nothing.
 *
 * An announcement interrupts whatever VoiceOver is reading, and Home stays
 * mounted under the other tabs and under every screen pushed over it. So
 * only a real change is said, and only while Home is the screen in front:
 * a member reading their messages is not cut off by "Uploading…".
 */
export function announcement(
  previous: PendingState,
  next: PendingState,
  kind: PostDraft["kind"],
  focused: boolean,
): string | null {
  if (previous === next || !focused) return null;
  return stateLine(next, null, kind);
}
