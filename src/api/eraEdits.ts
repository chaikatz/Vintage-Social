import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { NO_EDITS, readEdits, sameEdits, type EraEdits } from "@/utils/eraEdits";

/**
 * A member's own names for their eras and the photographs they moved
 * between them: one row each, which the member writes and everyone who
 * may see their photographs reads (migration 0022). How the changes are
 * laid over the eras is src/utils/eraEdits.ts; this file only asks.
 */

/** What a member's Eras are drawn with, and whether there is anywhere to keep a change. */
export type EraEditsState = {
  edits: EraEdits;
  /** The arrangement was read from where it is kept, so a change can be saved over it. */
  ready: boolean;
};

export const eraEditsKey = (authorId: string) => ["era-edits", authorId] as const;

/**
 * PostgREST's answer for a table it has never heard of (PGRST205), and
 * Postgres's own (42P01): the build is out before migration 0022 is
 * applied.
 */
function missingTable(error: { code?: unknown }): boolean {
  return error.code === "PGRST205" || error.code === "42P01";
}

/**
 * A member's arrangement. No row is no change: their eras are the
 * automatic ones. Where the table is not there yet, Eras are drawn
 * automatically, quietly, and nothing offers to change them, since there
 * is nowhere to keep a change. Any other failure is a failure, and is
 * tried again as the cache tries everything.
 */
export async function fetchEraEdits(authorId: string): Promise<EraEditsState> {
  if (isDemoMode()) return { edits: demo.demoFetchEraEdits(authorId), ready: true };
  const { data, error } = await supabase
    .from("era_edits")
    .select("titles, moves")
    .eq("author_id", authorId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return { edits: NO_EDITS, ready: false };
    throw error;
  }
  return { edits: readEdits(data), ready: true };
}

/** The member's arrangement, saved whole over their own row. */
export async function saveEraEdits(authorId: string, edits: EraEdits): Promise<void> {
  if (isDemoMode()) {
    demo.demoSaveEraEdits(authorId, edits);
    return;
  }
  const { error } = await supabase
    .from("era_edits")
    .upsert({ author_id: authorId, titles: edits.titles, moves: edits.moves }, { onConflict: "author_id" });
  if (error) throw error;
}

/** What the member is told when a change does not save, after it has been taken back. */
export const ERA_SAVE_FAILED = {
  title: "Couldn’t save that change",
  body: "Your eras are as they were. Try again in a moment.",
} as const;

/** Per member: what the server is known to hold while a save is under way. */
const saving = new Map<string, { confirmed: EraEdits }>();

/**
 * A change to the member's own arrangement, shown at once and then saved.
 *
 * Every screen that draws these eras reads the one cache entry, so the
 * change is on the page before the server has it. Saves go one at a
 * time, each the whole arrangement: a change made while one is on its
 * way is shown at once too, and saved as soon as that one lands, so the
 * last word is always the last change. If a save fails, the arrangement
 * goes back to the last one the server holds and the failure is passed
 * on, once, for the member to be told. Nothing is changed before the
 * arrangement has been read (`ready`): saving over a row not yet seen
 * would lose what is in it.
 */
export async function changeEraEdits(
  queryClient: QueryClient,
  authorId: string,
  change: (edits: EraEdits) => EraEdits,
): Promise<void> {
  const key = eraEditsKey(authorId);
  const held = queryClient.getQueryData<EraEditsState>(key);
  if (!held?.ready) return;
  const next = change(held.edits);
  if (sameEdits(next, held.edits)) return;
  // A read on its way back would put the old arrangement over this one.
  void queryClient.cancelQueries({ queryKey: key });
  queryClient.setQueryData<EraEditsState>(key, { edits: next, ready: true });

  if (saving.has(authorId)) return; // the save under way takes this one with it
  const run = { confirmed: held.edits };
  saving.set(authorId, run);
  try {
    for (;;) {
      const latest = queryClient.getQueryData<EraEditsState>(key)?.edits;
      if (!latest || sameEdits(latest, run.confirmed)) break;
      await saveEraEdits(authorId, latest);
      run.confirmed = latest;
    }
  } catch (err) {
    queryClient.setQueryData<EraEditsState>(key, { edits: run.confirmed, ready: true });
    throw err;
  } finally {
    saving.delete(authorId);
  }
}
