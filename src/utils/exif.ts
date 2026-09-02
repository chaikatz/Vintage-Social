/**
 * Reading the capture date out of a picked photograph.
 *
 * The date stamp is supposed to say when the photograph was taken, not when
 * it was posted — a stamp reading today's date on a picture from last summer
 * is just wrong. iOS hands expo-image-picker a flattened EXIF dictionary; the
 * capture date lives under one of a few keys depending on the camera that
 * wrote the file, and always in EXIF's own `YYYY:MM:DD HH:MM:SS` format,
 * which `new Date()` does not parse.
 *
 * Everything here is deliberately forgiving: a photograph with no usable
 * capture date is normal (screenshots, most videos, anything re-saved by an
 * editor), and the caller falls back to the posting time.
 */

/** EXIF keys that carry a capture date, most trustworthy first. */
const DATE_KEYS = [
  "DateTimeOriginal", // when the shutter fired
  "DateTimeDigitized", // when it was digitised — same thing for a digital camera
  "{Exif}DateTimeOriginal",
  "DateTime", // last modification; a weak fallback, but better than "today"
] as const;

/** `2019:07:04 18:32:10` — EXIF's format, which Date() rejects. */
const EXIF_DATE = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;

/**
 * Parse one EXIF date string into an ISO timestamp.
 *
 * EXIF carries no timezone, so the value is read as local time — which is
 * what the photographer's camera meant by it, and all the date stamp needs.
 */
export function parseExifDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = EXIF_DATE.exec(value.trim());
  if (!m) return null;
  const [, year, month, day, hour, minute, second] = m;
  const date = new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  if (Number.isNaN(date.getTime())) return null;
  // Date() silently rolls impossible values over — month 13 becomes January
  // of the next year, day 31 of a 30-day month becomes the 1st. A stamp is
  // better absent than quietly wrong, so insist the parts came back intact.
  if (
    date.getFullYear() !== Number(year) ||
    date.getMonth() !== Number(month) - 1 ||
    date.getDate() !== Number(day) ||
    date.getHours() !== Number(hour) ||
    date.getMinutes() !== Number(minute)
  ) {
    return null;
  }
  return plausibleCaptureDate(date);
}

/**
 * A capture date worth stamping, or null.
 *
 * A camera with a dead battery-backup clock writes 1970 or 2000-01-01, and a
 * date in the future is just as suspect. Neither is worth printing in amber
 * across the corner of someone's photograph, so both fall back to the
 * posting time.
 */
export function plausibleCaptureDate(date: Date): string | null {
  const time = date.getTime();
  if (Number.isNaN(time)) return null;
  if (date.getFullYear() < 1900) return null;
  if (time > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

/** The same check, for a millisecond timestamp — what the photo library
 * reports for a file that carries no EXIF, video especially. */
export function captureDateFromEpoch(ms: unknown): string | null {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return null;
  return plausibleCaptureDate(new Date(ms));
}

/**
 * The capture date of a picked asset, or null if the file carried none.
 * Accepts the raw `exif` dictionary from expo-image-picker.
 */
export function captureDateFrom(exif: Record<string, unknown> | null | undefined): string | null {
  if (!exif) return null;
  for (const key of DATE_KEYS) {
    const parsed = parseExifDate(exif[key]);
    if (parsed) return parsed;
  }
  // Some iOS payloads nest the EXIF block rather than flattening it.
  const nested = exif["{Exif}"];
  if (nested && typeof nested === "object") {
    for (const key of DATE_KEYS) {
      const parsed = parseExifDate((nested as Record<string, unknown>)[key]);
      if (parsed) return parsed;
    }
  }
  return null;
}
