/**
 * What taking up an invitation came to. Mirrors `redeem_invite_link` in
 * the database, and says each answer once, here, for every screen.
 */
export type RedeemResult = "joined" | "already_member" | "unknown" | "own" | "closed";

export const REDEEM_RESULTS: readonly RedeemResult[] = ["joined", "already_member", "unknown", "own", "closed"];

export function asRedeemResult(value: unknown): RedeemResult {
  return REDEEM_RESULTS.includes(value as RedeemResult) ? (value as RedeemResult) : "unknown";
}

/** The sentence for each answer; nothing to say when it worked (or already had). */
export function describeRedeem(result: RedeemResult): string | null {
  switch (result) {
    case "joined":
    case "already_member":
      return null;
    case "unknown":
      return "That invitation isn’t one we know. Check the code — or the link may have been replaced by the member who sent it.";
    case "own":
      return "That is your own invitation.";
    case "closed":
      return "That invitation is no longer open: every invitation the member was given has been taken up.";
  }
}
