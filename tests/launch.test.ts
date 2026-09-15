import { describe, expect, it } from "vitest";
import { LEGAL_TITLES, PRIVACY_POLICY, TERMS_OF_USE, legalText } from "@/legal/documents";

describe("the documents the store asks for", () => {
  it("exist, say what the app does, and are what the screens show", () => {
    expect(legalText("privacy")).toBe(PRIVACY_POLICY);
    expect(legalText("terms")).toBe(TERMS_OF_USE);
    expect(LEGAL_TITLES.privacy).toBe("Privacy Policy");
    // The parts Apple reads for: photo library, deletion, blocking, reporting, age.
    for (const phrase of ["photo", "delete your account", "block", "17"]) {
      expect(PRIVACY_POLICY.toLowerCase()).toContain(phrase);
    }
    for (const phrase of ["report", "block", "24 hours", "delete your account"]) {
      expect(TERMS_OF_USE.toLowerCase()).toContain(phrase);
    }
  });

  it("keep headings and paragraphs apart for rendering", () => {
    const headings = PRIVACY_POLICY.split(/\n\n+/).filter((p) => p.startsWith("## "));
    expect(headings.length).toBeGreaterThan(4);
    expect(headings.every((h) => !h.includes("\n"))).toBe(true);
  });
});
