import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mediaHandler from "../api/share-media";
import pageHandler from "../api/share";
import { cleanToken, servedHeaders, storageUrl } from "@/share/backend";

/**
 * The picture behind a shared link is served by our own function, which
 * asks the database on every request whether the token is still live.
 *
 * The database here is a small model of the real rule — the one written
 * in `live_share_post` (migration 0019) and proved against real
 * PostgreSQL in `supabase/tests/05_shares.sql`: a share that has not been
 * turned off, of a post that exists and is not removed, by an author who
 * is approved. These tests prove that the server honours that answer and
 * never lets the file's address out.
 */

const SUPABASE = "https://example.supabase.co";
const LIVE = "0123456789abcdef0123456789abcdef";
const REVOKED = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOVED_POST = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const DELETED_POST = "cccccccccccccccccccccccccccccccc";
const SUSPENDED_AUTHOR = "dddddddddddddddddddddddddddddddd";
const PENDING_AUTHOR = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const FILM = "ffffffffffffffffffffffffffffffff";
const UNKNOWN = "9999999999999999999999999999999999".slice(0, 32);

type Profile = { status: "approved" | "applied" | "suspended" };
type Post = { author: string; removed: boolean; media_path: string; thumb_path: string | null; media_type: "photo" | "video" };
type Share = { post: string | null; revoked: boolean };

const profiles: Record<string, Profile> = {
  chai: { status: "approved" },
  gone: { status: "suspended" },
  waiting: { status: "applied" },
};
const posts: Record<string, Post> = {
  p1: { author: "chai", removed: false, media_path: "chai/secret-folder/IMG_0001.jpg", thumb_path: null, media_type: "photo" },
  p2: { author: "chai", removed: true, media_path: "chai/secret-folder/IMG_0002.jpg", thumb_path: null, media_type: "photo" },
  p3: { author: "gone", removed: false, media_path: "gone/IMG_0003.jpg", thumb_path: null, media_type: "photo" },
  p4: { author: "waiting", removed: false, media_path: "waiting/IMG_0004.jpg", thumb_path: null, media_type: "photo" },
  p5: { author: "chai", removed: false, media_path: "chai/films/clip.mp4", thumb_path: "chai/films/clip.jpg", media_type: "video" },
};
const shares: Record<string, Share> = {
  [LIVE]: { post: "p1", revoked: false },
  [REVOKED]: { post: "p1", revoked: true },
  [REMOVED_POST]: { post: "p2", revoked: false },
  [DELETED_POST]: { post: null, revoked: false }, // the post row is gone; the share went with it
  [SUSPENDED_AUTHOR]: { post: "p3", revoked: false },
  [PENDING_AUTHOR]: { post: "p4", revoked: false },
  [FILM]: { post: "p5", revoked: false },
};

/** `live_share_post`, as the migration states it. */
function livePost(token: string): Post | null {
  if (!/^[a-f0-9]{32}$/.test(token)) return null;
  const share = shares[token];
  if (!share || share.revoked || !share.post) return null;
  const post = posts[share.post];
  if (!post || post.removed) return null;
  if (profiles[post.author]?.status !== "approved") return null;
  return post;
}

const PHOTO_BYTES = Buffer.from("\xff\xd8\xff photograph bytes \xff\xd9", "binary");
const FILM_BYTES = Buffer.from("film bytes 0123456789");

let storageFetches: string[] = [];
let databaseDown = false;

function fakeFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    if (databaseDown) return Promise.reject(new Error("connect ECONNREFUSED"));
    const name = url.pathname.slice("/rest/v1/rpc/".length);
    const body = JSON.parse(String(init?.body ?? "{}")) as { p_token?: string };
    const post = livePost(body.p_token ?? "");
    if (name === "shared_post_media") {
      const rows = post ? [{ media_path: post.media_path, thumb_path: post.thumb_path, media_type: post.media_type }] : [];
      return Promise.resolve(Response.json(rows));
    }
    if (name === "shared_post") {
      // The real function returns no path. The model returns one anyway, to
      // prove the page would not repeat it even if it were told.
      const rows = post
        ? [{ media_path: post.media_path, media_type: post.media_type, has_poster: post.thumb_path != null, width: 1200, height: 1500, location: "Paris", taken_at: "2026-09-15T14:00:00Z", created_at: "2026-09-16T09:00:00Z", username: "chai" }]
        : [];
      return Promise.resolve(Response.json(rows));
    }
    if (name === "record_share_event") return Promise.resolve(Response.json(null));
    return Promise.resolve(new Response("not found", { status: 404 }));
  }
  if (url.pathname.startsWith("/storage/v1/object/public/")) {
    storageFetches.push(url.href);
    const isFilm = url.pathname.endsWith(".mp4");
    const bytes = isFilm ? FILM_BYTES : PHOTO_BYTES;
    const range = new Headers(init?.headers).get("range");
    const headers: Record<string, string> = {
      "content-type": isFilm ? "video/mp4" : "image/jpeg",
      "x-served-from": url.pathname, // a store header that must not come through
      etag: '"abc"',
    };
    if (init?.method === "HEAD") return Promise.resolve(new Response(null, { status: 200, headers: { ...headers, "content-length": String(bytes.length) } }));
    if (range) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(range);
      const start = Number(m?.[1] ?? 0);
      const end = m?.[2] ? Number(m[2]) : bytes.length - 1;
      const slice = bytes.subarray(start, end + 1);
      return Promise.resolve(
        new Response(slice, {
          status: 206,
          headers: { ...headers, "content-length": String(slice.length), "content-range": `bytes ${start}-${end}/${bytes.length}` },
        }),
      );
    }
    return Promise.resolve(new Response(bytes, { status: 200, headers: { ...headers, "content-length": String(bytes.length) } }));
  }
  return Promise.resolve(new Response("not found", { status: 404 }));
}

class FakeRes extends Writable {
  statusCode = 200;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  body = "";
  redirectedTo: string | null = null;
  _write(chunk: Buffer, _enc: BufferEncoding, cb: () => void) {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  setHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  getHeader(name: string) {
    return this.headers[name.toLowerCase()];
  }
  status(code: number) {
    this.statusCode = code;
    return this;
  }
  send(text: string) {
    this.body = text;
    this.end();
    return this;
  }
  redirect(code: number, to: string) {
    this.statusCode = code;
    this.redirectedTo = to;
    this.end();
    return this;
  }
  get bytes() {
    return Buffer.concat(this.chunks);
  }
  get finished() {
    return new Promise<void>((resolve) => (this.writableFinished ? resolve() : this.once("finish", resolve)));
  }
}

function request(token: string, extra: { kind?: string; range?: string; method?: string; go?: string } = {}) {
  return {
    method: extra.method ?? "GET",
    query: { token, ...(extra.kind ? { kind: extra.kind } : {}), ...(extra.go ? { go: extra.go } : {}) },
    headers: { host: "vintagesocial.app", ...(extra.range ? { range: extra.range } : {}) },
    on: () => undefined,
  } as never;
}

async function serveMedia(token: string, extra: Parameters<typeof request>[1] = {}) {
  const res = new FakeRes();
  await mediaHandler(request(token, extra), res as never);
  await res.finished;
  return res;
}

async function servePage(token: string, extra: Parameters<typeof request>[1] = {}) {
  const res = new FakeRes();
  await pageHandler(request(token, extra), res as never);
  return res;
}

/** Nothing in a reply may name the store or the file. */
function expectNoAddress(res: FakeRes, html = res.body) {
  const everything = `${JSON.stringify(res.headers)}\n${html}`;
  expect(everything).not.toContain("supabase");
  expect(everything).not.toContain("storage/v1");
  expect(everything).not.toContain("secret-folder");
  expect(everything).not.toContain("IMG_000");
  expect(everything).not.toContain("clip.mp4");
  expect(res.headers["location"]).toBeUndefined();
  expect(res.headers["x-served-from"]).toBeUndefined();
  expect(res.headers["etag"]).toBeUndefined();
}

beforeEach(() => {
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_URL", SUPABASE);
  vi.stubEnv("EXPO_PUBLIC_SUPABASE_ANON_KEY", "anon-key-for-tests");
  vi.stubGlobal("fetch", vi.fn(fakeFetch));
  storageFetches = [];
  databaseDown = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("the picture behind a shared link", () => {
  it("serves the photograph for a live token, and says nothing about where it lives", async () => {
    const res = await serveMedia(LIVE);
    expect(res.statusCode).toBe(200);
    expect(res.bytes.equals(PHOTO_BYTES)).toBe(true);
    expect(res.headers["content-type"]).toBe("image/jpeg");
    expect(res.headers["content-length"]).toBe(String(PHOTO_BYTES.length));
    expect(res.headers["cache-control"]).toContain("no-store");
    expect(res.headers["content-disposition"]).toBe('inline; filename="vintage.jpg"');
    expectNoAddress(res);
    // The server itself fetched the real file, once.
    expect(storageFetches).toEqual([`${SUPABASE}/storage/v1/object/public/media/chai/secret-folder/IMG_0001.jpg`]);
  });

  it("serves nothing once the share is turned off", async () => {
    const res = await serveMedia(REVOKED);
    expect(res.statusCode).toBe(404);
    expect(res.bytes.length).toBe(0);
    expect(storageFetches).toEqual([]);
    expectNoAddress(res);
  });

  it("serves nothing for a token that is not one, or is unknown", async () => {
    for (const bad of ["", "abc", "0123456789ABCDEF0123456789ABCDEG", `${LIVE}0`, "../media/x.jpg", UNKNOWN]) {
      const res = await serveMedia(bad);
      expect(res.statusCode, bad).toBe(404);
      expect(res.bytes.length, bad).toBe(0);
    }
    expect(storageFetches).toEqual([]);
    // A malformed token never even reaches the database.
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    expect(calls.filter((u) => u.includes("/rpc/"))).toHaveLength(1); // only UNKNOWN, which is well-formed
  });

  it("serves nothing for a post that was removed, or deleted outright", async () => {
    expect((await serveMedia(REMOVED_POST)).statusCode).toBe(404);
    expect((await serveMedia(DELETED_POST)).statusCode).toBe(404);
    expect(storageFetches).toEqual([]);
  });

  it("serves nothing for an author who is suspended, or not yet a member", async () => {
    expect((await serveMedia(SUSPENDED_AUTHOR)).statusCode).toBe(404);
    expect((await serveMedia(PENDING_AUTHOR)).statusCode).toBe(404);
    expect(storageFetches).toEqual([]);
  });

  it("streams a film with range requests, and its poster, under our own names", async () => {
    const part = await serveMedia(FILM, { range: "bytes=5-9" });
    expect(part.statusCode).toBe(206);
    expect(part.headers["content-type"]).toBe("video/mp4");
    expect(part.headers["content-range"]).toBe(`bytes 5-9/${FILM_BYTES.length}`);
    expect(part.headers["accept-ranges"]).toBe("bytes");
    expect(part.bytes.toString()).toBe("bytes");
    expect(part.headers["content-disposition"]).toBe('inline; filename="vintage.mp4"');
    expectNoAddress(part);

    const poster = await serveMedia(FILM, { kind: "poster" });
    expect(poster.statusCode).toBe(200);
    expect(poster.headers["content-type"]).toBe("image/jpeg");
    expect(storageFetches.at(-1)).toBe(`${SUPABASE}/storage/v1/object/public/thumbnails/chai/films/clip.jpg`);
    expectNoAddress(poster);

    const head = await serveMedia(FILM, { method: "HEAD" });
    expect(head.statusCode).toBe(200);
    expect(head.bytes.length).toBe(0);
    expect(head.headers["content-length"]).toBe(String(FILM_BYTES.length));
  });

  it("has no poster for a photograph", async () => {
    expect((await serveMedia(LIVE, { kind: "poster" })).statusCode).toBe(404);
  });

  it("answers 503, not 404, when the database cannot be reached — so a revoked link and an outage never look alike", async () => {
    databaseDown = true;
    const res = await serveMedia(LIVE);
    expect(res.statusCode).toBe(503);
    expect(res.bytes.length).toBe(0);
  });

  it("refuses methods other than GET and HEAD", async () => {
    expect((await serveMedia(LIVE, { method: "POST" })).statusCode).toBe(405);
  });
});

describe("the page a shared link opens", () => {
  it("points at our own media route and never at the store, even when told the path", async () => {
    const res = await servePage(LIVE);
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain(`src="https://vintagesocial.app/s/${LIVE}/media"`);
    expect(res.body).toContain(`<meta property="og:image" content="https://vintagesocial.app/s/${LIVE}/media">`);
    expect(res.body).toContain("FROM CHAI’S ARCHIVE");
    expectNoAddress(res);
  });

  it("points a film at our media and poster routes", async () => {
    const res = await servePage(FILM);
    expect(res.body).toContain(`<video class="picture" src="https://vintagesocial.app/s/${FILM}/media" poster="https://vintagesocial.app/s/${FILM}/poster"`);
    expectNoAddress(res);
  });

  it("says a turned-off, removed, deleted or suspended photograph is no longer shared — identically", async () => {
    const pages = await Promise.all([REVOKED, REMOVED_POST, DELETED_POST, SUSPENDED_AUTHOR, PENDING_AUTHOR, UNKNOWN].map((t) => servePage(t)));
    for (const res of pages) {
      expect(res.statusCode).toBe(404);
      expect(res.body).toContain("no longer shared");
      expect(res.body).not.toContain("ARCHIVE");
      expectNoAddress(res);
    }
    // Word for word the same body, token aside.
    const bodies = new Set(pages.map((r, i) => r.body.split([REVOKED, REMOVED_POST, DELETED_POST, SUSPENDED_AUTHOR, PENDING_AUTHOR, UNKNOWN][i]).join("TOKEN")));
    expect(bodies.size).toBe(1);
  });

  it("still sends a would-be member to the application form", async () => {
    const res = await servePage(LIVE, { go: "request" });
    expect(res.statusCode).toBe(302);
    expect(res.redirectedTo).toBe("/apply");
  });
});

describe("the small pure parts", () => {
  it("accepts only a 32-hex token, case-folded", () => {
    expect(cleanToken(` ${LIVE.toUpperCase()} `)).toBe(LIVE);
    expect(cleanToken("abc")).toBe("");
    expect(cleanToken(undefined)).toBe("");
  });

  it("builds a store address for a path and passes a whole address through", () => {
    const b = { url: SUPABASE, key: "k" };
    expect(storageUrl(b, "media", "a b/c.jpg")).toBe(`${SUPABASE}/storage/v1/object/public/media/a%20b/c.jpg`);
    expect(storageUrl(b, "media", "https://picsum.photos/id/1/1200/800")).toBe("https://picsum.photos/id/1/1200/800");
  });

  it("copies only the headers a browser needs, and names the file itself", () => {
    const upstream = new Headers({
      "content-type": "video/mp4; charset=binary",
      "content-length": "10",
      "content-range": "bytes 0-9/100",
      "x-amz-request-id": "leaky",
      "content-disposition": 'attachment; filename="chai/films/clip.mp4"',
    });
    const h = servedHeaders({ mediaType: "video", kind: "media" }, upstream);
    expect(h).toEqual({
      "Content-Type": "video/mp4",
      "Content-Disposition": 'inline; filename="vintage.mp4"',
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex",
      "Content-Length": "10",
      "Content-Range": "bytes 0-9/100",
    });
    // A store that says nothing useful about the type gets our sensible default.
    expect(servedHeaders({ mediaType: "photo", kind: "media" }, new Headers({ "content-type": "application/octet-stream" }))["Content-Type"]).toBe("image/jpeg");
    expect(servedHeaders({ mediaType: "video", kind: "poster" }, new Headers())["Content-Type"]).toBe("image/jpeg");
  });
});
