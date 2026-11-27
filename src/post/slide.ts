import { holdTabSwipe } from "@/utils/tabSwipe";

/**
 * The Post tab's two pages, Recent and the Memory Room's door, and the
 * slide between them: kept apart from the screen so the rules can be held
 * without a phone.
 *
 * The owner asked for the room to be reached by the button at the top or
 * by sliding left, "but don't make the slide too sensitive — just a
 * horizontal slide". So the slide is deliberate:
 *
 *   - It only begins as a slide once the finger has gone 12 points to the
 *     left and at least one and a half times as far sideways as up or
 *     down. Scrolling the roll, a diagonal drift, a tap or a nudge of a
 *     few points never moves the page at all.
 *   - Once moving, the page follows the finger, and on release the room
 *     opens only past half the width, or on a clear flick (0.6 points a
 *     millisecond) that has already carried the page a fifth of the way.
 *     Anything less, a quick short flick included, and Recent slides back.
 *   - A slide to the right does nothing: the tabs are a tap away.
 *
 * These numbers are the rule on the iPhone and in the browser alike: the
 * two pages are the app's own pager (`PostPager`), which decides when a
 * drag is the slide and where its release lands by the functions below,
 * and leaves neither to UIKit. (A UIPageViewController, as the tabs'
 * pager is, turns its page on any quick flick however short, and takes a
 * drag nearer the diagonal than this.) The roll's vertical scroll is the
 * list's own, and gives way only to a drag more sideways than up or
 * down, so a scroll of the roll never reaches the slide.
 */

/** The page moves with the finger only once it has gone this far to the left… */
export const SLIDE_SLOP = 12;
/** …and at least this many times as far sideways as up or down. */
export const SLIDE_LOCK = 1.5;
/** Released past this share of the width, the room opens. */
export const SLIDE_SHARE = 0.5;
/** A flick: at least this fast to the left, in points a millisecond… */
export const FLICK_SPEED = 0.6;
/** …having carried the page at least this share of the way. */
export const FLICK_SHARE = 0.2;

/**
 * Whether a drag on Recent is sideways enough for the pager to take it,
 * either way: far enough (12 points) and at least one and a half times as
 * far sideways as up or down. To the left it is the slide; to the right it
 * moves nothing, but the pager still holds it, so a sideways drag never
 * ends as a tap on what it started on.
 */
export function holdsSideways(g: { dx: number; dy: number }): boolean {
  if (!(Math.abs(g.dx) >= SLIDE_SLOP)) return false;
  return Math.abs(g.dx) >= SLIDE_LOCK * Math.abs(g.dy);
}

/** How far the slide has carried the page, 0 (Recent) to 1 (the door), for a drag `dx` across a page `width` wide. */
export function slideProgress(dx: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(1, Math.max(0, -dx / width));
}

/** Whether a slide let go here opens the room: past half the width, or a clear flick already a fifth of the way. */
export function slideOpens(s: { dx: number; vx: number; width: number }): boolean {
  const travelled = slideProgress(s.dx, s.width);
  if (travelled >= SLIDE_SHARE) return true;
  return -s.vx >= FLICK_SPEED && travelled >= FLICK_SHARE;
}

/**
 * The Post tab in front: the tabs' own pager held still, where there is a
 * room to slide to, so the two pagers never take the same drag. The tabs'
 * pager is a UIPageViewController, whose pan would take any sideways drag
 * natively, before the Post tab's own pager could see it. The function
 * returned lets go, once, as the tab leaves. Where there is no room the
 * tabs swipe as they always have.
 */
export function holdWhileInFront(room: boolean, hold: () => () => void = holdTabSwipe): () => void {
  return room ? hold() : () => undefined;
}

// ---------------------------------------------------------------------------
// The room, pushed once
// ---------------------------------------------------------------------------

/**
 * How long the door waits for the room to cover the tab before it puts
 * Recent back anyway: the room's fade is 360 ms, and the stack says when
 * it is over (`covered`); this is only for a stack that does not say (the
 * browser's) or a push that never happened.
 */
export const ROOM_COVERED_MS = 1200;

export type DoorPhase = "closed" | "opening" | "covered";

export interface RoomDoorIO {
  /** The Post tab is in front and the app is active. */
  isFront(): boolean;
  /** Push the Memory Room. */
  push(): void;
  /** Put the pager back on Recent, without animation. */
  reset(): void;
  /** Run `run` after `ms`; the function returned cancels it. */
  later(run: () => void, ms: number): () => void;
}

export interface RoomDoor {
  /** The pager came to rest on the door's page. */
  settled(): void;
  /** The room covers the tab: its fade is over. */
  covered(): void;
  /** The Post tab is in front again. */
  focused(): void;
  phase(): DoorPhase;
}

/**
 * What happens when the pager comes to rest on the door's page: the room
 * is pushed, once, and only while the tab is in front; once the room
 * covers the tab, the pager goes back to Recent without animation, so the
 * way back from the room (its chevron, or the left edge) lands on Recent.
 * A page that settles twice, or a tap on the header while the room is on
 * its way, pushes nothing more until the tab is in front again; a push
 * that never took the tab away lets the door open again once Recent is
 * back.
 */
export function createRoomDoor(io: RoomDoorIO): RoomDoor {
  let phase: DoorPhase = "closed";
  let cancel: (() => void) | null = null;
  const stop = () => {
    cancel?.();
    cancel = null;
  };
  const covered = () => {
    if (phase !== "opening") return;
    stop();
    io.reset();
    phase = io.isFront() ? "closed" : "covered";
  };
  return {
    settled() {
      if (phase !== "closed") return;
      if (!io.isFront()) {
        io.reset();
        return;
      }
      phase = "opening";
      io.push();
      cancel = io.later(covered, ROOM_COVERED_MS);
    },
    covered,
    focused() {
      stop();
      if (phase === "opening") io.reset();
      phase = "closed";
    },
    phase: () => phase,
  };
}
