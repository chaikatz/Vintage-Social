import type { ApplicationStatus, MembershipStatus } from "@/types/db";

/**
 * What the waiting room says, from the member's profile and their own
 * latest application.
 *
 * The profile alone does not say it all. The database writes the profile
 * only when an application is approved (decide_application since 0011), so
 * a rejected applicant's profile still reads "applied", and they were told
 * their application had been received and that someone would be in touch.
 * And an account with no application at all (an invitation refused after
 * the account was made, or an application that never reached the admins)
 * was told the same, about an application it never sent.
 *
 * Until the application has been read (or when it could not be), the
 * profile is taken at its word, as it always was.
 */
export type WaitingRoomState = MembershipStatus | "none";

export function waitingRoomState(
  profileStatus: MembershipStatus | null | undefined,
  application: { status: ApplicationStatus } | null | undefined,
): WaitingRoomState {
  const status = profileStatus ?? "applied";
  if (status !== "applied" || application === undefined) return status;
  if (application === null) return "none";
  if (application.status === "rejected" || application.status === "waitlisted") return application.status;
  return status;
}

/**
 * Whether the waiting room takes an invitation: from anyone not suspended.
 * The database lets a rejected applicant in by invitation too.
 */
export function takesInvitation(state: WaitingRoomState): boolean {
  return state === "applied" || state === "waitlisted" || state === "rejected" || state === "none";
}

/** Whether there is anything to look for with Check status: a decision still to come. */
export function awaitsDecision(state: WaitingRoomState): boolean {
  return state === "applied" || state === "waitlisted" || state === "none";
}
