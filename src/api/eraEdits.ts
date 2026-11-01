import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { isDemoMode } from "@/lib/env";
import * as demo from "@/demo/store";
import { NO_EDITS, deviceZone, readEdits, sameEdits, type EraEdits } from "@/utils/eraEdits";

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
    .select("titles, moves, time_zone")
    .eq("author_id", authorId)
    .maybeSingle();
  if (error) {
    if (missingTable(error)) return { edits: NO_EDITS, ready: false };
    throw error;
  }
  return { edits: readEdits(data), ready: true };
}

/** The member's arrangement, saved whole over their own row, with the zone its keys were read in. */
export async function saveEraEdits(authorId: string, edits: EraEdits): Promise<void> {
  if (isDemoMode()) {
    demo.demoSaveEraEdits(authorId, edits);
    return;
  }
  const { error } = await supabase
    .from("era_edits")
    .upsert(
      { author_id: authorId, titles: edits.titles, moves: edits.moves, time_zone: edits.zone ?? null },
      { onConflict: "author_id" },
    );
  if (error) throw error;
}

/** What the member is told when a change does not save, after it has been taken back. */
export const ERA_SAVE_FAILED = {
  title: "Couldn’t save that change",
  body: "Your eras are as they were. Try again in a moment.",
} as const;

/**
 * Per member, while a change of theirs is being saved: what the server is
 * known to hold, and what the member has asked for since, which is what
 * is saved next and what the page shows.
 */
const saving = new Map<string, { confirmed: EraEdits; wanted: EraEdits }>();

/**
 * A member's arrangement as every screen reads it: as the server holds
 * it, except while a change of the member's is being saved, when it is
 * that change. A read that lands then may have been answered before the
 * save reached the row, and would put the old arrangement back on the
 * page.
 */
export async function readEraEdits(authorId: string): Promise<EraEditsState> {
  const read = await fetchEraEdits(authorId);
  const run = saving.get(authorId);
  return run ? { edits: run.wanted, ready: true } : read;
}

/** The one cache entry a member's arrangement is read into, and how it is read. */
export function eraEditsQuery(authorId: string) {
  return { queryKey: eraEditsKey(authorId), queryFn: () => readEraEdits(authorId) };
}

/**
 * A change to the member's own arrangement, shown at once and then saved.
 *
 * Every screen that draws these eras reads the one cache entry, so the
 * change is on the page before the server has it. Saves go one at a
 * time, each the whole arrangement. A change made while one is on its
 * way is shown at once too, and saved as soon as that one lands, so the
 * last word is always the last change. What is saved is what the member
 * asked for, never what the cache happens to hold: a read that lands
 * mid-save is answered with the member's change (readEraEdits), and once
 * each save lands any read still on its way is called off and the change
 * put back on the page.
 *
 * If a save fails, the arrangement goes back to the last one the server
 * is known to hold, and is read again, as the save may have landed and
 * only its answer been lost. The failure is passed on, once, for the
 * member to be told.
 *
 * Nothing is changed before the arrangement has been read (`ready`):
 * saving over a row not yet seen would lose what is in it. For the same
 * reason, a change made while a read is on its way waits for that read
 * (it may hold a change made on another phone) and is made over it.
 *
 * The first arrangement a member saves keeps the zone its keys were read
 * in, the phone's own. From then on it keeps the one it has, so moving
 * through time zones never changes what the keys mean.
 */
export async function changeEraEdits(
  queryClient: QueryClient,
  authorId: string,
  change: (edits: EraEdits) => EraEdits,
): Promise<void> {
  const key = eraEditsKey(authorId);
  const show = (edits: EraEdits) => queryClient.setQueryData<EraEditsState>(key, { edits, ready: true });

  // A save under way takes this change with it.
  const under = saving.get(authorId);
  if (under) {
    const next = change(under.wanted);
    if (sameEdits(next, under.wanted)) return;
    under.wanted = next;
    show(next);
    return;
  }

  let held = queryClient.getQueryData<EraEditsState>(key);
  if (!held?.ready) return;
  if (queryClient.getQueryState(key)?.fetchStatus === "fetching") {
    try {
      held = await queryClient.query({ ...eraEditsQuery(authorId), staleTime: 0 });
    } catch {
      held = queryClient.getQueryData<EraEditsState>(key);
    }
    // Another change may have begun saving while this one waited.
    if (saving.has(authorId)) return changeEraEdits(queryClient, authorId, change);
    if (!held?.ready) return;
  }

  const changed = change(held.edits);
  if (sameEdits(changed, held.edits)) return;
  const zone = changed.zone ?? deviceZone();
  const run = { confirmed: held.edits, wanted: zone ? { ...changed, zone } : changed };
  saving.set(authorId, run);
  show(run.wanted);
  try {
    while (!sameEdits(run.wanted, run.confirmed)) {
      const target = run.wanted;
      await saveEraEdits(authorId, target);
      run.confirmed = target;
      // A read that set off while it saved may have been answered before it landed.
      await queryClient.cancelQueries({ queryKey: key });
      show(run.wanted);
    }
  } catch (err) {
    saving.delete(authorId);
    show(run.confirmed);
    void queryClient.invalidateQueries({ queryKey: key });
    throw err;
  } finally {
    saving.delete(authorId);
  }
}
