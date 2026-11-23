import type { InfiniteData, QueryClient, QueryKey } from "@tanstack/react-query";
import type { Cursor } from "@/api/keyset";
import type { PostWithAuthor } from "@/types/db";
import { fetchSettled } from "@/uploads/feedCache";

/**
 * New photographs on Home, as they are posted.
 *
 * While Home is in front, it looks every so often at the newest few posts
 * the member can see (one small read: their ids, times and authors, see
 * fetchFeedHead in src/api/posts.ts). When someone they follow has posted
 * since the top of what Home holds, the newest page is read and either
 * put in place at once, for a member at the very top who is not touching
 * the list, or held behind a small "New posts" tag that takes the member
 * to the top and puts it there when tapped (src/hooks/useNewPosts.ts).
 *
 * The member's own posts are never announced: the outbox puts each one
 * on top of Home itself, once the server has it (src/uploads/feedCache.ts).
 *
 * Nothing here runs while Home is out of sight, the app is in the
 * background or the phone has no signal: the look waits for all three.
 */

/** How often Home looks, while it is in front. */
export const NEW_POSTS_EVERY_MS = 45_000;

/**
 * How many of the newest posts one look reads: a few, and more than a
 * member is likely to post in a row. The member's own posts are never
 * new, so a look filled with them would not see a friend's post just
 * under them; eight rows of three columns (fetchFeedHead) is still one
 * small read.
 */
export const FEED_HEAD_SIZE = 8;

/**
 * A held newest page older than this is read again before it is put in
 * place: the tag may have been waiting a while.
 */
export const FRESH_PAGE_KEEP_MS = 60_000;

/** How far down, in points, a list still counts as at its very top. */
export const AT_TOP_PX = 4;

/**
 * How long a finger on the list counts as still there without word of its
 * lifting. The end of a touch can go unheard (the view it began on let go
 * of under it); past this it is taken to have ended, so a lost one cannot
 * keep new posts from going in place for good. Long, as a finger resting
 * on a card or a pinch held on a photograph can be: at worst a look
 * meanwhile shows the "New posts" tag instead.
 */
export const TOUCH_FORGOTTEN_MS = 10_000;

/**
 * Where Home's list is, and whether anything is moving it or resting on
 * it, written down from the list's own events and never drawn: new posts
 * go in without a word only at the very top, with the list still and no
 * finger on it (src/hooks/useNewPosts.ts).
 *
 * A drag lasts from its start until the finger lifts. A glide lasts from
 * its start until it ends, and is over too at a new drag, or at a drag let
 * go without speed: a glide stopped by a finger need not say it ended. A
 * touch that scrolls nothing (a tap, a long press, a pinch on a
 * photograph, a finger resting on a card) lasts from the first finger down
 * until the last one lifts, a drag ends, or TOUCH_FORGOTTEN_MS has passed.
 */
export interface ListAtTop {
  scrolled(y: number): void;
  dragBegan(): void;
  dragEnded(y: number, velocityY?: number): void;
  glideBegan(): void;
  glideEnded(y: number): void;
  touchBegan(now: number): void;
  /** A finger lifted or the touch was called off, `fingersLeft` still down. */
  touchEnded(fingersLeft: number): void;
  /** At the very top, still, and untouched, as of `now`. */
  atTop(now: number): boolean;
}

export function listAtTop(): ListAtTop {
  let y = 0;
  let dragging = false;
  let gliding = false;
  let touchedAt: number | null = null;
  return {
    scrolled(at) {
      y = at;
    },
    dragBegan() {
      dragging = true;
      gliding = false;
    },
    dragEnded(at, velocityY) {
      dragging = false;
      touchedAt = null;
      y = at;
      if (!velocityY) gliding = false;
    },
    glideBegan() {
      gliding = true;
    },
    glideEnded(at) {
      gliding = false;
      y = at;
    },
    touchBegan(now) {
      touchedAt = now;
    },
    touchEnded(fingersLeft) {
      if (!(fingersLeft > 0)) touchedAt = null;
    },
    atTop(now) {
      const touching = touchedAt !== null && now - touchedAt < TOUCH_FORGOTTEN_MS;
      return y <= AT_TOP_PX && !dragging && !gliding && !touching;
    },
  };
}

/** A post as a look sees it: enough to tell whether it is new, and whose it is. */
export type HeadRow = { id: string; created_at: string; author_id: string };

/**
 * How long until the next look: the interval after the later of the last
 * look and the last time the feed itself was read (a refresh is as good
 * as a look), and at once when that is already past. So a return to Home,
 * or to the app, after a while looks straight away, and a return after a
 * moment waits out the rest of the interval.
 */
export function nextLookIn(lastLookAt: number, feedReadAt: number, now: number, everyMs = NEW_POSTS_EVERY_MS): number {
  const last = Math.max(lastLookAt > 0 ? lastLookAt : 0, feedReadAt > 0 ? feedReadAt : 0);
  if (last <= 0) return 0;
  return Math.max(0, Math.min(everyMs, last + everyMs - now));
}

/**
 * Whether post `a` is newer than post `b` in the feed's own order: by
 * time, then by id. Times are compared as instants first, so a time
 * written by this phone (a post of the member's own, put in by hand) and
 * one written by the server compare rightly; two in the same millisecond
 * fall back to the server's own strings, which keep the microseconds.
 */
export function newerThan(a: Pick<HeadRow, "id" | "created_at">, b: Pick<HeadRow, "id" | "created_at">): boolean {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta > tb;
  if (a.created_at !== b.created_at) return a.created_at > b.created_at;
  return a.id > b.id;
}

/**
 * The posts of a look that are new to the member: someone else's, not
 * already in what Home holds, and newer than the newest post of someone
 * else's that it holds. `held` is the feed as Home shows it, newest first.
 *
 * Older posts that turn up (a member followed since, whose photographs
 * now belong to the feed) are left to the next refresh: they are not new.
 */
export function newerThanHeld<T extends HeadRow>(head: readonly T[], held: readonly HeadRow[], me: string): T[] {
  if (head.length === 0) return [];
  const heldIds = new Set(held.map((p) => p.id));
  const top = held.find((p) => p.author_id !== me);
  return head.filter((p) => p.author_id !== me && !heldIds.has(p.id) && (!top || newerThan(p, top)));
}

/**
 * The feed's pages with a newly read first page put in.
 *
 * The new page is the feed as it is now, from its newest post down. The
 * two meet at the deepest post they have in common: everything held down
 * to it is what the new page stands for, and the new page takes its
 * place, its new posts, its counts as they are now, and without a post
 * held there that it no longer has (deleted, reported or hidden since).
 * Below that post the pages held stay as they are, so a member who had
 * scrolled down keeps every page and nothing is read again. Nothing held
 * below the meeting post is on the new page (it is the deepest they
 * share), so no post is ever there twice.
 *
 * Where the two have nothing in common (more new posts than a page, or
 * nothing left of what was held), there is a gap between them, and the
 * feed starts again from the new page alone, as a refresh does. And a
 * new page shorter than a page is the whole feed, so it is all there is.
 *
 * The pages after the one they meet in keep their own cursors, and the
 * last page is the one it was, so the next page is still read after the
 * last post held (src/api/posts.ts, nextFeedCursor).
 */
export function mergeFreshFirstPage(
  data: InfiniteData<PostWithAuthor[], Cursor | null> | undefined,
  fresh: PostWithAuthor[],
  pageSize: number,
): InfiniteData<PostWithAuthor[], Cursor | null> {
  const alone: InfiniteData<PostWithAuthor[], Cursor | null> = { pages: [fresh], pageParams: [null] };
  if (!data || !Array.isArray(data.pages) || data.pages.length === 0) return alone;
  if (fresh.length < pageSize) return alone;
  const freshIds = new Set(fresh.map((p) => p.id));
  let meetPage = -1;
  let meetRow = -1;
  data.pages.forEach((page, i) =>
    page.forEach((p, j) => {
      if (freshIds.has(p.id)) {
        meetPage = i;
        meetRow = j;
      }
    }),
  );
  if (meetPage < 0) return alone;
  return {
    pages: [[...fresh, ...data.pages[meetPage].slice(meetRow + 1)], ...data.pages.slice(meetPage + 1)],
    pageParams: [null, ...data.pageParams.slice(meetPage + 1)],
  };
}

/** What became of a newly read first page handed to the feed. */
export type FreshPlaced = "placed" | "stale" | "gone" | "moved";

/**
 * Put a newly read first page into the feed's cache, merged with what it
 * holds (mergeFreshFirstPage).
 *
 * A read of the feed already out (the next page, a pull to refresh) would
 * write over the merge when it lands, from the pages as they were when it
 * left, so it is waited for first. And the page is put in only when
 * nothing has changed the feed since it was read (`readAt`): a post
 * deleted, reported or posted here meanwhile, a refresh that landed, each
 * write the feed anew, and a page read before them would undo them. Then
 * it is "stale" and the caller reads it again. "gone": the feed is no
 * longer held (signed out). "moved": `stillWanted`, asked once any wait
 * is over and just before the page is written, said no (the member left
 * the top meanwhile), and nothing is written.
 */
export async function placeFreshFirstPage(
  client: QueryClient,
  key: QueryKey,
  fresh: PostWithAuthor[],
  readAt: number,
  pageSize: number,
  stillWanted: () => boolean = () => true,
): Promise<FreshPlaced> {
  const alive = await fetchSettled(client, key);
  if (!alive) return "gone";
  const state = client.getQueryState<InfiniteData<PostWithAuthor[], Cursor | null>>(key);
  if (!state || state.data === undefined) return "gone";
  if (state.dataUpdatedAt > readAt) return "stale";
  if (!stillWanted()) return "moved";
  client.setQueryData<InfiniteData<PostWithAuthor[], Cursor | null>>(key, (data) => mergeFreshFirstPage(data, fresh, pageSize));
  return "placed";
}

/**
 * The timing of the looks, apart from React: one timer at most, set only
 * while `watching` (Home in front, the app in front, a signal, a feed
 * loaded), and one look out at a time. `look` does the reading; a look
 * that fails is let go, and the next comes after the interval as usual.
 */
export interface NewPostsWatch {
  /** Start or stop looking. Starting looks at once when the last look is old enough. */
  watch(on: boolean): void;
  /** Stop for good: no timer, and a look still out finds nothing to schedule. */
  stop(): void;
}

export function newPostsWatch({
  look,
  feedReadAt,
  now = Date.now,
  everyMs = NEW_POSTS_EVERY_MS,
}: {
  look: () => Promise<void>;
  /** When the feed itself was last read, or 0. */
  feedReadAt: () => number;
  now?: () => number;
  everyMs?: number;
}): NewPostsWatch {
  let watching = false;
  let stopped = false;
  let busy = false;
  let lastLookAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const schedule = () => {
    clear();
    if (!watching || stopped || busy) return;
    timer = setTimeout(run, nextLookIn(lastLookAt, feedReadAt(), now(), everyMs));
  };
  const run = () => {
    timer = undefined;
    if (!watching || stopped || busy) return;
    busy = true;
    lastLookAt = now();
    let done: Promise<void>;
    try {
      done = Promise.resolve(look());
    } catch {
      done = Promise.resolve();
    }
    void done
      .catch(() => undefined)
      .then(() => {
        busy = false;
        schedule();
      });
  };

  return {
    watch(on) {
      if (stopped || on === watching) return;
      watching = on;
      if (on) schedule();
      else clear();
    },
    stop() {
      stopped = true;
      watching = false;
      clear();
    },
  };
}
