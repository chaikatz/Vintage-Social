/**
 * How the gallery lands on the photograph tapped in a grid.
 *
 * It used to add up the heights of the cards above the tapped one and
 * scroll to the sum. Past the eightieth card that sum was further down
 * than the list had drawn, and a list without fixed heights will not
 * scroll past what it has drawn: the scroll stops at the end, on the
 * phone and in the browser alike. So every photograph deep in a long
 * history opened on the same card, the one that happened to be last. And
 * the sum drifted even where it reached, because the browser reports
 * each height rounded.
 *
 * Now it looks where the tapped card really is. Until the card is drawn,
 * the list is sent towards it, and draws its way down a stretch at a
 * time. Once it is drawn, its top is measured from the top of the list
 * and the list is put exactly there. The list may not get there yet, if
 * what is drawn below the card is still too short, so where the list
 * says it is gets checked too. Drawing the cards around it can push the
 * card down, so it is measured again, and the gallery shows only once the
 * card has stayed where it was put for a few looks in a row.
 *
 * The clocks that make it give up count only the time it is looking. A
 * phone sent to the background, or a browser tab out of sight, stops the
 * list drawing; that is a pause, not a list that has stopped, and the
 * landing goes on where it was when the app comes back.
 */

/** How often the gallery looks again while it lands, in ms. */
export const LANDING_STEP_MS = 50;

/** Looks in a row that must find the card where it was put before the gallery shows. */
export const STILL_LOOKS = 3;

/**
 * With nothing new drawn and the card not moving for this long, the
 * gallery shows what it has, in ms: a blank screen waiting on a card is
 * worse than a landing a little off.
 */
export const STALL_MS = 2000;

/**
 * However it is going, the gallery shows by this long after the tapped
 * card was first drawn, in ms. Not before: until then the list is drawing
 * its way down to it, and a list still drawing more is getting there.
 * One that has stopped drawing is what STALL_MS is for.
 */
export const GIVE_UP_MS = 15000;

/**
 * Two looks further apart than this, in ms, mean the app was away: in the
 * background, or a tab out of sight. The gap counts as one ordinary look,
 * so a pause never reads as a stall, and a phone too busy to look on time
 * still gets there.
 */
export const AWAY_MS = 500;

/** Rounding the browser does to a measure, in points. */
const TOLERANCE = 1;

/** What the landing has done so far. */
export interface Landing {
  /** When the tapped card was first drawn, or null before it has been: the cap counts from then. */
  drawnAt: number | null;
  /** Where the list was last put for the tapped card, or null before it has been. */
  placedAt: number | null;
  /** Looks in a row that have found the card where it was put. */
  still: number;
  /** Cards that had reported a height by the last look. */
  measured: number;
  /** When more cards were last drawn, or the tapped card last moved. */
  changedAt: number;
  /** When it last looked. */
  lookedAt: number;
}

export function startLanding(now: number): Landing {
  return { drawnAt: null, placedAt: null, still: 0, measured: 0, changedAt: now, lookedAt: now };
}

/** What to do next. */
export type LandingStep =
  /** Not drawn yet: send the list towards it, then look again. */
  | { kind: "approach" }
  /** Drawn: put the list at its top, then look again. */
  | { kind: "place"; offset: number }
  /** Where it was put: look again, to be sure nothing above it is still moving. */
  | { kind: "hold" }
  /** Done. Put the list at `offset` first when there is one, then show it. */
  | { kind: "show"; offset: number | null };

/** One look at the list. */
export interface Look {
  /**
   * The tapped card's place in the gallery's rows: 0 when it is the first,
   * or when it is not there at all (deleted meanwhile), and the gallery
   * then opens at the top, wherever the list had been sent on the way.
   */
  index: number;
  /** The card's top, measured from the top of the list; null while it is not drawn. */
  top: number | null;
  /** Where the list last said it is; null before it has said. */
  scrolled: number | null;
  /**
   * Whether the list can go no further (atListEnd) with every card below
   * the tapped one drawn: then the card is one of the last, and as high
   * as it can be.
   */
  end: boolean;
  /** Cards that have reported a height so far. */
  measured: number;
  now: number;
}

export function nextLanding(landing: Landing, look: Look): { step: LandingStep; landing: Landing } {
  if (look.index <= 0) return { step: { kind: "show", offset: 0 }, landing };
  const was = afterAway(landing, look.now);
  const offset = look.top == null ? null : Math.max(0, look.top);
  const moved = offset != null && (was.placedAt == null || Math.abs(was.placedAt - offset) > TOLERANCE);
  const grew = look.measured > was.measured;
  const next: Landing = {
    ...was,
    drawnAt: was.drawnAt ?? (offset != null ? look.now : null),
    measured: Math.max(was.measured, look.measured),
    changedAt: grew || moved ? look.now : was.changedAt,
    lookedAt: look.now,
  };
  const late =
    look.now - next.changedAt >= STALL_MS || (next.drawnAt != null && look.now - next.drawnAt >= GIVE_UP_MS);
  if (offset == null) {
    // Not drawn in all that time: where it was last seen, or else the top
    // of the list, never wherever the list was left on the way.
    if (late) return { step: { kind: "show", offset: next.placedAt ?? 0 }, landing: next };
    return { step: { kind: "approach" }, landing: next };
  }
  // Put there, but stopped short: what is drawn below it was too short.
  const short = !look.end && (look.scrolled == null || Math.abs(look.scrolled - offset) > TOLERANCE);
  if (moved || short) {
    const placed = { ...next, placedAt: offset, still: 0 };
    return { step: late ? { kind: "show", offset } : { kind: "place", offset }, landing: placed };
  }
  const still = next.still + 1;
  const held = { ...next, still };
  if (still >= STILL_LOOKS || late) return { step: { kind: "show", offset: null }, landing: held };
  return { step: { kind: "hold" }, landing: held };
}

/**
 * The landing with a pause taken out of its clocks: after a gap longer
 * than AWAY_MS, they move on by all of it but one ordinary look.
 */
function afterAway(landing: Landing, now: number): Landing {
  const gap = now - landing.lookedAt;
  if (gap <= AWAY_MS) return landing;
  const away = gap - LANDING_STEP_MS;
  return {
    ...landing,
    changedAt: landing.changedAt + away,
    drawnAt: landing.drawnAt == null ? null : landing.drawnAt + away,
  };
}

/**
 * Whether the list can go no further down: where it last said it is,
 * against how long it is now and how much of it is on screen. Read at
 * each look, not kept from when it last moved, because cards drawn below
 * it since then make room to go on, and a list says nothing when it only
 * grows. One that has not said where it is has not moved from its top,
 * and one that fits on the screen never will: it is at its end from the
 * start. Nothing laid out yet is not an end.
 */
export function atListEnd(scrolled: number | null, viewport: number, content: number): boolean {
  if (viewport <= 0 || content <= 0) return false;
  return (scrolled ?? 0) + viewport >= content - TOLERANCE;
}

/**
 * The card whose clip plays once the gallery shows, from the cards the
 * list reports on screen, in order: the tapped one while it is on screen
 * and the reader has not moved off it, otherwise the first on screen, as
 * everywhere else. Landed at the end, the tapped card is the last one,
 * under a card that may show more of itself and so come first.
 */
export function playingCard(onScreen: readonly string[], tapped: string | undefined, onTapped: boolean): string | null {
  if (onTapped && tapped != null && onScreen.includes(tapped)) return tapped;
  return onScreen[0] ?? null;
}

/**
 * Roughly where the tapped card is before it is drawn: the heights of the
 * cards above it that have reported one, and the typical height of those
 * for the rest. Only good enough to send the list towards it; the list
 * stops at the end of what it has drawn, and draws on from there.
 */
export function approachOffset(heightsAbove: (number | undefined)[], padding: number): number {
  let known = 0;
  let count = 0;
  for (const h of heightsAbove) {
    if (h == null) continue;
    known += h;
    count++;
  }
  const typical = count > 0 ? known / count : 0;
  return padding + known + typical * (heightsAbove.length - count);
}
