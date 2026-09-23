import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const html = readFileSync(decodeURIComponent(new URL("../public/home.html", import.meta.url).pathname), "utf8");

/**
 * The web front door is the app's landing screen with the 3D V where the
 * prints were: the wordmark, the three ways in, the footer — and nothing
 * loaded from anyone else's server.
 */
describe("the landing page", () => {
  it("is the app's front door: wordmark, three ways in, footer", () => {
    expect(html).toContain("<h1>VINTAGE</h1>");
    expect(html).toContain('href="/apply"');
    expect(html).toContain('href="/invite"');
    expect(html).toContain('href="/sign-in"');
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toMatch(/Apply for membership/);
    expect(html).toMatch(/I have an invitation/);
    expect(html).toMatch(/Members only · Est\. 2026/);
  });

  it("stands the 3D V where the three prints lay, from this site's own scripts", () => {
    expect(html).toContain("<vintage-stage minimal");
    expect(html).not.toMatch(/landing\/(left|middle|right)\.jpg/);
    expect(html).toMatch(/src="\/3d\/stage\.js\?v=\d+"/);
    expect(html).toMatch(/\/3d\/mark\.js\?v=\d+/);
    expect(html).toContain('"three": "/3d/vendor/three.module.js"');
    expect(html).not.toContain("unpkg");
    expect(html).not.toMatch(/https?:\/\/(?!vintagesocial\.app\/)/);
  });
});
