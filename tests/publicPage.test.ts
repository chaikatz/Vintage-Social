import { describe, expect, it } from "vitest";
import { archiveLine, detailLines, frameRatio, publicSharePage, type SharedPhotograph } from "@/share/publicPage";

const token = "0123456789abcdef0123456789abcdef";
const photograph: SharedPhotograph = {
  mediaType: "photo",
  hasPoster: false,
  width: 1200,
  height: 1500,
  location: "The Met · New York",
  takenAt: "2026-09-15T14:00:00Z",
  createdAt: "2026-09-16T09:00:00Z",
  username: "chai",
};

describe("the page a shared link opens", () => {
  it("shows the one photograph, whose archive, when and where — and the way in", () => {
    const html = publicSharePage({ origin: "https://vintagesocial.app", token, photograph });
    expect(html).toContain(`src="https://vintagesocial.app/s/${token}/media"`);
    expect(html).toContain(`<meta property="og:image" content="https://vintagesocial.app/s/${token}/media">`);
    expect(html).not.toContain("storage/v1");
    expect(html).not.toContain("supabase");
    expect(html).toContain("FROM CHAI’S ARCHIVE");
    expect(html).toContain("SEPTEMBER 15, 2026");
    expect(html).toContain("THE MET · NEW YORK");
    expect(html).toContain("Membership by invitation.");
    expect(html).toContain(`href="/s/${token}/request"`);
    expect(html).toContain("Request membership");
    expect(html).toContain('property="og:image"');
    expect(html).not.toMatch(/undefined|null/);
  });

  it("leaves out a missing place and falls back to the posting day", () => {
    expect(detailLines({ takenAt: null, createdAt: "2026-09-16T09:00:00Z", location: null })).toEqual(["SEPTEMBER 16, 2026"]);
    expect(detailLines({ takenAt: "not a date", createdAt: "2026-09-16T09:00:00Z", location: " " })).toEqual([]);
  });

  it("never lets a member's text into the markup unescaped", () => {
    const html = publicSharePage({
      origin: "https://vintagesocial.app",
      token,
      photograph: { ...photograph, username: '<img src=x onerror="1">', location: "a & b" },
    });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;IMG SRC=X");
    expect(html).toContain("A &amp; B");
  });

  it("says the photograph is no longer shared, and nothing else, when it is not", () => {
    const html = publicSharePage({ origin: "https://vintagesocial.app", token, photograph: null });
    expect(html).toContain("no longer shared");
    expect(html).not.toContain("ARCHIVE");
    expect(html).toContain("Request membership");
  });

  it("says so when the database is unreachable", () => {
    const html = publicSharePage({ origin: "https://vintagesocial.app", token, photograph: null, unavailable: true });
    expect(html).toContain("cannot be shown just now");
  });

  it("plays a film muted, in the same frame", () => {
    const html = publicSharePage({
      origin: "https://vintagesocial.app",
      token,
      photograph: { ...photograph, mediaType: "video", hasPoster: true, width: 1920, height: 1080 },
    });
    expect(html).toContain("<video");
    expect(html).toContain(`poster="https://vintagesocial.app/s/${token}/poster"`);
    expect(html).toContain(`<meta property="og:image" content="https://vintagesocial.app/s/${token}/poster">`);
    expect(html).toContain("aspect-ratio:1.7777777777777777");
  });

  it("clamps the frame like the feed and possessivises any name", () => {
    expect(frameRatio(1000, 4000)).toBeCloseTo(0.8);
    expect(frameRatio(null, 10)).toBe(1);
    expect(archiveLine("gigiashkenazy")).toBe("FROM GIGIASHKENAZY’S ARCHIVE");
  });
});
