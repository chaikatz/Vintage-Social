import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { focusManager, onlineManager, useQueryClient } from "@tanstack/react-query";
import { FEED_PAGE_SIZE, fetchFeedHead, fetchFeedPage } from "@/api/posts";
import {
  FEED_HEAD_SIZE,
  FRESH_PAGE_KEEP_MS,
  newPostsWatch,
  newerThanHeld,
  placeFreshFirstPage,
  type NewPostsWatch,
} from "@/media/newPosts";
import { prefetchNewPosts } from "@/media/prefetch";
import { onHomeAgain } from "@/utils/homeRefresh";
import type { PostWithAuthor } from "@/types/db";

/** A newest page read and not yet put in: whose feed, its posts, and when it was asked for. */
type FreshPage = { userId: string; rows: PostWithAuthor[]; readAt: number };

/** How long the list is given to get back to the top before the new posts go in above it. */
export const NEW_POSTS_SETTLE_MS = 400;

/**
 * Home's new posts, as they are posted (see src/media/newPosts.ts).
 *
 * While Home is in front, the app is in front, the phone has a signal and
 * the feed has loaded, it looks every so often for posts newer than the
 * top of the feed. A member at the very top and not touching the list
 * gets them in place; anyone else gets `waiting`, for the "New posts" tag,
 * and `showNew` puts them in once the list is back at the top.
 *
 * A look never runs while a read of the feed is already out (a refresh
 * brings what is new itself), and never announces the member's own posts.
 */
export function useNewPosts({
  userId,
  posts,
  focused,
  hasFeed,
  atTop,
  toTop,
}: {
  userId: string;
  /** The feed as Home shows it, newest first. */
  posts: PostWithAuthor[];
  /** Whether Home is the screen in front. */
  focused: boolean;
  /** Whether the feed has loaded at all. */
  hasFeed: boolean;
  /** Whether the list is at its very top with no finger on it, as it is now. */
  atTop: () => boolean;
  /** Take the list to its top. */
  toTop: () => void;
}): { waiting: boolean; showNew: () => void } {
  const queryClient = useQueryClient();

  // The app in front, and a signal: as react-query hears them
  // (src/lib/queryClient.ts), so "in front" is iOS's active, not inactive.
  const [appFront, setAppFront] = useState(() => focusManager.isFocused());
  const [online, setOnline] = useState(() => onlineManager.isOnline());
  useEffect(() => focusManager.subscribe((isFocused) => setAppFront(isFocused)), []);
  useEffect(() => onlineManager.subscribe((isOnline) => setOnline(isOnline)), []);

  const [fresh, setFresh] = useState<FreshPage | null>(null);
  const freshRef = useRef(fresh);
  freshRef.current = fresh;
  const postsRef = useRef(posts);
  postsRef.current = posts;
  const userRef = useRef(userId);
  userRef.current = userId;
  const atTopRef = useRef(atTop);
  atTopRef.current = atTop;

  const look = useCallback(async () => {
    const me = userRef.current;
    if (!me) return;
    const key = ["feed", me];
    // A read of the feed already out brings the newest posts itself.
    if (queryClient.getQueryState(key)?.fetchStatus !== "idle") return;
    const head = await fetchFeedHead(me, FEED_HEAD_SIZE);
    const newer = newerThanHeld(head, postsRef.current, me);
    if (newer.length === 0 || userRef.current !== me) return;
    const kept = freshRef.current;
    const keptCovers = kept != null && kept.userId === me && newer.every((p) => kept.rows.some((r) => r.id === p.id));
    // The tag is up for these already, and the member is not at the top:
    // nothing more to read until they tap it (which reads it again if it
    // has been held a while) or reach the top.
    if (keptCovers && !atTopRef.current()) return;
    const readAt = Date.now();
    const rows = await fetchFeedPage(me, null);
    if (userRef.current !== me) return;
    if (atTopRef.current()) {
      const placed = await placeFreshFirstPage(queryClient, key, rows, readAt, FEED_PAGE_SIZE);
      if (placed !== "stale") {
        setFresh(null);
        return;
      }
    }
    setFresh({ userId: me, rows, readAt });
    prefetchNewPosts(newerThanHeld(rows, postsRef.current, me));
  }, [queryClient]);

  const lookRef = useRef(look);
  lookRef.current = look;
  const watching = Boolean(userId) && focused && appFront && online && hasFeed;
  const watchingRef = useRef(watching);
  watchingRef.current = watching;
  // Made with the screen and stopped with it: no timer outlives Home.
  const watchRef = useRef<NewPostsWatch | null>(null);
  useEffect(() => {
    const watch = newPostsWatch({
      look: () => lookRef.current(),
      feedReadAt: () => queryClient.getQueryState(["feed", userRef.current])?.dataUpdatedAt ?? 0,
    });
    watchRef.current = watch;
    watch.watch(watchingRef.current);
    return () => {
      watch.stop();
      if (watchRef.current === watch) watchRef.current = null;
    };
  }, [queryClient]);
  useEffect(() => {
    watchRef.current?.watch(watching);
  }, [watching]);

  // Whether a page held brings posts Home does not show yet: what the tag
  // stands for. A refresh, or the outbox, that brings them takes it away.
  const waiting = useMemo(
    () => fresh != null && fresh.userId === userId && newerThanHeld(fresh.rows, posts, userId).length > 0,
    [fresh, posts, userId],
  );
  useEffect(() => {
    if (fresh != null && !waiting) setFresh(null);
  }, [fresh, waiting]);

  // Home tapped again reads the newest page itself (Home's own handler).
  useEffect(() => onHomeAgain(() => setFresh(null)), []);

  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(settle.current), []);

  const showNew = useCallback(() => {
    const me = userRef.current;
    const kept = freshRef.current;
    setFresh(null);
    toTop();
    if (!me) return;
    const key = ["feed", me];
    const put = async () => {
      // The page held, while it is new enough; read again otherwise, and
      // once more if the feed changed while it was being read.
      let page = kept && kept.userId === me && Date.now() - kept.readAt < FRESH_PAGE_KEEP_MS ? kept : null;
      for (let tries = 0; tries < 2; tries++) {
        if (!page) {
          const readAt = Date.now();
          const rows = await fetchFeedPage(me, null).catch(() => null);
          if (!rows || userRef.current !== me) return;
          page = { userId: me, rows, readAt };
        }
        const placed = await placeFreshFirstPage(queryClient, key, page.rows, page.readAt, FEED_PAGE_SIZE);
        if (placed !== "stale") return;
        page = null;
      }
    };
    clearTimeout(settle.current);
    settle.current = setTimeout(() => void put().catch(() => undefined), NEW_POSTS_SETTLE_MS);
  }, [queryClient, toTop]);

  return { waiting: waiting && focused, showNew };
}
