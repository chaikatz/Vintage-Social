/**
 * The words under a print, set like an archive's catalogue rather than an
 * app's metadata: the month and year in tracked capitals, and a quiet line
 * that says how long ago, in words.
 *
 * Seasons are not used: summer in Lisbon is winter in Melbourne, and the
 * library does not say which side of the world a photograph was taken on
 * without reading its location — which VINTAGE does not do.
 */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const WORDS = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten",
  "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen", "Twenty",
];

/** "AUGUST 2018" */
export function monthYear(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()].toUpperCase()} ${d.getFullYear()}`;
}

/** "August 14, 2018" */
export function fullDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Whole calendar years between a capture and now, counting a year only once its anniversary has passed. */
export function yearsBetween(ms: number, now: number): number {
  const a = new Date(ms);
  const b = new Date(now);
  let years = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) years -= 1;
  return Math.max(0, years);
}

/** "One" … "Twenty", then the number. */
export function yearsInWords(n: number): string {
  return n >= 1 && n <= 20 ? WORDS[n] : String(n);
}

/**
 * The quiet line under the date.
 *   "Seven years ago"            in general
 *   "Seven years ago today"      on the day itself
 *   "Earlier this year"          under a year old
 */
export function agoLine(ms: number, now: number, onTheDay = false): string {
  const years = yearsBetween(ms, now);
  if (years < 1) return "Earlier this year";
  const head = years === 1 ? "One year ago" : `${yearsInWords(years)} years ago`;
  return onTheDay ? `${head} today` : head;
}

/** Whether a capture falls on today's month and day. */
export function sameCalendarDay(ms: number, now: number): boolean {
  const a = new Date(ms);
  const b = new Date(now);
  return a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "1,204" */
export function countLabel(n: number): string {
  return n.toLocaleString("en-US");
}
