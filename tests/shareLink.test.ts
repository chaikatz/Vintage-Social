import { describe, expect, it } from "vitest";
import { isShareToken, shareUrl, shareUrlLabel } from "@/utils/shareLink";

describe("a share link", () => {
  const token = "0123456789abcdef0123456789abcdef";

  it("lives under /s/ on the club's domain", () => {
    expect(shareUrl(token)).toBe(`https://vintagesocial.app/s/${token}`);
    expect(shareUrlLabel(token)).toBe(`vintagesocial.app/s/${token}`);
  });

  it("accepts only the database's 32-hex tokens", () => {
    expect(isShareToken(token)).toBe(true);
    expect(isShareToken(token.toUpperCase())).toBe(false);
    expect(isShareToken("chai")).toBe(false);
    expect(isShareToken("0123456789abcdef0123456789abcde")).toBe(false);
    expect(isShareToken(null)).toBe(false);
  });
});
