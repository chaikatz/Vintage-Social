/**
 * Understated relative timestamps, in the spirit of early photo-sharing apps:
 * "3m", "2h", "5d", then absolute dates for anything older than a week.
 */
export function postAge(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const seconds = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 1000));

  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const sameYear = then.getFullYear() === now.getFullYear();
  const month = MONTHS[then.getMonth()];
  return sameYear ? `${month} ${then.getDate()}` : `${month} ${then.getDate()}, ${then.getFullYear()}`;
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
