import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Applying, and joining by invitation, make the account first and then do
 * more. When a later step failed, trying again began by making the account
 * again and was refused ("User already registered"), and the person could
 * not apply at all. A try after a failure now carries on with the account
 * the first try made (src/api/membership.ts): the one signed in, when it
 * is the same email, or the one the typed password opens.
 */

type Row = Record<string, unknown>;

const h = vi.hoisted(() => ({
  session: null as null | { user: { id: string; email: string } },
  accounts: [] as { id: string; email: string; password: string }[],
  profiles: [] as { id: string; username: string; avatar_url?: string | null }[],
  applications: [] as Row[],
  failApplicationInsert: 0,
  failRedeem: 0,
  redeemed: [] as string[],
  calls: [] as string[],
  taken: new Set<string>(),
}));

vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
vi.mock("@/api/media", () => ({
  prepareAvatar: async (uri: string) => ({ uri }),
  uploadFile: async (_bucket: string, path: string) => path,
}));
vi.mock("@/lib/supabase", () => {
  const table = (name: string) => {
    const filters: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    let patch: Row | null = null;
    q.select = () => q;
    q.eq = (c: string, v: unknown) => {
      filters.push([c, v]);
      return q;
    };
    q.order = () => q;
    q.limit = () => q;
    const rows = () => {
      const all = name === "applications" ? h.applications : (h.profiles as unknown as Row[]);
      return all.filter((r) => filters.every(([c, v]) => r[c] === v));
    };
    q.maybeSingle = async () => ({ data: rows()[0] ?? null, error: null });
    q.update = (p: Row) => {
      patch = p;
      return q;
    };
    q.insert = async (row: Row) => {
      h.calls.push(`insert ${name}`);
      if (name === "applications" && h.failApplicationInsert > 0) {
        h.failApplicationInsert--;
        return { error: { message: "Network request failed" } };
      }
      h.applications.push({ ...row, created_at: new Date().toISOString() });
      return { error: null };
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (patch) for (const r of rows()) Object.assign(r, patch);
      return Promise.resolve({ error: null }).then(resolve);
    };
    return q;
  };
  return {
    supabase: {
      from: table,
      rpc: async (fn: string, args: Row) => {
        h.calls.push(`rpc ${fn}`);
        if (fn === "username_available") return { data: !h.profiles.some((p) => p.username === args.p_username), error: null };
        if (fn === "redeem_invite_link") {
          if (h.failRedeem > 0) {
            h.failRedeem--;
            return { data: null, error: { message: "Network request failed" } };
          }
          const me = h.session!.user.id;
          const already = h.redeemed.includes(me);
          h.redeemed.push(me);
          return { data: already ? "already_member" : "joined", error: null };
        }
        throw new Error(`rpc ${fn}`);
      },
      auth: {
        getSession: async () => ({ data: { session: h.session } }),
        signUp: async ({ email, password, options }: { email: string; password: string; options: { data: { username: string } } }) => {
          h.calls.push("signUp");
          if (h.accounts.some((a) => a.email === email.toLowerCase())) {
            return { data: { user: null, session: null }, error: { message: "User already registered", code: "user_already_exists" } };
          }
          const user = { id: `u${h.accounts.length + 1}`, email: email.toLowerCase() };
          h.accounts.push({ ...user, password });
          h.profiles.push({ id: user.id, username: options.data.username });
          h.session = { user };
          return { data: { user, session: h.session }, error: null };
        },
        signInWithPassword: async ({ email, password }: { email: string; password: string }) => {
          h.calls.push("signIn");
          const a = h.accounts.find((x) => x.email === email.toLowerCase() && x.password === password);
          if (!a) return { data: { user: null, session: null }, error: { message: "Invalid login credentials" } };
          h.session = { user: { id: a.id, email: a.email } };
          return { data: { user: h.session.user, session: h.session }, error: null };
        },
      },
    },
  };
});

const { submitApplication, joinWithInvite, checkUsernameAvailable } = await import("@/api/membership");

const application = {
  email: "Ada@Example.test",
  password: "correct horse",
  fullName: "Ada",
  desiredUsername: "ada.l",
  avatarUri: "file:///portrait.jpg",
  socialHandle: "",
  city: "London",
  inviter: "",
  reason: "Photographs of engines, mostly, and the people who run them.",
};

beforeEach(() => {
  h.session = null;
  h.accounts = [];
  h.profiles = [];
  h.applications = [];
  h.failApplicationInsert = 0;
  h.failRedeem = 0;
  h.redeemed = [];
  h.calls = [];
});

describe("an application that failed part-way", () => {
  it("is finished by trying again, still signed in: one account, one application", async () => {
    h.failApplicationInsert = 1;
    await expect(submitApplication(application)).rejects.toBeTruthy();
    expect(h.accounts.length).toBe(1);
    expect(h.applications.length).toBe(0);
    // The form asks whether the name is free first: it is theirs.
    expect(await checkUsernameAvailable("ada.l")).toBe(true);
    await submitApplication(application);
    expect(h.accounts.length).toBe(1);
    expect(h.applications.length).toBe(1);
    expect(h.calls.filter((c) => c === "signUp").length).toBe(1);
  });

  it("and after the app was closed (signed out): the password they typed opens the account it made", async () => {
    h.failApplicationInsert = 1;
    await expect(submitApplication(application)).rejects.toBeTruthy();
    h.session = null;
    await submitApplication(application);
    expect(h.accounts.length).toBe(1);
    expect(h.applications.length).toBe(1);
    expect(h.calls).toContain("signIn");
  });

  it("a try after one that filed it does nothing more", async () => {
    await submitApplication(application);
    h.calls = [];
    await submitApplication(application);
    expect(h.applications.length).toBe(1);
    expect(h.calls).not.toContain("insert applications");
  });

  it("an email that has an account the typed password does not open is refused, as before", async () => {
    h.accounts.push({ id: "someone", email: "ada@example.test", password: "another" });
    await expect(submitApplication(application)).rejects.toMatchObject({ message: "User already registered" });
    expect(h.applications.length).toBe(0);
  });

  it("a name someone else has is still taken", async () => {
    h.profiles.push({ id: "someone", username: "ada.l" });
    expect(await checkUsernameAvailable("ada.l")).toBe(false);
    h.session = { user: { id: "u9", email: "x@example.test" } };
    h.profiles.push({ id: "u9", username: "x.y" });
    expect(await checkUsernameAvailable("ada.l")).toBe(false);
  });
});

describe("joining by invitation, after a try that failed part-way", () => {
  const invite = { email: "bo@example.test", password: "hunter22", fullName: "Bo", desiredUsername: "bo", code: "ada-l" };

  it("carries on with the account the first try made, and takes up the invitation once", async () => {
    h.failRedeem = 1;
    await expect(joinWithInvite(invite)).rejects.toBeTruthy();
    expect(h.accounts.length).toBe(1);
    await joinWithInvite(invite);
    expect(h.accounts.length).toBe(1);
    expect(h.redeemed).toEqual(["u1"]);
  });

  it("an invitation already taken up by that account (the answer lost) is done, not a failure", async () => {
    await joinWithInvite(invite);
    await joinWithInvite(invite);
    expect(h.redeemed).toEqual(["u1", "u1"]);
    expect(h.accounts.length).toBe(1);
  });
});
