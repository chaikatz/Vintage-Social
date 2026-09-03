import { describe, expect, it } from "vitest";
import {
  describeSlugProblem,
  inviteUrl,
  inviteUrlLabel,
  slugFromInput,
} from "@/utils/inviteLink";

/**
 * The suffix rules are enforced in the database; these mirror them so the
 * field can explain itself before a round trip. If the two ever disagree
 * the database wins, and 04_invite_links.sql is what checks that side.
 */
describe("what a suffix may be", () => {
  it("accepts an ordinary one", () => {
    expect(describeSlugProblem("chai-katz")).toBeNull();
    expect(describeSlugProblem("private-access-2026")).toBeNull();
  });

  it("says nothing about an empty field", () => {
    expect(describeSlugProblem("")).toBeNull();
  });

  // Three, matching what a username may be: a member called "chai" should
  // get /i/chai rather than a random token.
  it("accepts a name as short as a username may be", () => {
    expect(describeSlugProblem("chai")).toBeNull();
    expect(describeSlugProblem("cak")).toBeNull();
  });

  it("refuses one that is too short", () => {
    expect(describeSlugProblem("ck")).toMatch(/3/);
  });

  it("refuses one that is too long", () => {
    expect(describeSlugProblem("a".repeat(65))).toMatch(/64/);
  });

  it("refuses a leading or trailing hyphen", () => {
    expect(describeSlugProblem("-chai-katz")).toMatch(/hyphen/);
    expect(describeSlugProblem("chai-katz-")).toMatch(/hyphen/);
  });

  it("refuses anything but letters, numbers and hyphens", () => {
    expect(describeSlugProblem("chai katz")).toMatch(/Letters/);
    expect(describeSlugProblem("chai_katz")).toMatch(/Letters/);
    expect(describeSlugProblem("chai.katz")).toMatch(/Letters/);
  });
});

describe("reading a suffix out of whatever was pasted", () => {
  it("takes it from a web invitation", () => {
    expect(slugFromInput("https://vintage.social/i/chai-katz")).toBe("chai-katz");
  });

  it("takes it from the app scheme", () => {
    expect(slugFromInput("vintage://invite/chai-katz")).toBe("chai-katz");
  });

  it("takes it from a query-style link", () => {
    expect(slugFromInput("https://app.example.com/invite?t=chai-katz")).toBe("chai-katz");
  });

  it("takes the suffix on its own", () => {
    expect(slugFromInput("chai-katz")).toBe("chai-katz");
  });

  it("ignores case and stray whitespace", () => {
    expect(slugFromInput("  Chai-Katz  ")).toBe("chai-katz");
  });
});

describe("the link a member shares", () => {
  it("falls back to the app scheme with no domain configured", () => {
    // EXPO_PUBLIC_INVITE_BASE is unset under test, which is the TestFlight
    // situation: the link opens the app for anyone who already has it.
    expect(inviteUrl("chai-katz")).toBe("vintage://invite/chai-katz");
  });

  it("reads without the https:// when shown on screen", () => {
    expect(inviteUrlLabel("chai-katz")).not.toMatch(/^https:\/\//);
  });
});
