/**
 * Gliding: the rules for the glide strip on the room's page, and for the
 * preview the photograph's area shows while a finger slides across it,
 * that need no screen.
 *
 * The strip follows the pager (`stripFollow`): the pager settles first,
 * and the strip then glides a frame by UIKit's own ease, or cuts. A
 * finger on the strip never moves the pager until its glide has come to
 * rest; meanwhile the photograph's area shows the frame under the box
 * (`GlideSheet`), soft at once and sharp once the finger slows on it, and
 * the states that decide which (`glideReducer`) are kept here, away from
 * the clock, which the sheet keeps.
 *
 * Pure: no React, no library.
 */

/**
 * The timings and measures, in milliseconds and points.
 * - deferMs: the strip is mounted this long after the room's page, so the
 *   first plate's photograph is asked for first.
 * - inMs: it then fades in over this.
 * - revealMs: a preview coming over the page waits at most this long for
 *   its soft proof to draw, the page in front staying in view meanwhile,
 *   so it never opens on an empty well.
 * - sharpMs: a frame still under the box this long (the finger slowed to
 *   under about 360 pt a second, or paused) is drawn sharp.
 * - landMaxMs: let go, the preview waits at most this long for the page's
 *   own photograph to draw, before it fades;
 * - warmLandMs: this long, for one already drawn this visit.
 * - outMs: the preview fades out over this; over a plate still dissolving
 *   in from its proof, once that dissolve is over.
 * - far: a follow of more than this many frames is a cut.
 * - proof: the soft proof's width, as the plate draws it, scaled up.
 */
export const GLIDE = { deferMs: 250, inMs: 150, revealMs: 60, sharpMs: 100, landMaxMs: 700, warmLandMs: 120, outMs: 120, far: 8, proof: 48 } as const;

/**
 * How the strip follows the pager onto page `next.index` of `next.count`
 * frames (the prints and the blank one after them), from where it last
 * followed to: a glide of a frame or a few by UIKit's own ease, or a cut
 * under Reduce Motion, in the browser, after prints were taken out behind
 * (`rebase`), for a jump of more than `GLIDE.far` frames, and the first
 * time. Null when it is already there: a batch landing at the end, which
 * adds frames and moves nothing, moves nothing here either.
 */
export function stripFollow(
  prev: { target: number; rebase: number } | null,
  next: { index: number; count: number; rebase: number },
  how: { reduceMotion: boolean; web: boolean },
): { to: number; animated: boolean } | null {
  const to = Math.max(0, Math.min(Math.max(0, next.count - 1), next.index));
  if (prev != null && prev.target === to && prev.rebase === next.rebase) return null;
  const animated = prev != null && !how.reduceMotion && !how.web && prev.rebase === next.rebase && Math.abs(to - prev.target) <= GLIDE.far;
  return { to, animated };
}

/**
 * The caption height the preview lays a print out at once its caption has
 * measured `height`, as its page settles its own (PrintPage): the pages'
 * height (`known`) while the measure is within a point of it, and the
 * measure, rounded, otherwise — where the word at the right has gone to a
 * line of its own under a narrow plate, say. So the preview stands its
 * plate where the page will, and the landing never shrinks it.
 */
export function measuredCaption(height: number, known: number): number {
  return Math.abs(height - known) < 1 ? known : Math.round(height);
}

/**
 * The preview's states.
 * - idle: nothing over the page; `fade` says whether the last frame shown
 *   fades out (a landing) or goes at once.
 * - gliding: a finger on the strip, from page `origin`, now over frame
 *   `index`; `sharp` once it has rested there.
 * - landing: let go on frame `index` (print `id`), the pager cut to it
 *   underneath; `arrived` once the room has settled there.
 */
export type GlideState =
  | { kind: "idle"; fade: boolean }
  | { kind: "gliding"; origin: number; index: number; sharp: boolean }
  | { kind: "landing"; index: number; id: string; sharp: boolean; arrived: boolean };

export type GlideEvent =
  | { type: "start"; origin: number }
  | { type: "to"; index: number }
  | { type: "rested"; index: number }
  | { type: "end"; id: string | null }
  | { type: "drawn"; id: string }
  | { type: "timedOut" }
  | { type: "settled"; index: number }
  | { type: "pagerMoved" }
  | { type: "reset" };

export const GLIDE_IDLE: GlideState = { kind: "idle", fade: false };
const FADED: GlideState = { kind: "idle", fade: true };

/**
 * A finger down on the strip glides from the page in front; each frame
 * that comes under the box is shown soft, and sharp once it has rested
 * there. Let go on the page it began from, or on the blank frame at the
 * end (whose page is a page of words), it goes at once. Let go on another
 * photograph, it stays while the pager cuts to it underneath, until that
 * page's own photograph has drawn or a short while has passed, then fades.
 * Once the room has settled there, a page turned or dragged ends it at
 * once. A finger down again takes over from any state.
 */
export function glideReducer(s: GlideState, e: GlideEvent): GlideState {
  switch (e.type) {
    case "start":
      return { kind: "gliding", origin: e.origin, index: e.origin, sharp: false };
    case "to":
      return s.kind === "gliding" && s.index !== e.index ? { ...s, index: e.index, sharp: false } : s;
    case "rested":
      return s.kind === "gliding" && s.index === e.index && !s.sharp ? { ...s, sharp: true } : s;
    case "end":
      if (s.kind !== "gliding") return s;
      if (s.index === s.origin || e.id == null) return GLIDE_IDLE;
      return { kind: "landing", index: s.index, id: e.id, sharp: s.sharp, arrived: false };
    case "drawn":
      return s.kind === "landing" && s.id === e.id ? FADED : s;
    case "timedOut":
      return s.kind === "landing" ? FADED : s;
    case "settled":
      if (s.kind !== "landing") return s;
      if (!s.arrived && e.index === s.index) return { ...s, arrived: true };
      if (s.arrived && e.index !== s.index) return GLIDE_IDLE;
      return s;
    case "pagerMoved":
      return s.kind === "landing" && s.arrived ? GLIDE_IDLE : s;
    case "reset":
      return s.kind === "idle" && !s.fade ? s : GLIDE_IDLE;
  }
}

/** The preview covers the page: while landing, and while gliding over a frame other than the page in front. */
export function sheetShows(s: GlideState): boolean {
  return s.kind === "landing" || (s.kind === "gliding" && s.index !== s.origin);
}
