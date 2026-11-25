import { anniversary } from "@/darkroom/discovery";
import { countLabel, MONTH_INITIALS } from "@/darkroom/labels";
import type { TodaysPrint } from "@/components/onThisDayPrint";
import type { LibrarySource, Print, TimeRange } from "@/darkroom/types";

/**
 * The Post tab's On this day door: how many photographs the member took
 * on today's date in earlier years, which years, and a few of them to
 * fan out on the door.
 *
 * Read from the library in bounded questions, as the Memory Room reads
 * it: when the oldest photograph was taken (once), a count for each
 * earlier year of today's date, last year first, thirty years at most
 * (a count reads no photographs at all), then the first few photographs
 * of the newest three years that have any. At most 1 + 30 + 3 questions,
 * no more than two outstanding at once, and the caller's signal looked
 * at between them: an abort stops the next question and rejects, as a
 * failure does, so neither is ever read as "none".
 */

/** Years looked back through, at most. */
export const DOOR_YEARS = 30;
/** Years whose photographs are fanned on the door. */
export const DOOR_COVERS = 3;
/** Photographs read from each of those years, to find one that is not a screenshot. */
const COVER_PAGE = 6;
/** Questions outstanding at once, as the room's gate allows. */
const AT_ONCE = 2;

export interface DayDoorRead {
  /** Photographs taken on today's date in earlier years. */
  total: number;
  /** The oldest and newest of those years; null when there are none. */
  firstYear: number | null;
  lastYear: number | null;
  /** One photograph from each of the newest years that have any, newest year first. */
  covers: Print[];
}

/** Today's date in `year`, local midnight to the next: the 29th of February is the 28th in a common year. */
export function dayRange(year: number, month: number, date: number): TimeRange {
  const d = anniversary(year, month, date);
  return {
    from: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime(),
    to: new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
  };
}

function stopped(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("The On this day door was left.");
}

/** `task` for each item, two at a time, in order; the signal is looked at before each. */
async function inTurn<T, R>(items: readonly T[], task: (item: T) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  // A question that failed stops the other line too: the answer is thrown away whole.
  let failed = false;
  const worker = async () => {
    while (next < items.length && !failed) {
      stopped(signal);
      const i = next++;
      try {
        out[i] = await task(items[i]);
      } catch (e) {
        failed = true;
        throw e;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, worker));
  stopped(signal);
  return out;
}

/** The years looked in: last year first, back to the oldest photograph's, thirty at most. */
export function doorYears(today: Date, oldest: number | null): number[] {
  if (oldest == null || !Number.isFinite(oldest)) return [];
  const thisYear = today.getFullYear();
  const first = Math.max(new Date(oldest).getFullYear(), thisYear - DOOR_YEARS);
  const out: number[] = [];
  for (let year = thisYear - 1; year >= first && out.length < DOOR_YEARS; year--) out.push(year);
  return out;
}

export async function readDayDoor(source: LibrarySource, today: Date, signal?: AbortSignal): Promise<DayDoorRead> {
  stopped(signal);
  const oldest = await source.oldest();
  stopped(signal);
  const years = doorYears(today, oldest);
  const month = today.getMonth();
  const date = today.getDate();
  const counts = await inTurn(years, (year) => source.count(dayRange(year, month, date)), signal);
  const found = years.map((year, i) => ({ year, count: counts[i] })).filter((y) => y.count > 0);
  if (found.length === 0) return { total: 0, firstYear: null, lastYear: null, covers: [] };
  const newest = found.slice(0, DOOR_COVERS);
  const pages = await inTurn(
    newest,
    (y) => source.page({ range: dayRange(y.year, month, date), first: COVER_PAGE, order: "asc" }),
    signal,
  );
  const covers = pages
    .map((page) => page.prints.find((p) => !p.subtypes.includes("screenshot")) ?? page.prints[0])
    .filter((p): p is Print => p != null);
  return {
    total: found.reduce((sum, y) => sum + y.count, 0),
    firstYear: found[found.length - 1].year,
    lastYear: found[0].year,
    covers,
  };
}

export type DayDoorKind = "fan" | "post" | "leaf";

export interface DayDoorFace {
  kind: DayDoorKind;
  line: string;
  sub: string | null;
  /** What VoiceOver says for the door. */
  spoken: string;
  /** The fan's photographs, in the order they are drawn: the oldest first, so the newest lies on top. */
  covers: Print[];
  memory: TodaysPrint | null;
  /** The leaf of a desk calendar: "NOV" over "25". */
  leafMonth: string;
  leafDay: number;
}

/**
 * The door's face. The library's count when there is one ("6
 * photographs", "2012 – 2025"); else the member's own post from this date
 * in an earlier year, by its sentence; else the leaf of a calendar,
 * "Every year, on this date." — which is also the face while it is read,
 * where the library may not be read, and when the reading failed, so a
 * failure never reads as "0 photographs". The door is the same size
 * whichever face it shows.
 */
export function dayDoorFace(p: {
  library: DayDoorRead | null | "failed";
  memory: TodaysPrint | null;
  today: Date;
}): DayDoorFace {
  const leafMonth = MONTH_INITIALS[p.today.getMonth()];
  const leafDay = p.today.getDate();
  const lib = p.library && p.library !== "failed" ? p.library : null;
  if (lib && lib.total > 0 && lib.firstYear != null && lib.lastYear != null) {
    const n = lib.total;
    const noun = n === 1 ? "photograph" : "photographs";
    const one = lib.firstYear === lib.lastYear;
    const sub = one ? String(lib.lastYear) : `${lib.firstYear} – ${lib.lastYear}`;
    const spokenYears = one ? `${lib.lastYear}` : `${lib.firstYear} to ${lib.lastYear}`;
    return {
      kind: "fan",
      line: `${countLabel(n)} ${noun}`,
      sub,
      spoken: `On this day. ${countLabel(n)} ${noun}, ${spokenYears}.`,
      covers: [...lib.covers].reverse(),
      memory: null,
      leafMonth,
      leafDay,
    };
  }
  if (p.memory) {
    return {
      kind: "post",
      line: p.memory.headline,
      sub: null,
      spoken: `On this day. ${p.memory.headline}`,
      covers: [],
      memory: p.memory,
      leafMonth,
      leafDay,
    };
  }
  return {
    kind: "leaf",
    line: "Every year, on this date.",
    sub: null,
    spoken: "On this day. Every year, on this date.",
    covers: [],
    memory: null,
    leafMonth,
    leafDay,
  };
}
