import { useMemo } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { ERA_SAVE_FAILED, changeEraEdits, eraEditsKey, eraEditsQuery, type EraEditsState } from "@/api/eraEdits";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { moveToEra, renameEra, sameEdits, type EraEdits } from "@/utils/eraEdits";
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

/** What the Eras view may change, on the member's own page only. */
export interface EraEditor {
  /** The member's name for the era of `key`; null, or nothing, gives it back its automatic name. */
  rename: (key: string, title: string | null) => void;
  /**
   * The photograph moved into the era of `key`. True when that changes the
   * eras on the page; false when there was nothing to move (the photograph
   * has gone, or that era cannot take it), so only a real move is said.
   */
  move: (post: PostRow, key: string) => boolean;
}

/**
 * The means to change the member's own arrangement, over their
 * photographs (`posts`, as read). A change shows at once
 * (changeEraEdits); one that does not save is taken back and the member
 * is told, in words of ours. Each change lets go of what no longer
 * applies to the photographs (renameEra, moveToEra).
 */
export function eraEditor(queryClient: QueryClient, userId: string, posts: PostRow[]): EraEditor {
  const arrange = (change: Parameters<typeof changeEraEdits>[2]) =>
    changeEraEdits(queryClient, userId, change).catch((err) =>
      showAlert(ERA_SAVE_FAILED.title, errorMessage(err, ERA_SAVE_FAILED.body)),
    );
  return {
    rename: (key, title) => void arrange((e) => renameEra(e, key, title, posts)),
    move: (post, key) => {
      const change = (e: EraEdits) => moveToEra(e, posts, post.id, key);
      // What the page shows now, the member's latest change among it.
      const shown = queryClient.getQueryData<EraEditsState>(eraEditsKey(userId));
      if (!shown?.ready || sameEdits(change(shown.edits), shown.edits)) return false;
      void arrange(change);
      return true;
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
