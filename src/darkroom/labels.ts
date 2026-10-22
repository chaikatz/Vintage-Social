import { anniversary } from "./discovery";
import type { DarkroomMode, DayReach } from "./types";

/**
 * The words under a print, set like an archive's catalogue rather than an
 * app's metadata: the date in tracked capitals, and a quiet line that
 * says how long ago, in words.
 *
 * Every caption is a true fact about the photograph. Seasons are not
 * used: summer in Lisbon is winter in Melbourne, and the library does not
 * say which side of the world a photograph was taken on without reading
 * its location — which VINTAGE does not do. The month always is true.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const UNITS = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/** "August" */
export function monthName(m: number): string {
  return MONTHS[((m % 12) + 12) % 12];
}

/** "JAN" … "DEC" */
export const MONTH_INITIALS: string[] = MONTHS.map((m) => m.slice(0, 3).toUpperCase());

/** "AUGUST 2018" */
export function monthYear(ms: number): string {
  return monthYearWords(ms).toUpperCase();
}

/** "August 2018" */
export function monthYearWords(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "August 14, 2018" */
export function fullDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** "October 22" */
export function monthDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "OCT 22" */
export function shortDay(ms: number): string {
  const d = new Date(ms);
  return `${MONTH_INITIALS[d.getMonth()]} ${d.getDate()}`;
}

/** "Sunday" */
export function weekday(ms: number): string {
  return WEEKDAYS[new Date(ms).getDay()];
}

/**
 * "1,204". Grouped by hand rather than through `toLocaleString`, which
 * depends on how much of Intl the JavaScript engine was built with.
 */
export function countLabel(n: number): string {
  const whole = Math.trunc(n);
  const digits = String(Math.abs(whole)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return whole < 0 ? `-${digits}` : digits;
}

/** "One" … "Ninety-nine", then the number. */
export function yearsInWords(n: number): string {
  if (!Number.isInteger(n) || n < 1 || n > 99) return String(n);
  if (n < 20) return UNITS[n];
  const tens = TENS[Math.floor(n / 10)];
  const unit = n % 10;
  return unit === 0 ? tens : `${tens}-${UNITS[unit].toLowerCase()}`;
}

/** Whole years between a capture and now, counting a year only once its anniversary has passed. */
function elapsedYears(ms: number, now: number): number {
  const a = new Date(ms);
  const b = new Date(now);
  let years = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) years -= 1;
  return Math.max(0, years);
}

function yearsAgo(n: number): string {
  return n === 1 ? "One year ago" : `${yearsInWords(n)} years ago`;
}

/**
 * How long ago, for a print found by any way in but On This Day.
 *
 *   "Eleven years ago"     a year or more, counted by the anniversary
 *   "Last year"            under a year, but in last calendar year
 *   "Earlier this year"    this calendar year
 *
 * The calendar decides the last two, so December's photograph is never
 * "earlier this year" in October.
 */
function agoLine(ms: number, now: number): string {
  const years = elapsedYears(ms, now);
  if (years >= 1) return yearsAgo(years);
  return new Date(ms).getFullYear() === new Date(now).getFullYear() ? "Earlier this year" : "Last year";
}

/** Calendar days between two local dates, whatever the clocks did in between. */
function daysApart(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round(Math.abs(ua - ub) / 86_400_000);
}

/**
 * The anniversary of today nearest a print, and how many days it lies
 * from it. Near the new year the nearest one can be in the next or the
 * previous calendar year: a photograph from the 30th of December 2019,
 * found on the 2nd of January, belongs to 2020's anniversary.
 */
function nearestAnniversary(ms: number, now: number): { year: number; days: number } {
  const d = new Date(ms);
  const today = new Date(now);
  let best = { year: d.getFullYear(), days: Infinity };
  for (const year of [d.getFullYear() - 1, d.getFullYear(), d.getFullYear() + 1]) {
    const days = daysApart(d, anniversary(year, today.getMonth(), today.getDate()));
    if (days < best.days) best = { year, days };
  }
  return best;
}

/**
 * The two lines under a print, by the way in it was found.
 *
 *   On this day   OCTOBER 22, 2019    Seven years ago today | … this week | …, around this time
 *   Surprise      AUGUST 2014         Twelve years ago | Last year | Earlier this year
 *   By year       AUGUST 14, 2016     A Sunday
 *   Set aside     AUGUST 2016         Ten years ago
 *
 * On This Day counts years by the anniversary the print was found near —
 * today's year less that one — so every print in a week reads the same
 * number. Whether it reads "today", "this week" or "around this time" is
 * the print's own distance from that anniversary: a print from the 28th
 * of February found on the 29th is today's, and a print found at the day
 * reach is always today's. A photograph already posted from this phone
 * says when at the end of the second line; `long` says the line will
 * likely need two lines of type.
 */
export function captionFor(
  ms: number,
  now: number,
  mode: DarkroomMode,
  reach: DayReach | null,
  postedAt: number | null,
): { label: string; line: string; long: boolean } {
  let label: string;
  let line: string;
  if (mode === "on-this-day") {
    label = fullDate(ms).toUpperCase();
    const near = nearestAnniversary(ms, now);
    const years = new Date(now).getFullYear() - near.year;
    if (years < 1) {
      line = agoLine(ms, now);
    } else if (reach === "day" || near.days === 0) {
      line = `${yearsAgo(years)} today`;
    } else if (near.days <= 3) {
      line = `${yearsAgo(years)} this week`;
    } else {
      line = `${yearsAgo(years)}, around this time`;
    }
  } else if (mode === "year") {
    label = fullDate(ms).toUpperCase();
    line = `A ${weekday(ms)}`;
  } else {
    label = monthYear(ms);
    line = agoLine(ms, now);
  }
  if (postedAt != null) return { label, line: `${line} · posted in ${monthYearWords(postedAt)}`, long: true };
  return { label, line, long: false };
}
