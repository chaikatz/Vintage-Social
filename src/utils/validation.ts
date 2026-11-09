/** Shared client-side validation. The database enforces these again. */

export const USERNAME_RE = /^[a-z0-9_.]{3,24}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function validateUsername(raw: string): string | null {
  const u = normalizeUsername(raw);
  if (u.length < 3) return "Usernames need at least 3 characters.";
  if (u.length > 24) return "Usernames can be at most 24 characters.";
  if (!USERNAME_RE.test(u)) {
    return "Use lowercase letters, numbers, dots and underscores only.";
  }
  if (u.startsWith(".") || u.endsWith(".")) {
    return "Usernames can’t start or end with a dot.";
  }
  return null;
}

export function validateEmail(raw: string): string | null {
  const e = raw.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return "That doesn’t look like an email address.";
  return null;
}

export function validatePassword(raw: string): string | null {
  if (raw.length < 8) return "Passwords need at least 8 characters.";
  return null;
}

export const INVITE_CODE_RE = /^[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export function normalizeInviteCode(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length <= 4) return cleaned;
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

export function validateInviteCode(raw: string): string | null {
  if (!INVITE_CODE_RE.test(normalizeInviteCode(raw))) {
    return "Invite codes look like ABCD-1234.";
  }
  return null;
}

export const MAX_CAPTION_LENGTH = 500;

/** Free text, not a coordinate — a place name fits in a line. */
export const MAX_LOCATION_LENGTH = 80;

/**
 * A place's name as a post can keep it: trimmed, and no longer than the
 * database takes (posts.location, char_length <= 80, migration 0005),
 * counted in characters as Postgres counts them rather than in UTF-16
 * units. Typed words are held to the limit as they are typed; a place
 * chosen from the map can be named at greater length, and its post was
 * refused at the insert, after the whole upload, and on every Retry.
 */
export function clampLocation(text: string | null | undefined): string | null {
  const trimmed = (text ?? "").trim();
  const chars = Array.from(trimmed);
  if (chars.length <= MAX_LOCATION_LENGTH) return trimmed || null;
  return chars.slice(0, MAX_LOCATION_LENGTH).join("").trimEnd() || null;
}

export const MAX_MESSAGE_LENGTH = 1000;
export const MAX_BIO_LENGTH = 160;
export const MAX_COMMENT_LENGTH = 500;
export const MAX_VIDEO_SECONDS = 60;
