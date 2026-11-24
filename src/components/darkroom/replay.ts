import { occasionDay } from "@/darkroom/occasions";
import type { DarkroomMode, DayReach, Print, Span } from "@/darkroom/types";
import { ratioOf } from "./geometry";
import { edgeMarkWords, replayCardWords, type Ending, type ReplayCard, type ReplayPhase } from "./words";

export type { ReplayCard, ReplayPhase } from "./words";

/**
 * PLAY: the chapter in front of the member played through, a photograph at
 * a time, in the gate of the Memory Room's own page — Retro's measured
 * pace, Photos' sliding strip under it, and a dial to hold, play and turn.
 *
 * Everything here needs no screen, so the tests can hold it to its word:
 * which chapters can be played, how long each photograph stays (`replayPlan`,
 * worked out once per replay, in one pass), where its groups begin and
 * which have a title card, the marks printed along the strip's edge, the
 * strip's and the dial's arithmetic, and the replay's own states
 * (`replayReducer`), which never read the clock: `useReplay` keeps the
 * time.
 *
 * The replay plays what the room already holds in memory: the chapter's
 * own prints. It asks the library nothing.
 */

/** The chapters that can be played: each is shown whole, with nothing more to deal. */
export const REPLAY_MODES: readonly DarkroomMode[] = ["on-this-day", "span", "set-aside"];
/** Fewer than this is not worth playing. */
export const REPLAY_MIN = 3;

/**
 * How long a photograph stays, in milliseconds. The owner's recording of
 * Retro cuts every 500 ms; a burst taken seconds apart plays at 340, as
 * stop-motion, and never faster: 340 keeps the changes to three a second
 * or fewer, whatever the photographs (WCAG 2.3.1). The first print shown
 * after PLAY stays a little longer, as does one alone in its year or day,
 * and the last longest, before the replay ends. A title card stays a
 * second. Under Reduce Motion nothing changes faster than 800.
 */
export const PACE = { burst: 340, frame: 500, first: 900, alone: 1000, last: 1600, card: 1000, reduceMotion: 800 } as const;
/** Photographs this close together, of the same shape, are a burst. */
export const BURST_GAP_MS = 2000;
/** Two shapes within this share of each other are the same shape. */
export const SAME_SHAPE = 0.02;
/** The next photograph is waited for this long, online, before the replay goes on with its proof. */
export const READY_WAIT_MS = 1500;
/** Held, the photographs kept ready move to where the member is once nothing has changed for this long. */
export const REST_MS = 150;
/** Held, the dial's hand eases back onto the photograph's place over this. */
export const HOLD_EASE_MS = 120;
/** The room goes out over this as the replay opens, and the replay as it closes. */
export const ROOM_OUT_MS = 160;
/** The replay comes in over this, and the room comes back over the same. */
export const REPLAY_IN_MS = 240;
/** A year or a day with at least this many photographs has a title card. */
export const CARD_MIN = 3;
/** While playing, the gate holds this many photographs ahead of the one in front, and this many behind. */
export const AHEAD = 3;
export const BEHIND = 1;
/** Held, this many ahead. */
export const HELD_AHEAD = 1;
/** The soft proof, as the room's plate draws it: 48 pt wide, scaled up. */
export const PROOF_WIDTH = 48;

/** The glide strip: frames, their pitch, the frame in front's growth, the grease-pencil box and the marks' row. */
export const STRIP = { cellW: 28, cellH: 40, gap: 8, pitch: 36, centreScale: 1.2, boxW: 40, boxH: 54, marks: 12 } as const;
/** Edge marks closer than this many frames to the last one kept are left out. */
export const MARK_SPACING = 3;
/** The dial: its size, its ticks, how far its press reaches, how far a finger moves before it turns, and the least time between two detents. */
export const DIAL = { size: 80, ticks: 60, slop: 12, turnAfter: 8, detentMs: 40 } as const;

// ---------------------------------------------------------------------------
// Where it starts
// ---------------------------------------------------------------------------

/**
 * Whether a chapter can be played: On this day, a stretch or the shelf,
 * shown whole (nothing more to deal), not failed, with at least three
 * photographs still there.
 */
export function replayable(mode: DarkroomMode, more: boolean, failed: boolean, count: number): boolean {
  return REPLAY_MODES.includes(mode) && !more && !failed && count >= REPLAY_MIN;
}

/** Where a replay starts: at the print in front, or at the first when there is none, or it is the last. */
export function replayStart(prints: readonly { id: string }[], id: string | null): number {
  if (id == null) return 0;
  const i = prints.findIndex((p) => p.id === id);
  return i < 0 || i >= prints.length - 1 ? 0 : i;
}

/** How the chapter being played ends, for what is said when the replay does. */
export function replayEnding(mode: DarkroomMode, reach: DayReach | null, span: Span | null): Ending {
  if (mode === "on-this-day") return { kind: "day", reach };
  if (mode === "span") return { kind: "span", span };
  return { kind: "shelf" };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

export interface ReplayPlan {
  /** Each print's group: its year in On this day, its day in a stretch. */
  groupOf: Int32Array;
  /** Where each group begins. */
  starts: number[];
  /** How long each print stays, before the rule for the first print shown (`dwellAt`). */
  dwell: number[];
  /** The card before a print that begins a group with one. */
  card: (ReplayCard | null)[];
}

export interface ReplayContext {
  mode: DarkroomMode;
  reach: DayReach | null;
  now: number;
  reduceMotion: boolean;
}

function sameShape(a: Print, b: Print): boolean {
  const ra = ratioOf(a);
  const rb = ratioOf(b);
  return Math.abs(ra - rb) <= SAME_SHAPE * Math.max(ra, rb);
}

/**
 * The replay's groups, in one pass. On this day is ordered newest year
 * first and each year in the order taken (discovery's own order), so a
 * new year begins wherever the time goes backwards; that is exact even
 * near New Year, where a year is an anniversary's, not the calendar's. A
 * stretch is grouped by its days, which run to four in the morning
 * (`occasionDay`). The shelf is one group.
 */
function groupsOf(prints: readonly Print[], mode: DarkroomMode): { groupOf: Int32Array; starts: number[] } {
  const n = prints.length;
  const groupOf = new Int32Array(n);
  const starts: number[] = n > 0 ? [0] : [];
  let day = n > 0 && mode === "span" ? occasionDay(prints[0].takenAt) : 0;
  for (let i = 1; i < n; i++) {
    let fresh = false;
    if (mode === "on-this-day") fresh = prints[i].takenAt < prints[i - 1].takenAt;
    else if (mode === "span") {
      const d = occasionDay(prints[i].takenAt);
      fresh = d !== day;
      day = d;
    }
    if (fresh) starts.push(i);
    groupOf[i] = starts.length - 1;
  }
  return { groupOf, starts };
}

/**
 * Everything about the pace, worked out once for a replay, O(n): each
 * print's group, where the groups begin, how long each print stays and
 * which have a title card before them. A card opens a group of three or
 * more, only where there are two groups or more, and never in Set aside.
 */
export function replayPlan(prints: readonly Print[], ctx: ReplayContext): ReplayPlan {
  const n = prints.length;
  const { groupOf, starts } = groupsOf(prints, ctx.mode);
  const groups = starts.length;
  const sizes = starts.map((s, g) => (g + 1 < groups ? starts[g + 1] : n) - s);
  const dwell: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    let ms: number;
    if (i === n - 1) ms = PACE.last;
    else {
      const gap = prints[i + 1].takenAt - prints[i].takenAt;
      ms = gap >= 0 && gap <= BURST_GAP_MS && sameShape(prints[i], prints[i + 1]) ? PACE.burst : PACE.frame;
      if (groups >= 2 && sizes[groupOf[i]] <= 2) ms = Math.max(ms, PACE.alone);
    }
    if (ctx.reduceMotion) ms = Math.max(ms, PACE.reduceMotion);
    dwell[i] = ms;
  }
  const card: (ReplayCard | null)[] = new Array(n).fill(null);
  if (groups >= 2 && ctx.mode !== "set-aside") {
    starts.forEach((s, g) => {
      if (sizes[g] >= CARD_MIN) card[s] = replayCardWords(ctx.mode, prints[s].takenAt, ctx.now, ctx.reach);
    });
  }
  return { groupOf, starts, dwell, card };
}

/** How long print `i` stays: its own dwell, and at least `PACE.first` for the first print shown after PLAY. */
export function dwellAt(plan: ReplayPlan, i: number, fresh: boolean): number {
  const ms = plan.dwell[i] ?? PACE.frame;
  return fresh ? Math.max(ms, PACE.first) : ms;
}

/**
 * The marks printed along the strip's top edge, by frame: the year in On
 * this day, the day in a stretch of two days or more; never a frame
 * number, and none on the shelf. A mark within `MARK_SPACING` frames of
 * the last one kept is left out, so marks never run into each other.
 */
export function edgeMarks(prints: readonly Print[], plan: ReplayPlan, mode: DarkroomMode, now: number): Map<number, string> {
  const marks = new Map<number, string>();
  if (mode === "set-aside" || (mode === "span" && plan.starts.length < 2)) return marks;
  let last = -Infinity;
  for (const s of plan.starts) {
    if (s - last < MARK_SPACING) continue;
    const words = edgeMarkWords(mode, prints[s].takenAt, now);
    if (words == null) continue;
    marks.set(s, words);
    last = s;
  }
  return marks;
}

// ---------------------------------------------------------------------------
// The gate, the strip and the dial
// ---------------------------------------------------------------------------

/**
 * The photographs the gate holds ready, as a range of indices: one behind
 * the photograph in front and three ahead while playing, one either side
 * while held. At most five.
 */
export function trayRange(index: number, n: number, playing: boolean): [number, number] {
  if (n <= 0) return [0, -1];
  const i = Math.max(0, Math.min(n - 1, index));
  return [Math.max(0, i - BEHIND), Math.min(n - 1, i + (playing ? AHEAD : HELD_AHEAD))];
}

/** The strip's frame under its box at scroll offset `x`. */
export function stripIndex(x: number, n: number): number {
  if (n <= 0 || !Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(x / STRIP.pitch)));
}

/** The shortest signed turn from one angle to another, in degrees, so a turn through 12 o'clock does not jump. */
export function turnDelta(prevDeg: number, nextDeg: number): number {
  const d = (((nextDeg - prevDeg) % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** The photograph a fraction of the dial's turn lands on. Never past the last. */
export function dialIndex(fraction: number, n: number): number {
  if (n <= 0 || !Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(n - 1, Math.round(fraction * n)));
}

/** Which of the dial's sixty ticks a fraction of the turn is in. */
export function tickOf(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0;
  return Math.max(0, Math.min(DIAL.ticks - 1, Math.floor(fraction * DIAL.ticks + 1e-9)));
}

// ---------------------------------------------------------------------------
// The replay's states
// ---------------------------------------------------------------------------

/** What last changed the photograph in front: the clock, a finger on the strip or the dial, a tap, or VoiceOver. */
export type ReplaySource = "clock" | "strip" | "dial" | "tap" | "vo";

export interface ReplayState {
  /** The photograph in front (or the one its card is for). */
  index: number;
  phase: ReplayPhase;
  /** Playing, but waiting: on a title card, or on the next photograph's image. */
  wait: null | "card" | "image";
  /** The photograph waited for. */
  pending: number | null;
  /** A finger is on the strip or turning the dial. */
  scrubbing: null | "strip" | "dial";
  /** The first photograph shown since PLAY: it stays at least `PACE.first`. */
  fresh: boolean;
  source: ReplaySource;
  /** Counts each change of what the gate shows, so the clock can time a photograph from when it was shown. */
  shown: number;
  /** Where the photographs held ready are centred: the photograph in front, once the member has come to rest. */
  centre: number;
}

/** What the reducer asks of the replay as it is: how many prints, which are gone, which are ready to show, which have a card, and whether the phone is online. */
export interface ReducerContext {
  n: number;
  gone(i: number): boolean;
  ready(i: number): boolean;
  card(i: number): boolean;
  online: boolean;
}

export type ReplayEvent =
  | { type: "play" }
  | { type: "hold" }
  | { type: "toggle" }
  | { type: "due" }
  | { type: "cardOver" }
  | { type: "drawn"; index: number }
  | { type: "gone"; index: number }
  | { type: "waitedOut" }
  | { type: "scrubStart"; by: "strip" | "dial" }
  | { type: "scrubTo"; index: number; by: ReplaySource }
  | { type: "scrubEnd" }
  | { type: "step"; by: -1 | 1; source: "tap" | "vo" }
  | { type: "rest" }
  | { type: "away" };

/** The next print after `i` that is not gone, or null. */
function nextShown(i: number, ctx: ReducerContext): number | null {
  for (let j = i + 1; j < ctx.n; j++) if (!ctx.gone(j)) return j;
  return null;
}

/** The first print that is not gone, or null. */
function firstShown(ctx: ReducerContext): number | null {
  return nextShown(-1, ctx);
}

/** A replay opening at `start`: playing, the first print shown, with its card if it begins a group that has one. */
export function replayInit(start: number, ctx: ReducerContext): ReplayState {
  const index = Math.max(0, Math.min(Math.max(0, ctx.n - 1), start));
  return {
    index,
    phase: "playing",
    wait: ctx.card(index) ? "card" : null,
    pending: null,
    scrubbing: null,
    fresh: true,
    source: "clock",
    shown: 0,
    centre: index,
  };
}

function heldFrom(s: ReplayState): ReplayState {
  return { ...s, phase: "held", wait: null, pending: null };
}

/** Moved on by the clock to print `i`, shown now. */
function advance(s: ReplayState, i: number, wait: null | "card"): ReplayState {
  return { ...s, index: i, wait, pending: null, fresh: false, source: "clock", shown: s.shown + 1, centre: i };
}

/** On from the print in front, as its time is up: past those gone, to the end, a card, the next, or a wait for it. */
function due(s: ReplayState, ctx: ReducerContext): ReplayState {
  const next = nextShown(s.index, ctx);
  if (next == null) return { ...s, phase: "ended", wait: null, pending: null, centre: s.index };
  if (ctx.card(next)) return advance(s, next, "card");
  if (ctx.ready(next) || !ctx.online) return advance(s, next, null);
  return { ...s, wait: "image", pending: next };
}

/** Where a press of play goes: on from here, or from the first print again at the end. */
function play(s: ReplayState, ctx: ReducerContext): ReplayState {
  if (s.phase === "playing") return s;
  const atEnd = s.phase === "ended" || nextShown(s.index, ctx) == null;
  if (atEnd) {
    const first = firstShown(ctx);
    if (first == null) return s;
    return {
      ...s,
      index: first,
      phase: "playing",
      wait: ctx.card(first) ? "card" : null,
      pending: null,
      scrubbing: null,
      fresh: true,
      source: "clock",
      shown: s.shown + 1,
      centre: first,
    };
  }
  return { ...s, phase: "playing", wait: null, pending: null, scrubbing: null, fresh: true, shown: s.shown + 1, centre: s.index };
}

/**
 * The replay's states. Playing, a print stays its dwell (the hook's
 * clock), then `due` moves on: past prints known to be gone, onto a
 * title card first where its group has one, onto the next print if its
 * image has drawn (or failed, or the phone is offline, so nothing is
 * coming), or waits for it (`drawn`, or `waitedOut` after
 * `READY_WAIT_MS`). Any touch on the gate, the strip or the dial, a
 * VoiceOver step, and the app or the room going out of view hold it; only
 * the dial's centre, or VoiceOver's Play, plays. Played from the last
 * print, or after the end, it starts again from the first.
 */
export function replayReducer(s: ReplayState, e: ReplayEvent, ctx: ReducerContext): ReplayState {
  switch (e.type) {
    case "play":
      return play(s, ctx);
    case "hold":
      return s.phase === "playing" ? heldFrom(s) : s;
    case "toggle":
      return s.phase === "playing" ? heldFrom(s) : play(s, ctx);
    case "due":
      return s.phase === "playing" && s.wait == null ? due(s, ctx) : s;
    case "cardOver":
      return s.phase === "playing" && s.wait === "card" ? { ...s, wait: null, shown: s.shown + 1 } : s;
    case "drawn":
      return s.phase === "playing" && s.wait === "image" && s.pending === e.index ? advance(s, e.index, null) : s;
    case "gone":
      // The photograph waited for has gone: on past it at once.
      return s.phase === "playing" && s.wait === "image" && s.pending === e.index ? due({ ...s, wait: null, pending: null }, ctx) : s;
    case "waitedOut":
      return s.phase === "playing" && s.wait === "image" && s.pending != null ? advance(s, s.pending, null) : s;
    case "scrubStart":
      return { ...s, phase: "held", wait: null, pending: null, scrubbing: e.by };
    case "scrubTo": {
      const index = Math.max(0, Math.min(ctx.n - 1, Math.round(e.index)));
      const held = s.phase === "held" ? s : heldFrom(s);
      if (index === s.index && held === s) return s;
      return index === s.index ? held : { ...held, index, source: e.by, shown: s.shown + 1 };
    }
    case "scrubEnd":
      return s.scrubbing == null ? s : { ...s, scrubbing: null };
    case "step": {
      let to = s.index;
      for (let j = s.index + e.by; j >= 0 && j < ctx.n; j += e.by) {
        if (!ctx.gone(j)) {
          to = j;
          break;
        }
      }
      const held = heldFrom(s);
      return to === s.index ? held : { ...held, index: to, source: e.source, shown: s.shown + 1 };
    }
    case "rest":
      return s.phase === "playing" || s.centre === s.index ? s : { ...s, centre: s.index };
    case "away":
      return s.phase === "playing" ? heldFrom(s) : s;
  }
}
