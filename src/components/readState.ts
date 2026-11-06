/**
 * What a screen draws where its rows would be, when it has none to draw.
 *
 * Three answers, and only one of them is "there is nothing here". A read
 * that failed before it brought anything back says it could not load,
 * with a way to try again (LoadFailed): the request's limit ran out, a
 * server stumbled, there was no signal. It used to fall through to the
 * empty state, because a failed read counts as fetched, and a member's
 * own profile said "No photographs yet". A read that has answered is
 * "empty" in the one sense asked here: with no rows to draw, the screen
 * may truly say there are none. A read still on its way is waiting: a
 * skeleton, or nothing.
 *
 * A read that fails again after it has answered keeps that answer on the
 * screen. Its rows stay where they are, rather than giving way to
 * "Couldn't load" because a re-read in the background went wrong.
 *
 * Failure is asked first. The first read made with no signal is marked
 * failed without counting as an answer (showOfflineFirstReadsAsFailed in
 * src/lib/queryClient.ts), so asking whether it had answered first would
 * leave it waiting for good.
 *
 * Several reads drawn as one (a profile's own photographs and the ones it
 * is tagged in) are failed when any of them failed, and empty only once
 * all of them have answered.
 */
export type ReadState = "failed" | "empty" | "waiting";

/** The little of a react-query result this reads. */
export interface ReadLike {
  isError: boolean;
  isFetched: boolean;
  data: unknown;
}

export function readState(...reads: ReadLike[]): ReadState {
  if (reads.some((read) => read.isError && read.data === undefined)) return "failed";
  return reads.every((read) => read.isFetched) ? "empty" : "waiting";
}
