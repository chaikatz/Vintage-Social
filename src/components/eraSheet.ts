import {
  addChoices,
  cleanEraTitle,
  editEras,
  moveChoices,
  takeOutChoice,
  type AddGroup,
  type EraEdits,
  type MoveChoice,
} from "@/utils/eraEdits";
import type { PostRow } from "@/types/db";

/**
 * The sheet a member arranges their eras in, read from what is up and the
 * arrangement as it stands. One sheet for every change, so moving to a
 * new era from Move to is the same sheet turning its page, never one
 * sheet closing as another opens. Drawn by EraMoveSheet, on the Eras page
 * and in the Add to an era screen the feed opens.
 */

/** What the sheet is up for. */
export type EraSheetState =
  /** Where one photograph goes (a print tapped while arranging, or "Add to an era…"). */
  | { kind: "move"; post: PostRow }
  /** Photographs added to the era of `key` (ADD). */
  | { kind: "add"; key: string }
  /** A new era, named, with photographs (NEW ERA, or "New era…"), those of `chosen` already chosen. */
  | { kind: "new"; chosen: readonly string[] };

/** A photograph a move put where it is: the era it is in now, and the one it goes back to (none, null). */
export interface TakeOut {
  from: string;
  back: string | null;
}

/** What the sheet shows, as the arrangement stands now. */
export type EraSheetView =
  | { kind: "move"; post: PostRow; choices: MoveChoice<PostRow>[]; out: TakeOut | null }
  | { kind: "add"; key: string; title: string; groups: AddGroup<PostRow>[] }
  | { kind: "new"; groups: AddGroup<PostRow>[]; chosen: readonly string[] };

/**
 * The sheet for `sheet` over the member's photographs as arranged: for a
 * move, every era it can go to with "New era…" last, and, when a move put
 * it where it is, the way back; for ADD, every photograph not in that era
 * (addChoices); for a new era, every photograph. Null when nothing is up,
 * or the era ADD was for is no longer on the page.
 */
export function eraSheetView(posts: PostRow[], edits: EraEdits, sheet: EraSheetState | null): EraSheetView | null {
  if (!sheet) return null;
  if (sheet.kind === "move") {
    const choices = moveChoices(posts, edits, sheet.post.id, { newEra: true });
    const now = choices.find((c) => c.here);
    const out = takeOutChoice(posts, edits, sheet.post.id);
    return {
      kind: "move",
      post: sheet.post,
      choices,
      out: out && now ? { from: now.title, back: out.back?.title ?? null } : null,
    };
  }
  if (sheet.kind === "add") {
    const era = editEras(posts, edits).find((e) => e.key === sheet.key);
    return era ? { kind: "add", key: era.key, title: era.title, groups: addChoices(posts, edits, era.key) } : null;
  }
  return { kind: "new", groups: addChoices(posts, edits, null), chosen: sheet.chosen };
}

/** Whether a new era can be made: a name left once it is cleaned (cleanEraTitle), and a photograph for it. */
export function canCreate(name: string, chosen: readonly string[]): boolean {
  return cleanEraTitle(name) !== "" && chosen.length > 0;
}

// ---------------------------------------------------------------------------
// The words
// ---------------------------------------------------------------------------

export const NEW_ERA_HEAD = "New era";
export const CREATE = "Create";

export function addHead(title: string): string {
  return `Add to ${title}`;
}

/** ADD's confirm: how many it adds, once there is one. */
export function addConfirm(n: number): string {
  return n > 0 ? `Add ${n}` : "Add";
}

/** How many are chosen, under a new era's name. */
export function chosenCount(n: number): string {
  if (n === 0) return "None chosen yet";
  return n === 1 ? "1 photograph" : `${n} photographs`;
}

export function takeOutTitle(out: TakeOut): string {
  return `Take out of ${out.from}`;
}

export function takeOutMeta(out: TakeOut): string {
  return out.back ? `Back to ${out.back}` : "Back to no era, where it was";
}

// What the foot of the page says, and VoiceOver, once a change is made.

export function movedNote(title: string): string {
  return `Moved to ${title}`;
}

export function addedNote(n: number, title: string): string {
  return `Added ${n} to ${title}`;
}

export function madeNote(name: string): string {
  return `Made ${cleanEraTitle(name)}`;
}

export function takenOutNote(out: TakeOut): string {
  return out.back ? `Back in ${out.back}` : `Taken out of ${out.from}`;
}

export function deletedNote(title: string): string {
  return `Deleted ${title}`;
}
