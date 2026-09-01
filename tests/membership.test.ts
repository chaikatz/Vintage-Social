import { describe, expect, it } from "vitest";
import {
  FOUNDING_MEMBER_LIMIT,
  formatMemberNumber,
  isFoundingMember,
  membershipLine,
} from "@/utils/membership";
import { DEMO_PROFILES } from "@/demo/fixtures";

describe("membership numbers", () => {
  it("prints five digits", () => {
    expect(formatMemberNumber(1)).toBe("NO. 00001");
    expect(formatMemberNumber(27)).toBe("NO. 00027");
    expect(formatMemberNumber(10_000)).toBe("NO. 10000");
  });

  it("does not truncate numbers past the founding run", () => {
    expect(formatMemberNumber(123_456)).toBe("NO. 123456");
  });

  it("counts the first ten thousand as founding members, and nobody else", () => {
    expect(isFoundingMember(1)).toBe(true);
    expect(isFoundingMember(FOUNDING_MEMBER_LIMIT)).toBe(true);
    expect(isFoundingMember(FOUNDING_MEMBER_LIMIT + 1)).toBe(false);
  });

  it("treats a member with no number as not founding", () => {
    // An applicant has no number until an admin lets them in.
    expect(isFoundingMember(null)).toBe(false);
    expect(isFoundingMember(undefined)).toBe(false);
    expect(isFoundingMember(0)).toBe(false);
  });

  it("writes the profile line", () => {
    expect(membershipLine(27)).toBe("FOUNDING MEMBER · NO. 00027");
    expect(membershipLine(FOUNDING_MEMBER_LIMIT + 1)).toBe("NO. 10001");
    expect(membershipLine(null)).toBeNull();
  });
});

describe("seeded membership numbers", () => {
  const members = DEMO_PROFILES.filter((p) => p.member_no !== null);

  it("numbers every member who is in, and nobody who is waiting", () => {
    for (const p of DEMO_PROFILES) {
      const isIn = p.status === "approved" || p.status === "suspended";
      expect(p.member_no !== null, `${p.username} (${p.status})`).toBe(isIn);
    }
  });

  it("hands them out from 1 with no gaps and no duplicates", () => {
    const numbers = members.map((p) => p.member_no!).sort((a, b) => a - b);
    expect(numbers[0]).toBe(1);
    expect(new Set(numbers).size).toBe(numbers.length);
    numbers.forEach((n, i) => expect(n).toBe(i + 1));
  });

  it("issues them in the order members joined", () => {
    const byNumber = [...members].sort((a, b) => a.member_no! - b.member_no!);
    for (let i = 1; i < byNumber.length; i++) {
      expect(byNumber[i - 1].created_at <= byNumber[i].created_at).toBe(true);
    }
  });

  it("attributes every member but the first to someone already inside", () => {
    const byId = new Map(DEMO_PROFILES.map((p) => [p.id, p]));
    for (const p of members) {
      if (p.member_no === 1) {
        expect(p.invited_by).toBeNull(); // the founder was nominated by nobody
        continue;
      }
      const inviter = byId.get(p.invited_by ?? "");
      expect(inviter, `${p.username} has no nominator`).toBeDefined();
      // You cannot be nominated by someone who joined after you.
      expect(inviter!.member_no!).toBeLessThan(p.member_no!);
    }
  });
});
