import type { DayReach, Print } from "./types";

/**
 * Which photographs are worth showing, how much weight each one carries,
 * and how a run of near-identical frames is read as one.
 *
 * Only what the library already says about a photograph is used — its
 * shape, its size, its subtype, the shape of its file name, when it was
 * taken. Nothing looks at the pixels, so nothing here claims to know
 * what a picture is of.
 *
 * Every number the Darkroom's choosing depends on is in the block below,
 * so the rules can be read, and argued with, in one place.
 */

// ---------------------------------------------------------------------------
// The rules
// ---------------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;

// What is a photograph -------------------------------------------------------

/** Smaller than this on its short side is a thumbnail, a saved icon, a sticker. */
export const MIN_SHORT_SIDE = 320;
/** Narrower than 1:2 and not a panorama is the shape of a phone screen, not a camera's frame. */
export const MIN_SHAPE = 0.5;
/**
 * The full-screen sizes of the iPhones since the 5, short side first. A
 * picture exactly this size is a screen that was saved, whatever its
 * subtype says.
 */
export const SCREEN_SIZES: readonly (readonly [number, number])[] = [
  [640, 1136], [750, 1334], [828, 1792], [1080, 1920], [1125, 2436], [1170, 2532], [1179, 2556],
  [1206, 2622], [1242, 2208], [1242, 2688], [1284, 2778], [1290, 2796], [1320, 2868],
];
/** Cameras write HEIC, JPEG or DNG. A PNG, a GIF or a WebP in the roll is a saved graphic, a meme, a screen. */
export const NOT_A_CAMERA = /\.(png|gif|webp)$/i;
/** Dates before this are a missing date, not an old photograph. */
export const EARLIEST_PLAUSIBLE = new Date(1900, 0, 1).getTime();
/** A clock that was never set reads as the first of January 1970, give or take a time zone. */
export const EPOCH_GUARD_MS = 36 * HOUR;
/** Photos' own reference date, which an app that lost the real date sometimes writes instead. */
export const REFERENCE_DATE = Date.UTC(2001, 0, 1);
/** Newer than this is not a rediscovery yet. */
export const REDISCOVERY_AGE_DAYS = 90;

// How much a photograph weighs ----------------------------------------------

/** Names a camera never gives: a messaging app's copy, a file named by its UUID, a bare "image.jpg". */
export const SECOND_HAND_NAMES: readonly RegExp[] = [/-WA\d+/i, /^[0-9A-F]{8}-[0-9A-F]{4}-/i, /^image\.(jpe?g|heic)$/i];
export const Q_SECOND_HAND = 0.35;
/** Below its era's floor a photograph is probably a copy, sent and shrunk. No floor before 2008. */
export const RESOLUTION_FLOORS: readonly { from: number; megapixels: number }[] = [
  { from: 2013, megapixels: 1.5 },
  { from: 2008, megapixels: 0.8 },
];
export const Q_LOW_RESOLUTION = 0.5;
/** A panorama, or anything longer than this, is hard to see on a phone held upright. */
export const LONG_SHAPE = 3;
export const Q_LONG = 0.6;

// Moments and occasions -------------------------------------------------------

/** Frames this close together are one moment: a burst, or the same shot taken again. */
export const MOMENT_GAP_MS = 90_000;
/**
 * However closely its frames follow one another, a moment lasts no longer
 * than this. Without the bound a concert shot every minute for three
 * hours chains into a single moment and shows as one picture; with it,
 * that evening is many moments of one occasion, and the chapters' own
 * spacing rules decide how many of them to show.
 */
export const MOMENT_SPAN_MS = 5 * MINUTE;
/*
 * Moments within three hours of each other are one occasion. No chapter
 * needs the grouping itself: each keeps occasions apart by its own
 * spacing (45 minutes in On This Day, 2 hours in a year, 6 hours in
 * Surprise), and the one occasion the Darkroom must recognise outright
 * is an import pile.
 */
/** This many frames in one second are an import, not a burst: a folder of scans that all lost their dates. */
export const PILE_FRAMES = 20;
/** Of an import pile, at most this many are ever shown. */
export const PILE_SHOWN = 2;

// On this day ---------------------------------------------------------------

/** How far On This Day reaches, in days either side of the anniversary, in order. */
export const DAY_REACHES: readonly { reach: DayReach; days: number }[] = [
  { reach: "day", days: 0 },
  { reach: "week", days: 3 },
  { reach: "season", days: 14 },
];
/** The day itself is one page this long. */
export const DAY_FIRST = 150;
/** A day that holds more is read on in slices this wide, from where that page stopped, so its afternoon is never lost. */
export const DAY_OVERFLOW_SLICE_MS = 3 * HOUR;
export const DAY_OVERFLOW_FIRST = 20;
/** A wider window is read in this many equal slices, each a page this long. */
export const WIDE_SLICES = 3;
export const WIDE_FIRST = 50;
/** Fewer moments than this across all the years, and On This Day reaches further. Also what the day must hold to open the room. */
export const ON_THIS_DAY_MINIMUM = 3;
/** At most this many from any one year, at least this far apart. */
export const PER_YEAR = 4;
export const PER_YEAR_GAP_MS = 45 * MINUTE;
/** On This Day is never longer than this. */
export const ON_THIS_DAY_CAP = 40;
/**
 * Up to this many years back, On This Day reads every year's anniversary
 * straight away. A library whose oldest photograph is further back than
 * that (a single scan dated 1904, say) has its decades counted first, so
 * the first print is not kept waiting behind a hundred empty years.
 */
export const DAY_DIRECT_YEARS = 30;

// Surprise me -----------------------------------------------------------------

/** A roll is this many prints, then an end page. */
export const ROLL_LENGTH = 24;
/** A year joins the pool with at least this many photographs. Smaller years are used only when nothing else is left. */
export const POOL_MIN_COUNT = 3;
/** Older years weigh a little more: this much per year of age, up to `AGE_LEAN_YEARS`. */
export const AGE_LEAN = 0.1;
export const AGE_LEAN_YEARS = 15;
/** The first picks of a visit are drawn from the whole span of the library, before any year has been counted. */
export const COLD_START_PICKS = 2;
/** Frames read either side of a drawn moment, and how many eligible ones make the far side unnecessary. */
export const READ_AROUND = 40;
export const READ_AROUND_ENOUGH = 6;
/**
 * A moment further than this from the nearest frame before it has landed
 * in a gap between occasions. The frames after it are read too, so the
 * occasion on the far side has the same chance as the one before, and
 * the whole gap is learned at once and drawn from no more.
 */
export const READ_ACROSS_GAP_MS = DAY_MS;
/** Seen within this many days, a print waits; the window halves, step by step, when nothing else is left. */
export const QUIET_LADDER: readonly number[] = [21, 10, 5, 0];
/** Two picks closer than this are the same occasion; a pick is kept this far from each of the last few. */
export const SAME_OCCASION_MS = 6 * HOUR;
export const OCCASION_MEMORY = 8;
/** Tries at each step before a rule is relaxed. */
export const ATTEMPTS_PER_STEP = 6;
/** A year that yields nothing usable this many times running is put away for the visit. */
export const BARREN_LIMIT = 3;

// By year ---------------------------------------------------------------------

/** An edit of a year of N photographs is about 2.5·√N prints, at least 12 (or all of a small year), at most 120. */
export const EDIT_SCALE = 2.5;
export const EDIT_MIN = 12;
export const EDIT_MAX = 120;
/** Each slot of a month is a time slice, read as one page this long. */
export const SLICE_FIRST = 40;
/** Where possible, a pick is this far from the one before it. */
export const EDIT_GAP_MS = 2 * HOUR;
/** A print seen within this many days is passed over in a slice that has another. */
export const EDIT_QUIET_DAYS = 21;
/** Months are built this far ahead of the one being read. */
export const BUILD_AHEAD_MONTHS = 2;

// The library -------------------------------------------------------------------

/** No page is longer than this. */
export const MAX_PAGE = 150;
/** No more than this many questions are put to the library at once. */
export const MAX_IN_FLIGHT = 4;

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

const SCREENS = new Set(SCREEN_SIZES.map(([s, l]) => `${s}x${l}`));

/**
 * Whether a photograph may be shown at all.
 *
 * Old dates are welcome — a scanned print from 1958 is exactly what the
 * Darkroom is for — but a date that says "unknown" is not a date: before
 * 1900, the first of January 1970 within a time zone of it, or the very
 * first instant of 2001. The 90-day rule applies only when `now` is
 * given, and not in the one place recent photographs belong (a year
 * chapter that reaches into the last few months).
 */
export function isEligible(print: Print, opts: { now?: number; allowRecent?: boolean } = {}): boolean {
  const t = print.takenAt;
  if (!Number.isFinite(t) || t < EARLIEST_PLAUSIBLE) return false;
  if (Math.abs(t) <= EPOCH_GUARD_MS || t === REFERENCE_DATE) return false;
  if (opts.now != null && !opts.allowRecent && t > opts.now - REDISCOVERY_AGE_DAYS * DAY_MS) return false;
  if (print.subtypes.includes("screenshot")) return false;
  if (print.filename && NOT_A_CAMERA.test(print.filename)) return false;
  const { width, height } = print;
  if (!(width > 0 && height > 0)) return false;
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (short < MIN_SHORT_SIDE) return false;
  if (short / long < MIN_SHAPE && !print.subtypes.includes("panorama")) return false;
  if (SCREENS.has(`${short}x${long}`)) return false;
  return true;
}

/**
 * How much a photograph weighs when one is chosen at random from several:
 * 1 for a camera's own frame, less for a copy that came back through a
 * messaging app, one too small for its era, or one too long to see.
 * Never zero — a lighter photograph is chosen less often, never refused.
 */
export function quality(print: Print): number {
  let q = 1;
  const name = print.filename;
  if (name && SECOND_HAND_NAMES.some((r) => r.test(name))) q *= Q_SECOND_HAND;
  const year = new Date(print.takenAt).getFullYear();
  const floor = RESOLUTION_FLOORS.find((f) => year >= f.from);
  if (floor && (print.width * print.height) / 1e6 < floor.megapixels) q *= Q_LOW_RESOLUTION;
  const short = Math.min(print.width, print.height);
  const long = Math.max(print.width, print.height);
  if (print.subtypes.includes("panorama") || (short > 0 && long / short > LONG_SHAPE)) q *= Q_LONG;
  return q;
}

/** "tall", "wide" or "square": what Surprise alternates between. */
export function shapeOf(print: Print): "tall" | "wide" | "square" {
  return print.height > print.width ? "tall" : print.width > print.height ? "wide" : "square";
}

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

/** Capture order, and of frames taken in the same instant, a fixed one. */
export function byTime(a: Print, b: Print): number {
  return a.takenAt - b.takenAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

const second = (p: Print) => Math.floor(p.takenAt / 1000);

/**
 * The frame that stands for a moment: the largest, and of equals the last
 * — the one taken after the camera was settled, usually the keeper.
 */
export function representative(run: readonly Print[]): Print {
  let best = run[0];
  for (const p of run) {
    const area = p.width * p.height;
    const bestArea = best.width * best.height;
    if (area > bestArea || (area === bestArea && byTime(p, best) >= 0)) best = p;
  }
  return best;
}

/** Frames that follow one another within `MOMENT_GAP_MS`, grouped, none lasting longer than `MOMENT_SPAN_MS`. Input in capture order. */
function runs(sorted: readonly Print[]): Print[][] {
  const out: Print[][] = [];
  for (const p of sorted) {
    const run = out[out.length - 1];
    if (run && p.takenAt - run[run.length - 1].takenAt <= MOMENT_GAP_MS && p.takenAt - run[0].takenAt <= MOMENT_SPAN_MS) {
      run.push(p);
    } else {
      out.push([p]);
    }
  }
  return out;
}

/** The frames of an import pile worth showing: the weightiest, then the largest. */
function fromPile(pile: readonly Print[]): Print[] {
  return [...pile]
    .sort((a, b) => quality(b) - quality(a) || b.width * b.height - a.width * a.height || byTime(a, b))
    .slice(0, PILE_SHOWN)
    .sort(byTime);
}

/**
 * One frame per moment, in capture order.
 *
 * An import pile — twenty or more frames stamped with the same second —
 * is not a burst: it is a folder of different photographs that all lost
 * their dates on the way in. Read as a burst it would show as one; read
 * frame by frame it would fill a chapter. So it is one occasion, and at
 * most two of it are kept. Frames read twice (two overlapping pages) are
 * counted once.
 */
export function condense(prints: readonly Print[]): Print[] {
  const unique = new Map<string, Print>();
  for (const p of prints) if (!unique.has(p.id)) unique.set(p.id, p);
  const sorted = [...unique.values()].sort(byTime);
  const bySecond = new Map<number, Print[]>();
  for (const p of sorted) {
    const s = second(p);
    const group = bySecond.get(s);
    if (group) group.push(p);
    else bySecond.set(s, [p]);
  }
  const out: Print[] = [];
  const rest: Print[] = [];
  for (const p of sorted) {
    const group = bySecond.get(second(p))!;
    if (group.length < PILE_FRAMES) rest.push(p);
    else if (group[0] === p) out.push(...fromPile(group));
  }
  for (const run of runs(rest)) out.push(representative(run));
  return out.sort(byTime);
}

/** The second a print was taken in, for counting how many of one pile have been shown. */
export function pileKey(print: Print): number {
  return second(print);
}
