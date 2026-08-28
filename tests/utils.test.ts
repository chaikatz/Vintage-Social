import { describe, expect, it } from "vitest";
import { dateStampText, postAge } from "@/utils/time";
import {
  normalizeInviteCode,
  normalizeUsername,
  validateEmail,
  validateInviteCode,
  validatePassword,
  validateUsername,
} from "@/utils/validation";

describe("postAge", () => {
  const now = new Date("2026-08-28T12:00:00Z");
  it("formats recent ages compactly", () => {
    expect(postAge("2026-08-28T11:59:40Z", now)).toBe("now");
    expect(postAge("2026-08-28T11:15:00Z", now)).toBe("45m");
    expect(postAge("2026-08-28T05:00:00Z", now)).toBe("7h");
    expect(postAge("2026-08-25T12:00:00Z", now)).toBe("3d");
  });
  it("falls back to dates after a week", () => {
    expect(postAge("2026-08-01T12:00:00Z", now)).toMatch(/^Aug 1$/);
    expect(postAge("2025-12-20T12:00:00Z", now)).toMatch(/^Dec 20, 2025$/);
  });
});

describe("dateStampText", () => {
  it("renders the point-and-shoot stamp", () => {
    expect(dateStampText("2026-08-28T12:00:00")).toBe("8 28 ’26");
    expect(dateStampText("1998-01-05T00:00:00")).toBe("1 5 ’98");
  });
});

describe("username validation", () => {
  it("normalizes case and whitespace", () => {
    expect(normalizeUsername("  Elena.Marchetti ")).toBe("elena.marchetti");
  });
  it("accepts classic handles", () => {
    expect(validateUsername("elena.marchetti")).toBeNull();
    expect(validateUsername("sam_okafor99")).toBeNull();
  });
  it("rejects bad handles", () => {
    expect(validateUsername("ab")).not.toBeNull();
    expect(validateUsername("has spaces")).not.toBeNull();
    expect(validateUsername(".leading")).not.toBeNull();
    expect(validateUsername("trailing.")).not.toBeNull();
    expect(validateUsername("x".repeat(25))).not.toBeNull();
  });
});

describe("email and password validation", () => {
  it("validates emails loosely but sanely", () => {
    expect(validateEmail("elena@vintage.club")).toBeNull();
    expect(validateEmail("not-an-email")).not.toBeNull();
  });
  it("requires 8+ character passwords", () => {
    expect(validatePassword("longenough")).toBeNull();
    expect(validatePassword("short")).not.toBeNull();
  });
});

describe("invite codes", () => {
  it("normalizes as the user types", () => {
    expect(normalizeInviteCode("abcd1234")).toBe("ABCD-1234");
    expect(normalizeInviteCode("ab")).toBe("AB");
    expect(normalizeInviteCode(" ab-cd 12!34 ")).toBe("ABCD-1234");
  });
  it("validates the final shape", () => {
    expect(validateInviteCode("ABCD-1234")).toBeNull();
    expect(validateInviteCode("abcd1234")).toBeNull(); // normalized first
    expect(validateInviteCode("ABC")).not.toBeNull();
  });
});
