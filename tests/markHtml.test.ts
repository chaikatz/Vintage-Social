import { describe, expect, it } from "vitest";
import { MARK_HTML } from "../src/brand/markHtml.generated";

/**
 * The page the app's web view shows for the turning V. It is generated
 * (scripts/build-mark.mjs) and committed, so this holds the committed copy
 * to what the app relies on: self-contained, offline, and quiet.
 */
describe("the mark's page for the app", () => {
  it("is one self-contained page that fetches nothing", () => {
    expect(MARK_HTML.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(MARK_HTML).not.toMatch(/<script[^>]+src=/);
    expect(MARK_HTML).not.toMatch(/<link[^>]+href=/);
    expect(MARK_HTML).not.toContain("unpkg");
    expect(MARK_HTML).not.toContain("import(");
  });

  it("carries the V, tells the app when it is drawn, and leaves the fill to the app", () => {
    expect(MARK_HTML).toContain('data-fill="__FILL__"');
    expect(MARK_HTML).toContain("ReactNativeWebView");
    expect(MARK_HTML).toContain("background:transparent");
    // The two named meshes of the mark, as in public/3d/mark.js.
    expect(MARK_HTML).toContain("letter_v");
    expect(MARK_HTML).toContain("underline");
  });

  it("stays a reasonable weight for a JS bundle to carry", () => {
    expect(MARK_HTML.length).toBeLessThan(1_200_000);
  });
});
