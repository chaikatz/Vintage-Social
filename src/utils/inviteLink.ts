/**
 * Where an invitation lives.
 *
 * A member's invitation is a URL they can put in a message, and the address
 * has to be stable enough that one sent last month still opens today. The
 * host comes from configuration rather than being hard-coded, because it
 * changes exactly twice: once when the domain is bought, and never again.
 *
 * Until a domain exists, EXPO_PUBLIC_INVITE_BASE is unset and the app falls
 * back to the vintage:// scheme, which opens the app directly for anyone
 * who already has it. That is the honest behaviour for a TestFlight build:
 * shareable, and useless to somebody without the app — which is the gap the
 * web page will close.
 */
const base = process.env.EXPO_PUBLIC_INVITE_BASE?.replace(/\/+$/, "");

/** The link a member shares. */
export function inviteUrl(slug: string): string {
  return base ? `${base}/i/${slug}` : `vintage://invite/${slug}`;
}

/** How that link should read on screen — no scheme, no clutter. */
export function inviteUrlLabel(slug: string): string {
  return inviteUrl(slug).replace(/^https?:\/\//, "").replace(/^vintage:\/\//, "vintage://");
}

/** Is the invitation a real web address yet, or still app-only? */
export function inviteLinkIsWeb(): boolean {
  return Boolean(base);
}

/**
 * Pull a slug out of anything a person might paste: the full link, the
 * app scheme, or the suffix on its own.
 */
export function slugFromInput(input: string): string {
  const trimmed = input.trim().toLowerCase();
  const fromUrl = /(?:\/i\/|\/invite\/|invite\?[^#]*\bt=)([a-z0-9-]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1];
  return trimmed.replace(/^.*\//, "");
}

/** The rules the database enforces, mirrored so the field can say why. */
export const SLUG_MIN = 8;
export const SLUG_MAX = 64;

export function describeSlugProblem(slug: string): string | null {
  const s = slug.trim().toLowerCase();
  if (s.length === 0) return null;
  if (s.length < SLUG_MIN) return `At least ${SLUG_MIN} characters.`;
  if (s.length > SLUG_MAX) return `At most ${SLUG_MAX} characters.`;
  if (/^-|-$/.test(s)) return "Cannot begin or end with a hyphen.";
  if (!/^[a-z0-9-]+$/.test(s)) return "Letters, numbers and hyphens only.";
  return null;
}
