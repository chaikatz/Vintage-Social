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

/** However it is going, the gallery shows by this long after it began, in ms. */
export const GIVE_UP_MS = 15000;

/** Rounding the browser does to a measure, in points. */
const TOLERANCE = 1;

/** What the landing has done so far. */
export interface Landing {
  /** When it began. */
  began: number;
  /** Where the list was last put for the tapped card, or null before it has been. */
  placedAt: number | null;
  /** Looks in a row that have found the card where it was put. */
  still: number;
  /** Cards that had reported a height by the last look. */
  measured: number;
  /** When more cards were last drawn, or the tapped card last moved. */
  changedAt: number;
}

export function startLanding(now: number): Landing {
  return { began: now, placedAt: null, still: 0, measured: 0, changedAt: now };
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
   * Whether the list can go no further with every card below the tapped
   * one drawn: then the card is one of the last, and as high as it can be.
   */
  end: boolean;
  /** Cards that have reported a height so far. */
  measured: number;
  now: number;
}

export function nextLanding(landing: Landing, look: Look): { step: LandingStep; landing: Landing } {
  if (look.index <= 0) return { step: { kind: "show", offset: 0 }, landing };
  const offset = look.top == null ? null : Math.max(0, look.top);
  const moved = offset != null && (landing.placedAt == null || Math.abs(landing.placedAt - offset) > TOLERANCE);
  const grew = look.measured > landing.measured;
  const next: Landing = {
    ...landing,
    measured: Math.max(landing.measured, look.measured),
    changedAt: grew || moved ? look.now : landing.changedAt,
  };
  const late = look.now - next.changedAt >= STALL_MS || look.now - landing.began >= GIVE_UP_MS;
  if (offset == null) {
    // Not drawn in all that time: where it was last seen, or else the top
    // of the list, never wherever the list was left on the way.
    if (late) return { step: { kind: "show", offset: landing.placedAt ?? 0 }, landing: next };
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
