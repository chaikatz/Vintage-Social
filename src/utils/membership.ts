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
 *
 * Whether others see it is the member's choice (Settings, "Show my member
 * number"; `profiles.show_member_no`, 0041). Hidden unless they choose to
 * show it: a profile always says MEMBER, and the number follows only for a
 * member who turned it on. The same on their prints. Admins see every
 * number in their Members list, whatever the member chose.
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
  return memberNumberText(memberNo).toUpperCase();
}

/** `27` → `No. 00027`: the number in a sentence. */
export function memberNumberText(memberNo: number): string {
  return `No. ${String(memberNo).padStart(DIGITS, "0")}`;
}

/**
 * Whether this member chose to show their number. Only a stored `true`
 * does: a profile read from a database without the column (before 0041),
 * or remembered on the phone from before it, has none, and is hidden.
 */
export function showsMemberNumber(profile: { show_member_no?: boolean | null } | null | undefined): boolean {
  return profile?.show_member_no === true;
}

export function isFoundingMember(memberNo: number | null | undefined): boolean {
  return typeof memberNo === "number" && memberNo >= 1 && memberNo <= FOUNDING_MEMBER_LIMIT;
}

/**
 * The line shown on a profile: `MEMBER`, and `MEMBER · NO. 00027` for a
 * member who chose to show their number (`shown`). The word is the same
 * for everyone and always there; the number says how early someone came,
 * and is theirs to show. Null for anyone who has not been approved yet —
 * an applicant has no number, and is not a member.
 */
export function membershipLine(memberNo: number | null | undefined, shown: boolean): string | null {
  if (typeof memberNo !== "number" || memberNo < 1) return null;
  return shown ? `MEMBER · ${formatMemberNumber(memberNo)}` : "MEMBER";
}
