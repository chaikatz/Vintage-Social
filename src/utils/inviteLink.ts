/**
 * Where an invitation lives.
 *
 * A member's invitation is a URL they can put in a message, and the address
 * has to be stable enough that one sent last month still opens today. The
 * host comes from configuration rather than being hard-coded, because it
 * changes exactly twice: once when the domain is bought, and never again.
 *
 * The domain is vintagesocial.app. EXPO_PUBLIC_INVITE_BASE may still point
 * elsewhere (a staging host), and the Vercel address the site lived at
 * before the domain is rewritten to the domain, so a build made with the
 * old value shares the right link. Only when the variable is set to
 * nothing at all does the app fall back to the vintage:// scheme, which
 * opens the app directly for anyone who already has it.
 */
export const INVITE_DOMAIN = "https://vintagesocial.app";
const LEGACY_HOSTS = ["vintage-social.vercel.app"];

function resolveBase(configured: string | undefined): string | undefined {
  const trimmed = configured?.trim().replace(/\/+$/, "");
  if (trimmed === undefined) return INVITE_DOMAIN;
  if (trimmed === "") return undefined;
  const host = trimmed.replace(/^https?:\/\//, "");
  return LEGACY_HOSTS.includes(host) ? INVITE_DOMAIN : trimmed;
}

const base = resolveBase(process.env.EXPO_PUBLIC_INVITE_BASE);

/** Test seam: what the app would use for a given configured value. */
export function inviteBaseFor(configured: string | undefined): string | undefined {
  return resolveBase(configured);
}

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
export const SLUG_MIN = 3;
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
