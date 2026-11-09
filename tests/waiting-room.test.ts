import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { awaitsDecision, invitationToOffer, takesInvitation, waitingRoomState } from "@/components/gate/waitingRoom";

/**
 * The waiting room says what is true of this member's own application.
 *
 * decide_application (since 0011) writes the profile only on approval: in
 * production four rejected applicants' profiles read "applied", and they
 * were told "APPLICATION RECEIVED … we'll be in touch". An account that
 * never applied (an invitation refused after the account was made) was
 * told the same.
 */

describe("what the waiting room says", () => {
  it("tells a rejected applicant so, whatever the profile still reads", () => {
    expect(waitingRoomState("applied", { status: "rejected" })).toBe("rejected");
    expect(waitingRoomState("applied", { status: "waitlisted" })).toBe("waitlisted");
  });

  it("tells an account with no application of its own that nothing has reached us", () => {
    expect(waitingRoomState("applied", null)).toBe("none");
  });

  it("says an application is waiting only when one is", () => {
    expect(waitingRoomState("applied", { status: "pending" })).toBe("applied");
  });

  it("takes the profile at its word until the application has been read, or when it could not be", () => {
    expect(waitingRoomState("applied", undefined)).toBe("applied");
    expect(waitingRoomState(undefined, undefined)).toBe("applied");
    expect(waitingRoomState(null, undefined)).toBe("applied");
  });

  it("never overrides a profile that says more than 'applied'", () => {
    expect(waitingRoomState("suspended", null)).toBe("suspended");
    expect(waitingRoomState("suspended", { status: "pending" })).toBe("suspended");
    expect(waitingRoomState("rejected", { status: "pending" })).toBe("rejected");
    expect(waitingRoomState("waitlisted", null)).toBe("waitlisted");
  });

  it("takes an invitation from anyone not suspended, as the database does", () => {
    for (const s of ["applied", "waitlisted", "rejected", "none"] as const) expect(takesInvitation(s), s).toBe(true);
    expect(takesInvitation("suspended")).toBe(false);
  });

  it("offers Check status only while a decision is still to come", () => {
    for (const s of ["applied", "waitlisted", "none"] as const) expect(awaitsDecision(s), s).toBe(true);
    expect(awaitsDecision("rejected")).toBe(false);
    expect(awaitsDecision("suspended")).toBe(false);
  });
});

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("an invitation brought to the waiting room", () => {
  it("is offered to an account that takes one, in the form the database takes", () => {
    expect(invitationToOffer("ansel-k", "applied")).toBe("ansel-k");
    expect(invitationToOffer("https://vintagesocial.app/i/ansel-k", "rejected")).toBe("ansel-k");
    expect(invitationToOffer("ansel-k", undefined)).toBe("ansel-k");
  });
  it("is not offered to a suspended account, which cannot take one, nor to a member", () => {
    expect(invitationToOffer("ansel-k", "suspended")).toBeNull();
    expect(invitationToOffer("ansel-k", "approved")).toBeNull();
  });
  it("is nothing when none was brought, or none the database could take", () => {
    expect(invitationToOffer(undefined, "applied")).toBeNull();
    expect(invitationToOffer("", "applied")).toBeNull();
    expect(invitationToOffer("x", "applied")).toBeNull();
  });
});

describe("the waiting room screen", () => {
  const src = code("app/(gate)/pending.tsx");

  it("reads the member's own application and says what it found", () => {
    expect(src).toMatch(/const application = useQuery\(\{\s*queryKey: \["my-application", session\?\.user\?\.id\]/);
    expect(src).toMatch(/const status = waitingRoomState\(profile\?\.status, application\.isSuccess \? application\.data : undefined\);/);
    expect(src).toMatch(/none: \{\s*title: "[^"]+",\s*body: "[^"]+",\s*\}/);
    // Check status looks at the application again too, without waiting on
    // it (tests/check-status.test.ts: offline it waits for the signal).
    expect(src).toMatch(/const ok = await checkStatus\(refreshProfile, application\.refetch\);/);
  });

  it("offers the invitation and Check status by the same rules", () => {
    expect(src).toMatch(/\{takesInvitation\(status\) \? \(\s*<GateButton title="I have an invitation"/);
    expect(src).toMatch(/\{awaitsDecision\(status\) \? \(\s*<>\s*<GateButton title="Check status"/);
  });

  it("offers once, as it opens, an invitation brought through the door, and writes it into the prompt", () => {
    // A link tapped while waiting used to be dropped, and the prompt opened empty.
    expect(src).toMatch(/const \{ invitation \} = useLocalSearchParams<\{ invitation\?: string \}>\(\);\s*const brought = invitationToOffer\(invitation, profile\?\.status\);/);
    expect(src).toMatch(
      /if \(!brought \|\| offered\.current\) return;\s*offered\.current = true;\s*showAlert\("Your invitation", "[^"]+", \[\s*\{ text: "Take it up", onPress: \(\) => void takeUp\(brought\) \},\s*\{ text: "Not now", style: "cancel" \},\s*\]\);/,
    );
    expect(src).toMatch(/if \(slug\) void takeUp\(slug\);\s*\},\s*brought \?\? undefined,\s*\);/);
    // Taken up the one way, whether offered or typed.
    expect(src.match(/await redeemInviteLink\(/g)).toHaveLength(1);
    expect(src.indexOf("const takeUp = async")).toBeLessThan(src.indexOf("if (session === null) return <Redirect"));
  });

  it("says where to write when the phone has no mail account", () => {
    expect(src).toMatch(/Linking\.openURL\(supportMailto\("VINTAGE membership"\) \?\? ""\)\.catch\(/);
  });
});
