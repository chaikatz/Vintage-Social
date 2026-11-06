import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting an account (src/api/account.ts), in its order: the only-admin
 * refusal first, then the member's files through the Storage API until
 * each folder lists empty, then the database function, then the session.
 *
 * One list call returns at most a thousand names without saying there are
 * more, and the database's backstop (0018) removes only the rows of what
 * is left, not the files: a folder not emptied would leave photographs in
 * a public bucket after the account had gone. So a folder that cannot be
 * emptied stops the deletion with the account whole, and the last step,
 * which comes after the files are gone, is tried again on a dropped
 * connection. A retry after any failure finishes the deletion.
 */

type Fail = { status?: number; message: string; code?: string };

const h = vi.hoisted(() => ({
  files: {} as Record<string, string[]>,
  lists: [] as { bucket: string; folder: string; limit?: number; offset?: number }[],
  removed: {} as Record<string, string[][]>,
  /** Fail the list of this bucket at this offset, this many more times. */
  failList: null as null | { bucket: string; offset: number; times: number; error: Fail },
  failRemove: null as null | { bucket: string; times: number; error: Fail },
  rpcAnswers: [] as (Fail | null)[],
  rpc: [] as string[],
  role: "member",
  otherAdmins: 1,
  profileReads: 0,
  signedOut: 0,
}));

vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/utils/push", () => ({ forgetPushToken: async () => undefined }));
vi.mock("@/lib/supabase", () => {
  const profiles = () => {
    const q: Record<string, unknown> = {};
    let head = false;
    q.select = (_cols: string, opts?: { head?: boolean }) => {
      head = Boolean(opts?.head);
      return q;
    };
    q.eq = () => q;
    q.neq = () => q;
    q.maybeSingle = async () => {
      h.profileReads++;
      return { data: { role: h.role }, error: null };
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      h.profileReads++;
      return Promise.resolve(head ? { count: h.otherAdmins, data: null, error: null } : { data: [], error: null }).then(resolve);
    };
    return q;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table !== "profiles") throw new Error(`unexpected table ${table}`);
        return profiles();
      },
      storage: {
        from: (bucket: string) => ({
          list: async (folder: string, opts: { limit?: number; offset?: number } = {}) => {
            h.lists.push({ bucket, folder, limit: opts.limit, offset: opts.offset });
            const f = h.failList;
            if (f && f.bucket === bucket && f.offset === (opts.offset ?? 0) && f.times > 0) {
              f.times--;
              return { data: null, error: f.error };
            }
            // Storage caps a page at the limit asked for, and at a thousand.
            const limit = Math.min(opts.limit ?? 100, 1000);
            const all = [...(h.files[bucket] ?? [])].sort();
            const page = all.slice(opts.offset ?? 0, (opts.offset ?? 0) + limit).map((name) => ({ name, id: name }));
            return { data: page, error: null };
          },
          remove: async (paths: string[]) => {
            const f = h.failRemove;
            if (f && f.bucket === bucket && f.times > 0) {
              f.times--;
              return { data: null, error: f.error };
            }
            (h.removed[bucket] ??= []).push(paths);
            const gone = new Set(paths.map((p) => p.split("/").slice(1).join("/")));
            h.files[bucket] = (h.files[bucket] ?? []).filter((n) => !gone.has(n));
            return { data: paths, error: null };
          },
        }),
      },
      rpc: async (name: string) => {
        h.rpc.push(name);
        const answer = h.rpcAnswers.length ? h.rpcAnswers.shift()! : null;
        return { error: answer };
      },
      auth: {
        signOut: async () => {
          h.signedOut++;
          return { error: null };
        },
      },
    },
  };
});

const { deleteMyAccount, FILES_PER_LIST, FILES_NOT_REMOVED, ONLY_ADMIN } = await import("@/api/account");

const ME = "00000000-0000-4000-8000-000000000001";
const names = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => `${prefix}-${String(i).padStart(5, "0")}.jpg`);
const noWait = { sleep: async () => undefined };
const offline: Fail = { message: "Network request failed" };

beforeEach(() => {
  h.files = {};
  h.lists.length = 0;
  h.removed = {};
  h.failList = null;
  h.failRemove = null;
  h.rpcAnswers = [];
  h.rpc.length = 0;
  h.role = "member";
  h.otherAdmins = 1;
  h.profileReads = 0;
  h.signedOut = 0;
});

describe("deleting an account removes every file, not the first thousand", () => {
  it("lists a folder of 2,350 photographs page by page, removes all of them a hundred at a time, and lists it empty", async () => {
    h.files.media = names(2350, "p");
    h.files.thumbnails = names(2350, "t");
    h.files.avatars = ["avatar.jpg"];
    await deleteMyAccount(ME, noWait);

    for (const bucket of ["media", "thumbnails"]) {
      const removed = (h.removed[bucket] ?? []).flat();
      expect(removed.length, bucket).toBe(2350);
      expect(new Set(removed).size, bucket).toBe(2350);
      expect(removed.every((p) => p.startsWith(`${ME}/`)), bucket).toBe(true);
      expect(Math.max(...(h.removed[bucket] ?? []).map((b) => b.length)), bucket).toBeLessThanOrEqual(100);
      const offsets = h.lists.filter((l) => l.bucket === bucket).map((l) => l.offset ?? 0);
      // Every page read before anything is removed, then the folder read again: empty.
      expect(offsets, bucket).toEqual([0, FILES_PER_LIST, 2 * FILES_PER_LIST, 0]);
    }
    expect((h.removed.avatars ?? []).flat()).toEqual([`${ME}/avatar.jpg`]);
    expect(h.rpc).toEqual(["delete_my_account"]);
    expect(h.signedOut).toBe(1);
  });

  it("reads one more page when a folder holds exactly a thousand, and stops at the empty one", async () => {
    h.files.media = names(1000, "p");
    await deleteMyAccount(ME, noWait);
    expect((h.removed.media ?? []).flat().length).toBe(1000);
    expect(h.lists.filter((l) => l.bucket === "media").map((l) => l.offset ?? 0)).toEqual([0, 1000, 0]);
  });
});

describe("a folder that cannot be emptied stops the deletion with the account whole", () => {
  it("a page that cannot be read is tried again, and the deletion finishes", async () => {
    h.files.media = names(1500, "p");
    h.failList = { bucket: "media", offset: 1000, times: 1, error: offline };
    await deleteMyAccount(ME, noWait);
    expect(h.files.media).toEqual([]);
    expect(h.rpc).toEqual(["delete_my_account"]);
  });

  it("one that cannot be read at all: nothing more is removed, the account is not deleted, the member is told", async () => {
    h.files.media = names(1500, "p");
    h.files.avatars = ["avatar.jpg"];
    h.failList = { bucket: "media", offset: 1000, times: 99, error: offline };
    await expect(deleteMyAccount(ME, noWait)).rejects.toThrow(FILES_NOT_REMOVED);
    // Its first page was never taken for the whole folder.
    expect(h.removed.media).toBeUndefined();
    expect(h.removed.avatars).toBeUndefined();
    expect(h.rpc).toEqual([]);
    expect(h.signedOut).toBe(0);
  });

  it("storage refusing a remove is not taken for done", async () => {
    h.files.thumbnails = names(30, "t");
    h.failRemove = { bucket: "thumbnails", times: 99, error: { status: 403, message: "new row violates row-level security policy" } };
    await expect(deleteMyAccount(ME, noWait)).rejects.toThrow(FILES_NOT_REMOVED);
    expect(h.rpc).toEqual([]);
  });

  it("a remove dropped once is tried again", async () => {
    h.files.thumbnails = names(30, "t");
    h.failRemove = { bucket: "thumbnails", times: 1, error: { status: 503, message: "Service Unavailable" } };
    await deleteMyAccount(ME, noWait);
    expect(h.files.thumbnails).toEqual([]);
    expect(h.rpc).toEqual(["delete_my_account"]);
  });
});

describe("the last step, after the files are gone", () => {
  it("is tried again on a dropped connection, and finishes", async () => {
    h.files.media = names(3, "p");
    h.rpcAnswers = [offline, offline, null];
    await deleteMyAccount(ME, noWait);
    expect(h.rpc).toEqual(["delete_my_account", "delete_my_account", "delete_my_account"]);
    expect(h.signedOut).toBe(1);
  });

  it("is not tried again when the database refuses it, and says why", async () => {
    h.rpcAnswers = [{ code: "P0001", message: ONLY_ADMIN }];
    await expect(deleteMyAccount(ME, noWait)).rejects.toMatchObject({ code: "P0001" });
    expect(h.rpc).toEqual(["delete_my_account"]);
  });

  it("a try after it failed for good finishes the deletion: the folders list empty, the account goes", async () => {
    h.files.media = names(40, "p");
    h.rpcAnswers = [offline, offline, offline];
    await expect(deleteMyAccount(ME, noWait)).rejects.toBeTruthy();
    expect(h.files.media).toEqual([]);
    h.lists.length = 0;
    await deleteMyAccount(ME, noWait);
    expect(h.lists.map((l) => l.offset ?? 0)).toEqual([0, 0, 0]);
    expect(h.rpc.length).toBe(4);
    expect(h.signedOut).toBe(1);
  });
});

describe("the only admin", () => {
  it("is refused before anything is removed", async () => {
    h.role = "admin";
    h.otherAdmins = 0;
    h.files.media = names(5, "p");
    await expect(deleteMyAccount(ME, noWait)).rejects.toThrow(ONLY_ADMIN);
    expect(h.lists).toEqual([]);
    expect(h.removed).toEqual({});
    expect(h.rpc).toEqual([]);
  });

  it("an admin with another admin beside them may go", async () => {
    h.role = "admin";
    h.otherAdmins = 1;
    await deleteMyAccount(ME, noWait);
    expect(h.rpc).toEqual(["delete_my_account"]);
  });
});
