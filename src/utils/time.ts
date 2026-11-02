/**
 * How long ago something was, in the one unit worth saying: under a
 * minute, then minutes, hours and days, and after a week the day itself.
 * A time ahead of the phone's clock, as on a phone whose clock runs slow,
 * counts as under a minute. Every way of saying an age below reads it from
 * here, so they never disagree about where a minute ends.
 */
type Age =
  | { unit: "now" }
  | { unit: "minutes" | "hours" | "days"; count: number }
  | { unit: "date"; then: Date; sameYear: boolean };

function ageOf(iso: string, now: Date): Age {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));

  if (seconds < 60) return { unit: "now" };
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return { unit: "minutes", count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", count: hours };
  const days = Math.floor(hours / 24);
  if (days < 7) return { unit: "days", count: days };

  return { unit: "date", then, sameYear: then.getFullYear() === now.getFullYear() };
}

/** `Oct 3` this year and `Oct 3, 2025` before it; `October 3` with the long months. */
function dayOf({ then, sameYear }: { then: Date; sameYear: boolean }, months: readonly string[]): string {
  const day = `${months[then.getMonth()]} ${then.getDate()}`;
  return sameYear ? day : `${day}, ${then.getFullYear()}`;
}

/**
 * Understated relative timestamps, in the spirit of early photo-sharing apps:
 * "3m", "2h", "5d", then absolute dates for anything older than a week.
 */
export function postAge(iso: string, now: Date = new Date()): string {
  const age = ageOf(iso, now);
  switch (age.unit) {
    case "now":
      return "now";
    case "minutes":
      return `${age.count}m`;
    case "hours":
      return `${age.count}h`;
    case "days":
      return `${age.count}d`;
    case "date":
      return dayOf(age, MONTHS);
  }
}

/**
 * When a post went up, as the last line of its card says it: "Just now",
 * "29m ago", "5h ago", "3d ago", then the day it was posted, "Oct 3", with
 * the year once it was another year. The same reckoning as `postAge`,
 * which keeps its shorter words for the screens that use them.
 */
export function postedAgo(iso: string, now: Date = new Date()): string {
  const age = ageOf(iso, now);
  switch (age.unit) {
    case "now":
      return "Just now";
    case "minutes":
      return `${age.count}m ago`;
    case "hours":
      return `${age.count}h ago`;
    case "days":
      return `${age.count}d ago`;
    case "date":
      return dayOf(age, MONTHS);
  }
}

/** `postedAgo` as a screen reader says it: "Posted 29 minutes ago", "Posted October 3". */
export function postedAgoSpoken(iso: string, now: Date = new Date()): string {
  const age = ageOf(iso, now);
  switch (age.unit) {
    case "now":
      return "Posted just now";
    case "minutes":
      return `Posted ${counted(age.count, "minute")} ago`;
    case "hours":
      return `Posted ${counted(age.count, "hour")} ago`;
    case "days":
      return `Posted ${counted(age.count, "day")} ago`;
    case "date":
      return `Posted ${dayOf(age, MONTHS_LONG)}`;
  }
}

/** `1 minute`, `29 minutes`. */
function counted(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * The date-stamp caption burned into film-camera prints: `’95 8 28` style
 * was common, but we render the friendlier `8 28 ’26`.
 */
export function dateStampText(iso: string): string {
  const d = new Date(iso);
  const year = String(d.getFullYear() % 100).padStart(2, "0");
  return `${d.getMonth() + 1} ${d.getDate()} ’${year}`;
}

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The date as it is written on the back of a print: `August 14, 2019`.
 * Rendered in upper-case tracked mono where it appears, so the casing
 * here is the readable one.
 */
export function signatureDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS_LONG[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/**
 * `August 14, 2019 · Los Angeles` — the signature detail of a photograph on
 * VINTAGE. The date is the capture date wherever the file carried one;
 * only a photograph with no capture date falls back to the day it was
 * posted, which is then the best anyone knows.
 */
export function signatureLine(post: {
  taken_at: string | null;
  created_at: string;
  location: string | null;
}): string {
  const date = signatureDate(post.taken_at ?? post.created_at);
  const place = post.location?.trim();
  return place ? `${date} · ${place}` : date;
}

/** `Jan 23, 2003` — the date as it sits after a place: `NYC · Jan 23, 2003`. */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
