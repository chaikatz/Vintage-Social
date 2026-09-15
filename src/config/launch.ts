/**
 * The few addresses a shipping app has to be able to point at.
 *
 * All three come from public build variables set in the EAS "production"
 * environment (they are not secrets), so the same binary can point at a
 * new host without a code change:
 *
 *   EXPO_PUBLIC_SUPPORT_EMAIL   where a member writes for help
 *   EXPO_PUBLIC_PRIVACY_URL     the privacy policy on the web
 *   EXPO_PUBLIC_TERMS_URL       the terms of use on the web
 *
 * When a URL is unset the app shows the same document from its own copy
 * (`src/legal/documents.ts`), so the words are always reachable from
 * Settings and the door — a build never ships with a dead link. When the
 * invitation site is configured (EXPO_PUBLIC_INVITE_BASE), the documents
 * are also served there at /privacy and /terms, and those are the URLs to
 * give App Store Connect.
 */

import { inviteBaseFor } from "@/utils/inviteLink";

const trim = (v: string | undefined) => (v ?? "").trim() || null;

export const SUPPORT_EMAIL: string | null = trim(process.env.EXPO_PUBLIC_SUPPORT_EMAIL);

const inviteBase = inviteBaseFor(process.env.EXPO_PUBLIC_INVITE_BASE)?.replace(/^vintage:.*$/, "") || null;

export const PRIVACY_URL: string | null =
  trim(process.env.EXPO_PUBLIC_PRIVACY_URL) ?? (inviteBase ? `${inviteBase}/privacy` : null);

export const TERMS_URL: string | null =
  trim(process.env.EXPO_PUBLIC_TERMS_URL) ?? (inviteBase ? `${inviteBase}/terms` : null);

/** A mailto: link with a subject, or null when no address is configured. */
export function supportMailto(subject = "VINTAGE"): string | null {
  if (!SUPPORT_EMAIL) return null;
  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
}
