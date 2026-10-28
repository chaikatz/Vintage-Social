import { perfEnabled, perfStart, shortId } from "./perf";

/**
 * How long a clip takes to start, in development builds only.
 *
 * Home's clips start almost at once, and a member's profile took
 * noticeably longer to play the same kind of clip. The reasons (a player
 * made at the tap rather than ahead of time, a round trip before the
 * screen could draw, a crowd of other players starting with it) are worth
 * acting on only with numbers, so every clip that starts puts one in the
 * Metro log:
 *
 *   [perf] video.tap→firstFrame 640ms {"surface":"gallery","from":"tap","id":"3f2a91c0"}
 *
 * A span starts at the tap on a profile square, or, where there was no
 * tap (Home, or the next card down the gallery), when the card becomes the
 * one on screen. It ends when the clip is first seen playing. `from` says
 * which start it had, so Home's head start and a profile's cold start can
 * be compared with the same post on both. A card that leaves the screen
 * before its clip moves takes its span with it, and a tap that never
 * reached a playing clip is forgotten rather than counted against a later
 * one.
 *
 * Spans are keyed by the clip's media path, the one thing both ends know;
 * the path is never printed, only a shortened post id. Nothing here exists
 * in a release: `clipTiming` is null outside __DEV__, and every caller asks
 * it first.
 */

/** Where a clip is shown, for the log. */
export type ClipSurface = "feed" | "gallery" | "post";

/** Spans older than this belong to a tap nobody followed through. */
export const CLIP_SPAN_STALE_MS = 30_000;

const LABEL = "video.tap→firstFrame";

export interface ClipTimer {
  /** A profile square for a clip was tapped; `surface` is where it opens. */
  asked(post: { id: string; media_path: string; media_type: string }, surface: ClipSurface): void;
  /**
   * The card for `path` became the one on screen. A span waiting from a
   * tap for this surface carries on; otherwise a card that says where it
   * is starts its own. One that does not (the pending card) only ever
   * finishes a tap's.
   */
  shown(path: string, surface: ClipSurface | null, id: string | null): void;
  /** The card left the screen, or went, before its clip moved. */
  hidden(path: string): void;
  /** The clip at `path` is playing: the span ends here. Returns its length, or null when none was open. */
  moving(path: string): number | null;
}

interface Span {
  stop: (extra?: Record<string, unknown>) => number;
  at: number;
  surface: ClipSurface;
  from: "tap" | "active";
  id: string | null;
  /** Whether its card has come on screen; a tap's span waits until it has. */
  shown: boolean;
}

export function createClipTimer({
  start = perfStart,
  now = Date.now,
}: {
  start?: (label: string) => (extra?: Record<string, unknown>) => number;
  now?: () => number;
} = {}): ClipTimer {
  const open = new Map<string, Span>();
  const fresh = (span: Span) => now() - span.at <= CLIP_SPAN_STALE_MS;

  return {
    asked(post, surface) {
      if (post.media_type !== "video" || !post.media_path) return;
      open.set(post.media_path, { stop: start(LABEL), at: now(), surface, from: "tap", id: post.id, shown: false });
    },
    shown(path, surface, id) {
      const waiting = open.get(path);
      const adopt =
        waiting != null &&
        waiting.from === "tap" &&
        !waiting.shown &&
        fresh(waiting) &&
        (surface == null || waiting.surface === surface);
      if (adopt) {
        waiting.shown = true;
        return;
      }
      if (surface == null) return;
      open.set(path, { stop: start(LABEL), at: now(), surface, from: "active", id, shown: true });
    },
    hidden(path) {
      if (open.get(path)?.shown) open.delete(path);
    },
    moving(path) {
      const span = open.get(path);
      if (!span?.shown) return null;
      open.delete(path);
      if (!fresh(span)) return null;
      return span.stop({ surface: span.surface, from: span.from, ...(span.id ? { id: shortId(span.id) } : {}) });
    },
  };
}

/** The development build's timer; null in a release, so asking it costs nothing there. */
export const clipTiming: ClipTimer | null = perfEnabled() ? createClipTimer() : null;
