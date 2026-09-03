import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import handler from "../api/invite";

/**
 * The invitation page is the only part of VINTAGE a stranger sees before
 * they have an account, and the only part a link-preview crawler reads. It
 * has to say who invited you, give away nothing about anyone else, and
 * survive a display name chosen by a member.
 */

type Row = { inviter: string; open: boolean };

const links: Record<string, Row[]> = {
  chai: [{ inviter: "Chai", open: true }],
  "chai-katz-photographs": [{ inviter: "Chai", open: true }],
  "spent-invite": [{ inviter: "Marguerite", open: false }],
};

function respond(slug: string) {
  return { ok: true, json: async () => links[slug] ?? [] } as unknown as Response;
}

let seen: string[] = [];

beforeEach(() => {
  seen = [];
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://stub.test";
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "stub";
  delete process.env.VINTAGE_INSTALL_URL;
  vi.stubGlobal("fetch", async (_url: string, init: { body: string }) => {
    const { p_slug } = JSON.parse(init.body);
    seen.push(p_slug);
    return respond(p_slug);
  });
});

afterEach(() => vi.unstubAllGlobals());

async function get(slug: string) {
  let status = 0;
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    setHeader: (k: string, v: string) => void (headers[k] = v),
    status(s: number) {
      status = s;
      return this;
    },
    send(b: string) {
      body = b;
    },
  };
  const req = { query: { slug }, headers: { "x-forwarded-host": "vintage.example" } };
  // The handler's Vercel types are wider than the two fields it reads.
  await handler(req as never, res as never);
  return { status, body, headers };
}

describe("the invitation page", () => {
  it("names the inviter, which is the reason to open it", async () => {
    const { status, body } = await get("chai-katz-photographs");
    expect(status).toBe(200);
    expect(body).toContain("<title>Chai invited you to VINTAGE</title>");
    expect(body).toContain('content="Chai invited you to VINTAGE"');
  });

  it("gives the crawler absolute URLs, since a relative og:image is dropped", async () => {
    const { body } = await get("chai");
    expect(body).toContain('content="https://vintage.example/invite-card.png"');
    expect(body).toContain('content="https://vintage.example/i/chai"');
  });

  it("sends someone without the app to the install link when there is one", async () => {
    process.env.VINTAGE_INSTALL_URL = "https://testflight.apple.com/join/abc";
    const { body } = await get("chai");
    expect(body).toContain("https://testflight.apple.com/join/abc");
    expect(body).toContain("vintage://invite/chai");
  });

  it("falls back to the app's own scheme when there is no install link", async () => {
    const { body } = await get("chai");
    expect(body).toContain('class="cta" href="vintage://invite/chai"');
    expect(body).toContain("private testing");
  });

  it("says an invitation is spent without offering a way in", async () => {
    const { status, body } = await get("spent-invite");
    expect(status).toBe(200);
    expect(body).toContain("has since been taken up");
    expect(body).not.toContain('class="cta"');
  });

  it("tells a stranger nothing about a link that does not exist", async () => {
    const { status, body } = await get("no-such-link");
    expect(status).toBe(404);
    expect(body).not.toContain("invited you to VINTAGE.");
  });

  it("normalises case, so a link retyped in caps still works", async () => {
    const { status } = await get("CHAI");
    expect(status).toBe(200);
    expect(seen).toEqual(["chai"]);
  });

  it("refuses a malformed slug before it reaches the database", async () => {
    for (const bad of ["../../etc/passwd", "ck", "-chai", "chai katz"]) {
      const { status } = await get(bad);
      expect(status, bad).toBe(404);
    }
    expect(seen).toEqual([]);
  });

  it("escapes a display name, which is text a member chose", async () => {
    links["xss-link"] = [{ inviter: "<script>alert(1)</script>", open: true }];
    const { body } = await get("xss-link");
    expect(body).not.toContain("<script>alert(1)</script>");
    expect(body).toContain("&lt;script&gt;");
  });

  it("lets a crawler cache only briefly, and never indexes the page", async () => {
    const { body, headers } = await get("chai");
    expect(headers["Cache-Control"]).toContain("s-maxage=60");
    expect(body).toContain('name="robots" content="noindex"');
  });
});
