import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ERA_SAVE_FAILED, changeEraEdits, eraEditsKey, fetchEraEdits } from "@/api/eraEdits";
import { showAlert } from "@/utils/alert";
import { errorMessage } from "@/utils/errorMessage";
import { moveToEra, renameEra } from "@/utils/eraEdits";
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
    queryKey: eraEditsKey(authorId ?? ""),
    queryFn: () => fetchEraEdits(authorId ?? ""),
    enabled: Boolean(authorId) && enabled,
  });
}

/** What the Eras view may change, on the member's own page only. */
export interface EraEditor {
  /** The member's name for the era of `key`; null, or nothing, gives it back its automatic name. */
  rename: (key: string, title: string | null) => void;
  /** The photograph moved into the era of `key`. */
  move: (post: PostRow, key: string) => void;
}

/**
 * The member's own arrangement, and the means to change it, once it has
 * been read from where it is kept; undefined until then, and where there
 * is nowhere to keep it, so nothing offers a change that could not be
 * saved. A change shows at once (changeEraEdits); one that does not save
 * is taken back and the member is told, in words of ours.
 */
export function useEraEditor(userId: string, posts: PostRow[] | undefined): EraEditor | undefined {
  const queryClient = useQueryClient();
  const edits = useEraEdits(userId);
  const ready = edits.data?.ready === true;
  return useMemo(() => {
    if (!ready || !userId || !posts) return undefined;
    const arrange = (change: Parameters<typeof changeEraEdits>[2]) =>
      changeEraEdits(queryClient, userId, change).catch((err) =>
        showAlert(ERA_SAVE_FAILED.title, errorMessage(err, ERA_SAVE_FAILED.body)),
      );
    return {
      rename: (key, title) => void arrange((e) => renameEra(e, key, title)),
      move: (post, key) => void arrange((e) => moveToEra(e, posts, post.id, key)),
    };
  }, [ready, userId, posts, queryClient]);
}
