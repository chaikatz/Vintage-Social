import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting your own photograph: what the app asks the server and how it
 * reads the answer, the demo store keeping to the same rules, what a
 * message says once the photograph it carried is gone, and, read from the
 * source, the few lines of the screens that have to stay the way they are.
 *
 * The database half (migration 0021) is proven against PostgreSQL in
 * supabase/tests/06_post_deletion.sql.
 */

const h = vi.hoisted(() => ({
  demo: false,
  calls: [] as string[],
  deleteAnswer: { data: [] as { id: string }[] | null, error: null as unknown },
  lookAnswer: { data: null as { id: string } | null, error: null as unknown },
  thread: { data: [] as unknown[], error: null as unknown },
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: () => h.demo,
  isSupabaseConfigured: () => true,
  requireEnv: () => ({ supabaseUrl: "https://proj.supabase.co/", supabaseAnonKey: "anon-key" }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      delete: () => ({
        eq: (column: string, value: string) => ({
          select: async (columns: string) => {
            h.calls.push(`delete ${table} ${column}=${value} returning ${columns}`);
            return h.deleteAnswer;
          },
        }),
      }),
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: async () => {
            h.calls.push(`look ${table} ${columns} ${column}=${value}`);
            return h.lookAnswer;
          },
          order: async () => {
            h.calls.push(`read ${table} ${column}=${value}`);
            return h.thread;
          },
        }),
      }),
    }),
  },
}));

const { deleteOwnPost } = await import("@/api/posts");
const { fetchMessages } = await import("@/api/messages");
const { errorMessage } = await import("@/utils/errorMessage");
const demo = await import("@/demo/store");
const { PHOTOGRAPH_UNAVAILABLE, inboxPreview, photographUnavailable } = await import("@/utils/messageText");

const FALLBACK = "Nothing was removed. Try again in a moment.";

beforeEach(() => {
  h.demo = false;
  h.calls.length = 0;
  h.deleteAnswer = { data: [], error: null };
  h.lookAnswer = { data: null, error: null };
  h.thread = { data: [], error: null };
});

// ---------------------------------------------------------------------------
// The server's answer
// ---------------------------------------------------------------------------

describe("deleting your own post", () => {
  it("is done when the deleted row comes back, in one request", async () => {
    h.deleteAnswer = { data: [{ id: "p1" }], error: null };
    await expect(deleteOwnPost("p1")).resolves.toBeUndefined();
    expect(h.calls).toEqual(["delete posts id=p1 returning id"]);
  });

  it("is done when nothing was deleted because the post was already gone", async () => {
    // An earlier tap whose reply was lost, or a second tap.
    await expect(deleteOwnPost("p1")).resolves.toBeUndefined();
    expect(h.calls).toEqual(["delete posts id=p1 returning id", "look posts id id=p1"]);
  });

  it("is not done when nothing was deleted and the post is still there, and says so", async () => {
    h.lookAnswer = { data: { id: "p1" }, error: null };
    await expect(deleteOwnPost("p1")).rejects.toThrow("Only the author can delete a post.");
  });

  it("is not done when the look itself fails: no answer is not taken for gone", async () => {
    const lost = { message: "TypeError: Network request failed", details: "", hint: "", code: "" };
    h.lookAnswer = { data: null, error: lost };
    await expect(deleteOwnPost("p1")).rejects.toBe(lost);
  });

  it("passes a refusal on as it came, and the alert's words never show it", async () => {
    // The one in the logs: the message's CHECK, before migration 0021.
    const refused = {
      code: "23514",
      message: 'new row for relation "messages" violates check constraint "messages_check"',
      details: "Failing row contains (…).",
      hint: null,
    };
    h.deleteAnswer = { data: null, error: refused };
    const caught = await deleteOwnPost("p1").catch((err: unknown) => err);
    expect(caught).toBe(refused);
    expect(h.calls).toEqual(["delete posts id=p1 returning id"]);
    expect(errorMessage(caught, FALLBACK)).toBe(FALLBACK);
    expect(errorMessage(caught, FALLBACK)).not.toContain("[object Object]");
  });
});

// ---------------------------------------------------------------------------
// The demo store, which keeps to the same rules
// ---------------------------------------------------------------------------

describe("deleting in the demo", () => {
  beforeEach(() => {
    h.demo = true;
    demo.demoReset();
    demo.demoSignIn("reviewer@example.com");
  });

  it("refuses anyone else's post, as row-level security does", async () => {
    const theirs = demo.demoFetchPost("demo-post-06")!;
    expect(theirs.author_id).not.toBe(demo.demoCurrentProfile()!.id);
    await expect(deleteOwnPost("demo-post-06")).rejects.toThrow("Only the author can delete a post.");
    expect(demo.demoFetchPost("demo-post-06")).not.toBeNull();
  });

  it("deletes your own, and a second time is no error", async () => {
    const me = demo.demoCurrentProfile()!;
    const mine = demo.demoFetchUserPosts(me.id)[0];
    const before = me.post_count;
    await deleteOwnPost(mine.id);
    expect(demo.demoFetchPost(mine.id)).toBeNull();
    expect(demo.demoFetchUserPosts(me.id).some((p) => p.id === mine.id)).toBe(false);
    expect(demo.demoCurrentProfile()!.post_count).toBe(before - 1);
    await expect(deleteOwnPost(mine.id)).resolves.toBeUndefined();
  });

  it("keeps a message that carried it, with no photograph, as the database does", async () => {
    const me = demo.demoCurrentProfile()!;
    const mine = demo.demoFetchUserPosts(me.id)[0];
    const peer = "demo-user-tomas";
    const convo = demo.demoOpenConversation(me.id, peer);
    demo.demoSendMessage(convo, me.id, "", mine.id);
    await deleteOwnPost(mine.id);
    const last = demo.demoFetchMessages(convo).at(-1)!;
    expect(last).toMatchObject({ body: "", post_id: null, post: null });
    expect(photographUnavailable(last)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// A message whose photograph has gone
// ---------------------------------------------------------------------------

describe("a message whose photograph cannot be shown", () => {
  const shared = { id: "p1" };

  it("says so when it has no words", () => {
    expect(photographUnavailable({ body: "", post: null })).toBe(true);
    expect(PHOTOGRAPH_UNAVAILABLE).toBe("This photograph is no longer available.");
  });

  it("shows its words, or its photograph, and nothing more, when it has them", () => {
    expect(photographUnavailable({ body: "look", post: null })).toBe(false);
    expect(photographUnavailable({ body: "", post: shared })).toBe(false);
    expect(photographUnavailable({ body: "look", post: shared })).toBe(false);
  });

  it("says nothing of a photograph not read yet", () => {
    expect(photographUnavailable({ body: "", post: undefined })).toBe(false);
  });

  it("reads the same in the inbox", () => {
    expect(inboxPreview(null)).toBe("Say something.");
    expect(inboxPreview({ body: "look", post_id: null })).toBe("look");
    expect(inboxPreview({ body: "", post_id: "p1" })).toBe("Sent a photograph");
    expect(inboxPreview({ body: "", post_id: null })).toBe(PHOTOGRAPH_UNAVAILABLE);
  });
});

describe("a photograph in a thread, as the thread reads it", () => {
  // What the thread read of a photograph is kept across polls by post id, so each test sends its own.
  const sentWith = (postId: string) => ({
    id: `m-${postId}`,
    conversation_id: "c1",
    sender_id: "u2",
    body: "",
    post_id: postId,
    created_at: "2026-10-01T00:00:00.000Z",
    read_at: null,
  });
  const reads = (postId: string) => h.calls.filter((c) => c.startsWith("look posts") && c.endsWith(`id=${postId}`)).length;

  it("does not take a failed read for gone, and reads it again on the next poll", async () => {
    h.thread = { data: [sentWith("p-blip")], error: null };
    h.lookAnswer = { data: null, error: { message: "TypeError: Network request failed", details: "", hint: "", code: "" } };
    const [first] = await fetchMessages("c1");
    expect(first.post).toBeUndefined();
    expect(photographUnavailable(first)).toBe(false);

    h.lookAnswer = { data: { id: "p-blip" }, error: null };
    const [next] = await fetchMessages("c1");
    expect(next.post).toMatchObject({ id: "p-blip" });
    expect(reads("p-blip")).toBe(2);
  });

  it("says it is no longer available when the server answers without it, and keeps that answer", async () => {
    h.thread = { data: [sentWith("p-hidden")], error: null };
    const [first] = await fetchMessages("c1");
    expect(first.post).toBeNull();
    expect(photographUnavailable(first)).toBe(true);
    await fetchMessages("c1");
    expect(reads("p-hidden")).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Read from the source
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, "..");
/** Without comments, so prose that names what is not done is not taken as doing it. */
const source = (file: string) =>
  readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the delete, as the screens do it", () => {
  const actions = source("src/hooks/usePostActions.ts");

  it("asks once more, with a destructive Delete beside Cancel, before anything is deleted", () => {
    const sheet = /text: "Delete post",[\s\S]*?\{ text: "Cancel", style: "cancel" \},\s*\]\s*,?\s*\)/.exec(actions)?.[0] ?? "";
    expect(sheet).toMatch(/style: "destructive"/);
    expect(sheet).toMatch(/showAlert\(\s*`Delete this \$\{what\}\?`/);
    expect(sheet).toMatch(/\{ text: "Delete", style: "destructive", onPress: \(\) => void deletePost\(post, afterDelete\) \}/);
    expect(sheet).not.toMatch(/deleteOwnPost/);
  });

  it("puts a refusal in the member's words, never the error printed as text", () => {
    const run = /const deletePost = useCallback\([\s\S]*?\n {2}\);/.exec(actions)?.[0] ?? "";
    expect(run).toMatch(/showAlert\(`Couldn’t delete this \$\{what\}`, errorMessage\(err, "Nothing was removed\. Try again in a moment\."\)\)/);
    expect(actions).not.toMatch(/String\(err\)/);
  });

  it("lets the outbox go first, then clears every screen, only once the server has said yes", () => {
    const run = /const deletePost = useCallback\([\s\S]*?\n {2}\);/.exec(actions)?.[0] ?? "";
    const deleted = run.indexOf("await deleteOwnPost(post.id)");
    const refused = run.indexOf("return;");
    const outbox = run.indexOf("notePostDeleted(post.id)");
    const screens = run.indexOf("removePostEverywhere(queryClient, post.id)");
    expect(deleted).toBeGreaterThan(-1);
    expect(refused).toBeGreaterThan(deleted);
    expect(outbox).toBeGreaterThan(refused);
    expect(screens).toBeGreaterThan(outbox);
  });

  it("holds the outbox's insert while the delete is out, and lets it go only on a refusal", () => {
    const run = /const deletePost = useCallback\([\s\S]*?\n {2}\);/.exec(actions)?.[0] ?? "";
    const held = run.indexOf("holdPost(post.id, true)");
    const deleted = run.indexOf("await deleteOwnPost(post.id)");
    const caught = run.indexOf("catch (err)");
    const released = run.indexOf("holdPost(post.id, false)");
    const refused = run.indexOf("return;");
    expect(held).toBeGreaterThan(-1);
    expect(deleted).toBeGreaterThan(held);
    expect(caught).toBeGreaterThan(deleted);
    expect(released).toBeGreaterThan(caught);
    expect(refused).toBeGreaterThan(released);
    expect(run.match(/holdPost\(/g)).toHaveLength(2);
  });

  it("asks the server for the deleted row and looks again when none came back", () => {
    const api = source("src/api/posts.ts");
    const fn = /export async function deleteOwnPost[\s\S]*?\n\}/.exec(api)?.[0] ?? "";
    expect(fn).toMatch(/\.delete\(\)\.eq\("id", postId\)\.select\("id"\)/);
    expect(fn).toMatch(/\.maybeSingle\(\)/);
    // No storage call rides along in this change.
    expect(fn).not.toMatch(/storage/);
  });
});

describe("the other alerts that printed errors as text", () => {
  it("account deletion and sending a photograph use the same words", () => {
    const settings = source("app/settings.tsx");
    expect(settings).toMatch(/"Couldn’t delete the account",\s*errorMessage\(err, "Your account is still here\. Try again in a moment\."\)/);
    const share = source("app/share.tsx");
    expect(share).toMatch(/const why = errorMessage\(err, ""\)/);
    for (const file of ["app/settings.tsx", "app/share.tsx", "app/messages/[id].tsx"]) {
      expect(source(file)).not.toMatch(/err instanceof Error \? err\.message : String\(err\)/);
    }
  });
});

describe("the thread and the inbox", () => {
  it("draw the line for a message with no words and no photograph, in place of an empty bubble", () => {
    const thread = source("app/messages/[id].tsx");
    const bubble = /function Bubble\([\s\S]*?\n\}\n/.exec(thread)?.[0] ?? "";
    expect(bubble).toMatch(/photographUnavailable\(message\) \? \(\s*<Text[^>]*>\{PHOTOGRAPH_UNAVAILABLE\}<\/Text>/);
    const inbox = source("app/messages/index.tsx");
    expect(inbox).toMatch(/const preview = inboxPreview\(last\)/);
  });
});

describe("migration 0021", () => {
  const sql = readFileSync(path.join(root, "supabase/migrations/0021_messages_outlive_their_photograph.sql"), "utf8");
  const statements = sql.replace(/^\s*--.*$/gm, "");

  it("moves the rule to a trigger that never fires for the foreign key's SET NULL", () => {
    expect(statements).toMatch(/before insert or update of body on public\.messages/);
    expect(statements).not.toMatch(/update of body, post_id|update of post_id/);
    expect(statements).toMatch(/alter table public\.messages drop constraint if exists messages_check;/);
    expect(statements).toMatch(/using errcode = 'check_violation', constraint = 'messages_check'/);
  });

  it("leaves members only read_at to update, and touches no policy", () => {
    expect(statements).toMatch(/revoke update on public\.messages from anon, authenticated;\s*grant update \(read_at\) on public\.messages to authenticated;/);
    expect(statements).toMatch(/revoke execute on function public\.check_message_not_empty\(\) from public, anon, authenticated;/);
    expect(statements).not.toMatch(/\bpolicy\b/i);
  });

  it("leaves the transaction to the runner, like the others, and can be run again", () => {
    expect(statements).not.toMatch(/^\s*(begin|commit);/m);
    expect(statements).toMatch(/create or replace function/);
    expect(statements).toMatch(/drop trigger if exists messages_not_empty on public\.messages;/);
  });
});
