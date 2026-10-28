import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { seedAuthor, seedPost } from "@/utils/profileSeed";
import type { PostRow, ProfileRow } from "@/types/db";

/**
 * What a profile hands the screen a tap opens: the gallery's author and a
 * single post with its author, in the shapes those screens ask for, aged
 * as the grid is so they still read again when it is stale.
 */

const profile = {
  id: "u1",
  username: "tomas.lindqvist",
  full_name: "Tomas Lindqvist",
  avatar_url: "u1/avatar.jpg",
  bio: "North light.",
  member_no: 3,
} as unknown as ProfileRow;

const row = (id: string, author = "u1"): PostRow =>
  ({
    id,
    author_id: author,
    media_type: "video",
    media_path: `${author}/${id}.mp4`,
    thumb_path: `${author}/${id}.jpg`,
    caption: "Last ferry of the evening.",
    taken_at: "2026-10-20T18:00:00.000Z",
    created_at: "2026-10-21T18:00:00.000Z",
    location: "Stockholm",
    like_count: 2,
    comment_count: 0,
  }) as unknown as PostRow;

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe("seeding the gallery's author", () => {
  it("puts the profile under the key the gallery asks for, aged as the grid", () => {
    const qc = client();
    seedAuthor(qc, profile, 1_000);
    expect(qc.getQueryData(["profile-by-id", "u1"])).toBe(profile);
    expect(qc.getQueryState(["profile-by-id", "u1"])?.dataUpdatedAt).toBe(1_000);
  });

  it("leaves a newer copy alone", () => {
    const qc = client();
    const fresher = { ...profile, username: "tomas" } as ProfileRow;
    qc.setQueryData(["profile-by-id", "u1"], fresher, { updatedAt: 5_000 });
    seedAuthor(qc, profile, 1_000);
    expect(qc.getQueryData(["profile-by-id", "u1"])).toBe(fresher);
  });

  it("is stale when the grid is, so the gallery still reads it again", () => {
    const qc = client();
    seedAuthor(qc, profile, Date.now() - 60_000);
    expect(qc.getQueryCache().find({ queryKey: ["profile-by-id", "u1"] })?.isStaleByTime(30_000)).toBe(true);
  });
});

describe("seeding a single post", () => {
  it("attaches the author in the shape fetchPost returns", () => {
    const qc = client();
    seedPost(qc, row("p1"), profile, 2_000);
    expect(qc.getQueryData(["post", "p1"])).toEqual({
      ...row("p1"),
      author: { id: "u1", username: "tomas.lindqvist", full_name: "Tomas Lindqvist", avatar_url: "u1/avatar.jpg" },
    });
    expect(qc.getQueryState(["post", "p1"])?.dataUpdatedAt).toBe(2_000);
  });

  it("leaves a photograph you were tagged in to be read as before", () => {
    const qc = client();
    seedPost(qc, { ...row("p2", "u9"), tagged_in: true }, profile, 2_000);
    seedPost(qc, row("p3", "u9"), profile, 2_000);
    expect(qc.getQueryData(["post", "p2"])).toBeUndefined();
    expect(qc.getQueryData(["post", "p3"])).toBeUndefined();
  });

  it("carries no grid-only mark", () => {
    const qc = client();
    seedPost(qc, { ...row("p4"), tagged_in: false }, profile, 2_000);
    expect(qc.getQueryData<Record<string, unknown>>(["post", "p4"])).not.toHaveProperty("tagged_in");
  });

  it("leaves a newer copy alone", () => {
    const qc = client();
    const fresher = { ...row("p5"), like_count: 9, author: { id: "u1" } };
    qc.setQueryData(["post", "p5"], fresher, { updatedAt: 9_000 });
    seedPost(qc, row("p5"), profile, 2_000);
    expect(qc.getQueryData(["post", "p5"])).toBe(fresher);
  });
});
