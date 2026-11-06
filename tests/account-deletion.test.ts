import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting an account removes the member's files through the Storage API,
 * the one path that removes the bytes as well as the rows. One list call
 * returns at most a thousand names without saying there are more, and the
 * database's backstop (0018) removes only the rows of what is left, not
 * the files: a member with more than a thousand files in a bucket would
 * leave the rest in a public bucket after deleting their account.
 */

const h = vi.hoisted(() => ({
  files: {} as Record<string, string[]>,
  lists: [] as { bucket: string; folder: string; limit?: number; offset?: number }[],
  removed: {} as Record<string, string[][]>,
  failListAt: null as null | { bucket: string; offset: number },
  rpc: [] as string[],
}));

vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/utils/push", () => ({ forgetPushToken: async () => undefined }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        list: async (folder: string, opts: { limit?: number; offset?: number } = {}) => {
          h.lists.push({ bucket, folder, limit: opts.limit, offset: opts.offset });
          if (h.failListAt && h.failListAt.bucket === bucket && h.failListAt.offset === (opts.offset ?? 0)) {
            return { data: null, error: { message: "list failed" } };
          }
          // Storage caps a page at the limit asked for, and at a thousand.
          const limit = Math.min(opts.limit ?? 100, 1000);
          const all = [...(h.files[bucket] ?? [])].sort();
          const page = all.slice(opts.offset ?? 0, (opts.offset ?? 0) + limit).map((name) => ({ name, id: name }));
          return { data: page, error: null };
        },
        remove: async (paths: string[]) => {
          (h.removed[bucket] ??= []).push(paths);
          return { data: paths, error: null };
        },
      }),
    },
    rpc: async (name: string) => {
      h.rpc.push(name);
      return { error: null };
    },
    auth: { signOut: async () => ({ error: null }) },
  },
}));

const { deleteMyAccount, FILES_PER_LIST } = await import("@/api/account");

const ME = "00000000-0000-4000-8000-000000000001";
const names = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(5, "0")}.jpg`);

beforeEach(() => {
  h.files = {};
  h.lists.length = 0;
  h.removed = {};
  h.failListAt = null;
  h.rpc.length = 0;
});

describe("deleting an account removes every file, not the first thousand", () => {
  it("lists a folder of 2,350 photographs page by page and removes all of them, a hundred at a time", async () => {
    h.files.media = names(2350, "p");
    h.files.thumbnails = names(2350, "t");
    h.files.avatars = ["avatar.jpg"];
    await deleteMyAccount(ME);

    for (const bucket of ["media", "thumbnails"]) {
      const removed = (h.removed[bucket] ?? []).flat();
      expect(removed.length, bucket).toBe(2350);
      expect(new Set(removed).size, bucket).toBe(2350);
      expect(removed.every((p) => p.startsWith(`${ME}/`)), bucket).toBe(true);
      expect(Math.max(...(h.removed[bucket] ?? []).map((b) => b.length)), bucket).toBeLessThanOrEqual(100);
      const offsets = h.lists.filter((l) => l.bucket === bucket).map((l) => l.offset ?? 0);
      expect(offsets, bucket).toEqual([0, FILES_PER_LIST, 2 * FILES_PER_LIST]);
    }
    expect((h.removed.avatars ?? []).flat()).toEqual([`${ME}/avatar.jpg`]);
    expect(h.rpc).toEqual(["delete_my_account"]);
  });

  it("reads one more page when a folder holds exactly a thousand, and stops at the empty one", async () => {
    h.files.media = names(1000, "p");
    await deleteMyAccount(ME);
    expect((h.removed.media ?? []).flat().length).toBe(1000);
    expect(h.lists.filter((l) => l.bucket === "media").map((l) => l.offset ?? 0)).toEqual([0, 1000]);
  });

  it("removes what it could list when a later page cannot be read, and still deletes the account", async () => {
    h.files.media = names(1500, "p");
    h.failListAt = { bucket: "media", offset: 1000 };
    await deleteMyAccount(ME);
    expect((h.removed.media ?? []).flat().length).toBe(1000);
    expect(h.rpc).toEqual(["delete_my_account"]);
  });
});
