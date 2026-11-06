import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { awaitsDecision, takesInvitation, waitingRoomState } from "@/components/gate/waitingRoom";

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

  it("says where to write when the phone has no mail account", () => {
    expect(src).toMatch(/Linking\.openURL\(supportMailto\("VINTAGE membership"\) \?\? ""\)\.catch\(/);
  });
});
