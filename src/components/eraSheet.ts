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

/**
 * How far the keyboard comes up over the sheet, from where its top edge
 * comes to rest (`screenY`, in the window) to the foot of the window. A
 * sheet of ours reaches the foot of the screen, as a page sheet does on
 * an iPhone, so this is how far its foot must rise. KeyboardAvoidingView
 * measures the sheet from the sheet's own top, which is lower than the
 * screen's, and left the foot that much under the keyboard. Nothing where
 * the keyboard gives no place for itself, as with Prefer Cross-Fade
 * Transitions (KeyboardAvoidingView does the same).
 */
export function keyboardLift(screenY: number, windowHeight: number): number {
  if (!(screenY > 0) || !(windowHeight > 0)) return 0;
  return Math.max(0, Math.round(windowHeight - screenY));
}

/** A line of the ADD and NEW ERA sheet: a group's heading, or a row of its photographs. */
export type GatherLine<T extends { id: string } = PostRow> =
  | { kind: "head"; key: string; group: AddGroup<T> }
  | { kind: "row"; key: string; posts: T[]; first: boolean };

/**
 * The groups ADD and NEW ERA offer, as the lines of a list that draws
 * only those near the screen: each group's heading, then its photographs
 * `across` to a row, in the group's order. Every photograph is on exactly
 * one row, so each line has a key of its own.
 */
export function gatherLines<T extends { id: string }>(groups: AddGroup<T>[], across: number): GatherLine<T>[] {
  const lines: GatherLine<T>[] = [];
  for (const group of groups) {
    lines.push({ kind: "head", key: `head:${group.key ?? ""}`, group });
    for (let i = 0; i < group.posts.length; i += across) {
      lines.push({ kind: "row", key: `row:${group.posts[i].id}`, posts: group.posts.slice(i, i + across), first: i === 0 });
    }
  }
  return lines;
}

/** Whether a new era can be made: a name left once it is cleaned (cleanEraTitle), and a photograph for it. */
export function canCreate(name: string, chosen: readonly string[]): boolean {
  return cleanEraTitle(name) !== "" && chosen.length > 0;
}

/**
 * What the Add to an era screen the feed opens shows, as its reads stand:
 * still reading; the read of the member's photographs failed; the
 * photograph is not among them; the eras cannot be changed just now; or
 * the sheet.
 */
export type EraMoveStage = "reading" | "readFailed" | "notYours" | "cannotArrange" | "sheet";

/**
 * Only a read that has answered, and found nothing, says the photograph
 * is not the member's any more. While one is on its way, or waits for
 * the phone to be back online, it is still being read: the list cached
 * may be from before the photograph was posted (on another phone, say).
 * And a read that failed says so, rather than that.
 */
export function eraMoveStage(reads: {
  /** Both reads have answered at least once: the photographs, and the arrangement. */
  answered: boolean;
  /** A read of the photographs is on its way, or waiting for the phone to be back online. */
  reading: boolean;
  /** The last read of the photographs failed, or none has brought any. */
  failed: boolean;
  /** The photograph is among those read. */
  found: boolean;
  /** The eras can be changed: the arrangement was read, and there is somewhere to keep a change. */
  arrangeable: boolean;
}): EraMoveStage {
  if (!reads.answered || (!reads.found && reads.reading)) return "reading";
  if (!reads.found) return reads.failed ? "readFailed" : "notYours";
  return reads.arrangeable ? "sheet" : "cannotArrange";
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
