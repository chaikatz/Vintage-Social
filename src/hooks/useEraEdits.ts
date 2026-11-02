import { useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ERA_SAVE_FAILED, changeEraEdits, eraEditsKey, eraEditsQuery, type EraEditsState } from "@/api/eraEdits";
import { userPostsCutShort } from "@/api/posts";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { addToEra, createEra, deleteEra, moveToEra, renameEra, sameEdits, takeOut, type EraEdits } from "@/utils/eraEdits";
import { newEraKey } from "@/utils/newEraKey";
import type { PostRow } from "@/types/db";

/**
 * A member's arrangement of their eras, read for whoever is drawing them:
 * their own profile, a member's, the gallery an era opens, On this day.
 * One cache entry per member, so a change shows on every one of them at
 * once. `enabled` is false where the photographs are not to be read (a
 * locked page).
 */
export function useEraEdits(authorId: string | undefined, enabled = true) {
  return useQuery({
    ...eraEditsQuery(authorId ?? ""),
    enabled: Boolean(authorId) && enabled,
  });
}

/**
 * What the Eras view may change, on the member's own page only. Each is
 * one change, saved once, and each but rename says whether it changed the
 * eras on the page, so only a real change is said aloud.
 */
export interface EraEditor {
  /** The member's name for the era of `key`; null, or nothing, gives it back its automatic name (an era they made keeps its own). */
  rename: (key: string, title: string | null) => void;
  /**
   * The photograph moved into the era of `key`. True when that changes the
   * eras on the page; false when there was nothing to move (the photograph
   * has gone, or that era cannot take it), so only a real move is said.
   */
  move: (post: PostRow, key: string) => boolean;
  /**
   * The photographs of `photoIds` added to the era of `key`, from no era or
   * from another (addToEra). True when any of them moved.
   */
  add: (key: string, photoIds: string[]) => boolean;
  /**
   * A new era of the member's own, named `name`, holding the photographs of
   * `photoIds` (createEra): its key, or null when nothing was made (no name
   * left once cleaned, or none of the photographs among theirs).
   */
  create: (name: string, photoIds: string[]) => string | null;
  /**
   * The photograph taken out of the era a move put it in, back where the
   * automatic reading puts it, which may be no era (takeOut). True when a
   * move had put it there.
   */
  takeOut: (post: PostRow) => boolean;
  /**
   * An era the member made, gone, and its photographs back where the
   * automatic reading puts them (deleteEra). True when there was one.
   */
  deleteEra: (key: string) => boolean;
}

/**
 * The means to change the member's own arrangement, over their
 * photographs (`posts`, as read). A change shows at once
 * (changeEraEdits); one that does not save is taken back and the member
 * is told, in words of ours. Each change lets go of what no longer
 * applies to the photographs (renameEra, addToEra and the rest), once
 * they are known to be all of them (whole). A new
 * era's key is drawn by `makeKey`, the phone's secure random source
 * unless the tests give another.
 */
export function eraEditor(
  queryClient: QueryClient,
  userId: string,
  posts: PostRow[],
  makeKey: () => string = newEraKey,
): EraEditor {
  const arrange = (change: Parameters<typeof changeEraEdits>[2]) =>
    changeEraEdits(queryClient, userId, change).catch((err) =>
      showAlert(ERA_SAVE_FAILED.title, errorMessage(err, ERA_SAVE_FAILED.body)),
    );
  /** Whether `change` changes what the page shows now, the member's latest change among it; made only if it does. */
  const changes = (change: (e: EraEdits) => EraEdits): boolean => {
    const shown = queryClient.getQueryData<EraEditsState>(eraEditsKey(userId));
    if (!shown?.ready || sameEdits(change(shown.edits), shown.edits)) return false;
    void arrange(change);
    return true;
  };
  /**
   * Whether `posts` is all of the member's photographs, so a change may
   * let go of what no longer applies (pruned): their last read was not
   * cut short (userPostsCutShort), and the list is still that read's. One
   * changed on this phone since, by a delete or a new post, waits to be
   * read again, and until it is, it may be the list of a read before the
   * last. Asked once as each change is made: the change may be made again
   * over a newer arrangement (changeEraEdits), and lets go of the same
   * each time. Not whole, nothing is let go, until a later change.
   */
  const whole = () =>
    !userPostsCutShort(userId) && queryClient.getQueryState(["user-posts", userId])?.isInvalidated !== true;
  return {
    rename: (key, title) => {
      const all = whole();
      void arrange((e) => renameEra(e, key, title, posts, all));
    },
    move: (post, key) => {
      const all = whole();
      return changes((e) => moveToEra(e, posts, post.id, key, all));
    },
    add: (key, photoIds) => {
      const all = whole();
      return changes((e) => addToEra(e, posts, key, photoIds, all));
    },
    create: (name, photoIds) => {
      // Drawn once, here: the change may be made again over a newer
      // arrangement (changeEraEdits), and is the same era every time.
      const key = makeKey();
      const all = whole();
      return changes((e) => createEra(e, posts, name, photoIds, () => key, all).edits) ? key : null;
    },
    takeOut: (post) => {
      const all = whole();
      return changes((e) => takeOut(e, posts, post.id, all));
    },
    deleteEra: (key) => {
      const all = whole();
      return changes((e) => deleteEra(e, posts, key, all));
    },
  };
}

/**
 * The member's own arrangement, and the means to change it, once it has
 * been read from where it is kept; undefined until then, and where there
 * is nowhere to keep it, so nothing offers a change that could not be
 * saved.
 */
export function useEraEditor(userId: string, posts: PostRow[] | undefined): EraEditor | undefined {
  const queryClient = useQueryClient();
  const edits = useEraEdits(userId);
  const ready = edits.data?.ready === true;
  return useMemo(() => {
    if (!ready || !userId || !posts) return undefined;
    return eraEditor(queryClient, userId, posts);
  }, [ready, userId, posts, queryClient]);
}
