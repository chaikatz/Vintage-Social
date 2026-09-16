import { INVITE_DOMAIN, inviteBaseFor } from "./inviteLink";

/**
 * Where a shared photograph can be seen by someone who is not a member.
 *
 * A share link is `https://vintagesocial.app/s/<token>`: the token is 32
 * hex characters drawn at random by the database when the author asks,
 * so a link cannot be guessed or enumerated, and it shows only the one
 * photograph the member chose to send out. The host is the invitation
 * host, so a staging build points at its own site.
 */

const TOKEN = /^[a-f0-9]{32}$/;

export function isShareToken(value: string | null | undefined): boolean {
  return typeof value === "string" && TOKEN.test(value);
}

export function shareBase(): string {
  const base = inviteBaseFor(process.env.EXPO_PUBLIC_INVITE_BASE);
  return base && base.startsWith("http") ? base : INVITE_DOMAIN;
}

export function shareUrl(token: string): string {
  return `${shareBase()}/s/${token}`;
}

/** How the link reads on screen: no scheme. */
export function shareUrlLabel(token: string): string {
  return shareUrl(token).replace(/^https?:\/\//, "");
}
