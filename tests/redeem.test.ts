import { describe, expect, it } from "vitest";
import { asRedeemResult, describeRedeem } from "@/utils/invitationReasons";

/**
 * The reasons a join can come to. Getting these right is what lets the
 * card tell a typo from a spent allowance, and a retry from a failure.
 */
describe("what taking up an invitation came to", () => {
  it("says nothing on success, and nothing again on a retry after success", () => {
    expect(describeRedeem("joined")).toBeNull();
    expect(describeRedeem("already_member")).toBeNull();
  });

  it("names each refusal plainly", () => {
    expect(describeRedeem("unknown")).toMatch(/isn.t one we know/);
    expect(describeRedeem("own")).toMatch(/your own/);
    expect(describeRedeem("closed")).toMatch(/no longer open/);
  });

  it("treats anything unexpected from the server as unknown, never as joined", () => {
    expect(asRedeemResult("joined")).toBe("joined");
    expect(asRedeemResult("true")).toBe("unknown");
    expect(asRedeemResult(null)).toBe("unknown");
  });
});
