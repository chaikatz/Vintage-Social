/**
 * Membership numbers.
 *
 * Every member is given a number when they are let in, counting from 1, and
 * keeps it for the life of the account. Numbers are never reused, never
 * edited and never reassigned: suspending someone does not free their
 * number, and reinstating them does not issue a new one. The number is
 * assigned by the database (`assign_member_no`) at the two moments someone
 * can enter — an admin approving an application, or a nomination being
 * redeemed — and by nothing else. It is not a field a member can set.
 *
 * The first ten thousand are founding members, permanently. The cut-off is
 * on the number, not on a date or a flag, so it cannot drift: member 9,999
 * is founding whether they joined on the first day or the last.
 */

/** Members numbered at or below this are founding members, for good. */
export const FOUNDING_MEMBER_LIMIT = 10_000;

/** Width of the printed number — enough for the founding run. */
const DIGITS = 5;

/**
 * `27` → `NO. 00027`. Numbers past the founding run print at their natural
 * width rather than being truncated.
 */
export function formatMemberNumber(memberNo: number): string {
  return `NO. ${String(memberNo).padStart(DIGITS, "0")}`;
}

export function isFoundingMember(memberNo: number | null | undefined): boolean {
  return typeof memberNo === "number" && memberNo >= 1 && memberNo <= FOUNDING_MEMBER_LIMIT;
}

/**
 * The line shown on a profile: `FOUNDING MEMBER · NO. 00027`, or just the
 * number once the founding run is over. Null for anyone who has not been
 * approved yet — an applicant has no number.
 */
export function membershipLine(memberNo: number | null | undefined): string | null {
  if (typeof memberNo !== "number" || memberNo < 1) return null;
  const number = formatMemberNumber(memberNo);
  return isFoundingMember(memberNo) ? `FOUNDING MEMBER · ${number}` : number;
}
