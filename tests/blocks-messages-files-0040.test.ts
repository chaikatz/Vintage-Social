import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isDatabaseCaller, PUSH_SECRET_HEADER } from "../supabase/functions/push/logic";

/**
 * Migration 0040 and the app's half of it: a block holds for comments
 * and likes (and their notices) and reaches the admins; a new message is
 * notified, and its notice stays out of the Activity tab; the avatars
 * bucket takes pictures only; the push function answers only the
 * database. And, beside it, a member's deleted post takes its files with
 * it.
 *
 * The database half is proven against PostgreSQL in
 * supabase/tests/18_blocks_messages_files_0040.sql (npm run test:rls);
 * this holds the files to what that one proves, and tests the client
 * and the push function's caller check where they run.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");
const migration = () => code(read("supabase/migrations/0040_blocks_messages_and_files.sql"));

const h = vi.hoisted(() => ({
  demo: false,
  calls: [] as string[],
  removed: [] as string[],
  removal: "ok" as "ok" | "refused" | "throws" | "hangs",
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: () => h.demo,
  isSupabaseConfigured: () => true,
  requireEnv: () => ({ supabaseUrl: "https://proj.supabase.co/", supabaseAnonKey: "anon-key" }),
}));

vi.mock("@/lib/supabase", () => {
  // A query, written down call by call, that answers with no rows.
  const query = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
          }
          return (...args: unknown[]) => {
            h.calls.push(`${String(prop)}(${args.map((a) => JSON.stringify(a)).join(", ")})`);
            return query();
          };
        },
      },
    );
  return {
    supabase: {
      from: (table: string) => {
        h.calls.push(`from(${JSON.stringify(table)})`);
        return query();
      },
      storage: {
        from: (bucket: string) => ({
          remove: async (paths: string[]) => {
            h.removed.push(`${bucket}:${paths.join(",")}`);
            if (h.removal === "throws") throw new Error("Network request failed");
            if (h.removal === "hangs") return new Promise(() => undefined);
            if (h.removal === "refused") return { data: null, error: { message: "new row violates row-level security policy" } };
            return { data: paths.map((name) => ({ name })), error: null };
          },
        }),
      },
    },
  };
});

const { fetchActivity, PUSH_ONLY_ACTIVITY } = await import("@/api/activity");
const { removeDeletedPostFiles } = await import("@/api/posts");

beforeEach(() => {
  h.demo = false;
  h.calls.length = 0;
  h.removed.length = 0;
  h.removal = "ok";
});

// ---------------------------------------------------------------------------
// 1-2. a block holds for comments, likes and their notices
// ---------------------------------------------------------------------------
describe("0040: no comment or like across a block", () => {
  it("refuses them with one restrictive insert policy each, for members, asking a check that reads past row-level security", () => {
    const sql = migration();
    for (const [table, name] of [["comments", "comments: none across a block"], ["likes", "likes: none across a block"]]) {
      expect(sql).toContain(`drop policy if exists "${name}" on public.${table};`);
      expect(sql).toMatch(
        new RegExp(
          `create policy "${name}" on public\\.${table}\\s+as restrictive for insert to authenticated\\s+with check \\(not private\\.post_across_a_block\\(post_id\\)\\);`,
        ),
      );
    }
    // Read through the posts policies, the photograph of a member who
    // blocked the caller is hidden, and a "not exists" on it would pass:
    // the check is a definer, in private, answering only about the caller.
    const fn = sql.slice(sql.indexOf("create or replace function private.post_across_a_block"), sql.indexOf("revoke execute on function private.post_across_a_block"));
    expect(fn).toMatch(/security definer\s+set search_path = ''/);
    expect(fn).toMatch(/b\.blocker_id = p\.author_id and b\.blocked_id = \(select auth\.uid\(\)\)/);
    expect(fn).toMatch(/b\.blocked_id = p\.author_id and b\.blocker_id = \(select auth\.uid\(\)\)/);
    expect(sql).toContain("revoke execute on function private.post_across_a_block(uuid) from public, anon, authenticated;");
    expect(sql).toContain("grant execute on function private.post_across_a_block(uuid) to authenticated;");
    // It is not one of the pair checks 0023's rewrite counts (blocked_between / blocked_by).
    expect(sql).not.toMatch(/create policy[^;]*blocked_(between|by)\(/);
  });

  it("files no like, comment or tag notice between two members on either side of a block", () => {
    const sql = migration();
    for (const fn of ["notify_like", "notify_comment", "notify_tag"]) {
      const body = sql.slice(sql.indexOf(`create or replace function public.${fn}()`));
      const own = body.slice(0, body.indexOf("$$;") + 3);
      expect(own, fn).toMatch(/security definer set search_path = public/);
      expect(own, fn).toMatch(/not exists \(\s+select 1 from public\.blocks b/);
    }
    expect(sql).toMatch(/revoke execute on function public\.notify_like\(\), public\.notify_comment\(\), public\.notify_tag\(\)\s+from public, anon, authenticated;/);
  });

  it("is proven by the policy harness, and 0023's rewrite test knows the two policies as later ones", () => {
    const runner = read("supabase/tests/run.mjs");
    expect(runner).toMatch(/"17_follows_0038\.sql",\s+"18_blocks_messages_files_0040\.sql",/);
    const test = read("supabase/tests/18_blocks_messages_files_0040.sql");
    expect(test).toMatch(/\\ir \.\.\/migrations\/0040_blocks_messages_and_files\.sql/);
    expect(test.trim().endsWith("rollback;")).toBe(true);
    expect(read("supabase/tests/08_policy_rewrite.sql")).toMatch(
      /\('comments', 'comments: none across a block'\),\s+\('likes', 'likes: none across a block'\)\)\)\),/,
    );
  });
});

// ---------------------------------------------------------------------------
// 3. a block reaches the admins
// ---------------------------------------------------------------------------
describe("0040: a block reaches the admins", () => {
  const body = () => {
    const sql = migration();
    const from = sql.indexOf("create or replace function public.block_member(p_user uuid)");
    return sql.slice(from, sql.indexOf("$$;", from));
  };

  it("files a report about the member blocked, as the member who blocked, once a block and only while none of theirs is open", () => {
    const fn = body();
    expect(fn).toMatch(/on conflict do nothing;\s+v_new := found;/);
    expect(fn).toMatch(/if v_new\s+and public\.is_active_member\(v_me\)\s+and not exists \(/);
    expect(fn).toMatch(/r\.reporter_id = v_me and r\.target_type = 'profile'\s+and r\.profile_id = p_user and r\.status = 'open'/);
    expect(fn).toMatch(/insert into public\.reports \(reporter_id, target_type, profile_id, reason\)\s+values \(v_me, 'profile', p_user, 'Blocked by a member'\);/);
    // Still everything a block did before.
    expect(fn).toMatch(/delete from public\.follows/);
    expect(fn).toMatch(/delete from public\.post_tags\s+where status = 'pending'/);
  });

  it("goes through the reports queue the admins already work, and its notice (0032)", () => {
    // A member report: the admin screen opens the member; nothing of the
    // blocker's view is hidden by it (0033 hides only a reported photograph).
    expect(read("app/admin/reports.tsx")).toContain('report.target_type === "profile"');
    expect(read("supabase/migrations/0033_what_a_member_reports_leaves_their_view.sql")).toMatch(/r\.post_id is not null/);
    expect(read("supabase/migrations/0032_reports_reach_the_admins.sql")).toMatch(/after insert on public\.reports/);
  });

  it("is said to App Review, on the support page and in the Privacy Policy", async () => {
    const notes = read("APP_STORE_LAUNCH.md").replace(/\n> /g, " ");
    expect(notes).toContain("A block also tells the admins: it files a report about the blocked member in their queue.");
    expect(read("scripts/build-legal.mjs")).toContain("A block also tells the admins, as a report about that member.");
    expect(read("public/support.html")).toContain("A block also tells the admins, as a report about that member.");
    const { PRIVACY_POLICY } = await import("@/legal/documents");
    expect(PRIVACY_POLICY).toContain("When you block a member, the admins are told which member you blocked, as a report about them.");
  });
});

// ---------------------------------------------------------------------------
// 4. a message is notified; its notice is not in the Activity tab
// ---------------------------------------------------------------------------
describe("0040: a message is notified", () => {
  it("files a 'message' notice for the other member of the thread, never the sender, never across a block", () => {
    const sql = migration();
    const fn = sql.slice(sql.indexOf("create or replace function private.notify_message()"), sql.indexOf("revoke execute on function private.notify_message()"));
    expect(fn).toMatch(/security definer\s+set search_path = ''/);
    expect(fn).toMatch(/case when c\.user_a = new\.sender_id then c\.user_b else c\.user_a end/);
    expect(fn).toMatch(/new\.sender_id in \(c\.user_a, c\.user_b\)/);
    expect(fn).toMatch(/if v_other is null or v_other = new\.sender_id then/);
    expect(fn).toMatch(/select 1 from public\.blocks b/);
    // Who sent one, to whom: nothing of the message itself.
    expect(fn).toMatch(/insert into public\.activity \(recipient_id, actor_id, type\)\s+values \(v_other, new\.sender_id, 'message'\);/);
    expect(sql).toContain("revoke execute on function private.notify_message() from public, anon, authenticated;");
    expect(sql).toMatch(/drop trigger if exists messages_notify_trigger on public\.messages;\s+create trigger messages_notify_trigger\s+after insert on public\.messages\s+for each row execute function private\.notify_message\(\);/);
    // 'message' was already an Activity type (0006, 0015), so no constraint changes.
    expect(read("supabase/migrations/0015_tags_and_places.sql")).toMatch(/'message', 'tag'\)\);/);
    expect(sql).not.toMatch(/activity_type_check/);
  });

  it("is sent by the deployed function as it is, opening the inbox, unless the member turned Messages off", () => {
    const fn = read("supabase/functions/push/index.ts");
    const door = fn.slice(fn.indexOf('case "message":'), fn.indexOf('case "moderation":'));
    expect(door).toMatch(/if \(!prefs\.messages\) return \{ sent: 0, reason: "muted" \};/);
    expect(door).toMatch(/body = `\$\{who\} sent you a message\.`;/);
    expect(door).toMatch(/data\.route = "\/messages";/);
    expect(read("app/settings.tsx")).toMatch(/messages/);
  });

  it("is left out of the Activity tab, which asks for every other kind", async () => {
    expect(PUSH_ONLY_ACTIVITY).toBe("message");
    await fetchActivity("u1");
    expect(h.calls).toContain('from("activity")');
    expect(h.calls).toContain('eq("recipient_id", "u1")');
    expect(h.calls).toContain('neq("type", "message")');
    // Asked before the page is cut, so a run of messages never empties the tab.
    expect(h.calls.indexOf('neq("type", "message")')).toBeLessThan(h.calls.findIndex((c) => c.startsWith("limit(")));
  });

  it("and out of the demo's Activity too", () => {
    expect(read("src/demo/store.ts")).toMatch(/\.filter\(\(a\) => a\.recipient_id === userId && a\.type !== "message"\)/);
  });

  it("is the only reader of Activity in the app, and the inbox counts its own unread messages", () => {
    for (const file of ["app/(tabs)/_layout.tsx", "app/messages/index.tsx", "src/api/messages.ts"]) {
      expect(read(file), file).not.toMatch(/from\("activity"\)/);
    }
    expect(read("src/api/messages.ts")).toMatch(/unread_message_counts/);
  });
});

// ---------------------------------------------------------------------------
// 5. the avatars bucket takes portraits only
// ---------------------------------------------------------------------------
describe("0040: the avatars bucket", () => {
  it("takes JPEG and PNG up to 2 MB; media and thumbnails are left as they are", () => {
    const sql = migration();
    expect(sql).toMatch(
      /update storage\.buckets\s+set file_size_limit = 2097152,\s+allowed_mime_types = array\['image\/jpeg', 'image\/png'\]\s+where id = 'avatars';/,
    );
    expect(sql).not.toMatch(/where id (=|in) [^;]*'(media|thumbnails)'/);
  });

  it("still takes what the app uploads there: a 512-pixel JPEG portrait, sent as image/jpeg", () => {
    expect(read("src/api/media.ts")).toMatch(/export function prepareAvatar\(uri: string\): Promise<PreparedImage> \{\s+return resizeJpeg\(uri, 512, 0\.85\);/);
    expect(read("src/api/membership.ts")).toMatch(/uploadFile\("avatars", `\$\{user\.id\}\/avatar\.jpg`, avatar\.uri, "image\/jpeg"/);
    expect(read("app/settings.tsx")).toMatch(/uploadFile\("avatars", `\$\{userId\}\/avatar-\$\{Date\.now\(\)\}\.jpg`, prepared\.uri, "image\/jpeg"\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. the push function answers only the database
// ---------------------------------------------------------------------------
describe("0040: the push function's caller", () => {
  const SECRET = "4f1c2a9e7d3b5c6a8e0f1d2c3b4a5968";

  it("admits a call with the secret it holds, and nothing else", () => {
    expect(isDatabaseCaller(SECRET, SECRET)).toBe(true);
    expect(isDatabaseCaller(null, SECRET)).toBe(false);
    expect(isDatabaseCaller("", SECRET)).toBe(false);
    expect(isDatabaseCaller(SECRET.slice(0, -1), SECRET)).toBe(false);
    expect(isDatabaseCaller(SECRET + "0", SECRET)).toBe(false);
    expect(isDatabaseCaller(SECRET.replace(/.$/, "x"), SECRET)).toBe(false);
    // The anon key, the bearer of every copy of the app, is no secret.
    expect(isDatabaseCaller("eyJhbGciOiJIUzI1NiJ9.anon", SECRET)).toBe(false);
  });

  it("admits nothing when it holds no secret: it cannot tell its caller", () => {
    expect(isDatabaseCaller(SECRET, "")).toBe(false);
    expect(isDatabaseCaller(SECRET, undefined)).toBe(false);
    expect(isDatabaseCaller("", "")).toBe(false);
    expect(isDatabaseCaller(undefined, undefined)).toBe(false);
  });

  it("asks before it reads the body or does anything, and says no with 401", () => {
    const fn = read("supabase/functions/push/index.ts").replace(/\/\/.*$/gm, "");
    expect(fn).toMatch(/const PUSH_SECRET = Deno\.env\.get\("PUSH_HOOK_SECRET"\) \?\? "";/);
    const serve = fn.slice(fn.indexOf("Deno.serve("));
    const check = serve.indexOf("if (!isDatabaseCaller(req.headers.get(PUSH_SECRET_HEADER), PUSH_SECRET))");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(serve.indexOf("await req.json()"));
    expect(check).toBeLessThan(serve.indexOf("switch (payload.kind)"));
    expect(serve.slice(check, serve.indexOf("let payload"))).toMatch(/return new Response\("Not allowed", \{ status: 401 \}\);/);
    // No secret in the repository: the function reads its own.
    expect(fn).not.toMatch(/PUSH_SECRET\s*=\s*"[^"]/);
  });

  it("is sent by push_event under the same header, from the hook, only when the hook has one", () => {
    expect(PUSH_SECRET_HEADER).toBe("x-push-secret");
    const sql = migration();
    const fn = sql.slice(sql.indexOf("create or replace function public.push_event"));
    expect(fn).toMatch(
      new RegExp(`\\|\\| case when coalesce\\(v_hook->>'secret', ''\\) <> ''\\s+then jsonb_build_object\\('${PUSH_SECRET_HEADER}', v_hook->>'secret'\\)\\s+else '\\{\\}'::jsonb`),
    );
    // Everything else as 0017 sent it.
    expect(fn).toMatch(/'Authorization', 'Bearer ' \|\| \(v_hook->>'key'\)/);
    expect(fn).toMatch(/body {4}:= jsonb_build_object\('kind', p_kind, 'id', p_id\)/);
    expect(fn).toMatch(/exception when others then/);
    expect(sql).toContain("revoke execute on function public.push_event(text, uuid) from public, anon, authenticated;");
  });

  it("is set up in the order that never stops a notice, as step 4 says", () => {
    const doc = read("APP_STORE_LAUNCH.md");
    const step = doc.slice(doc.indexOf("### Step 4"), doc.indexOf("### Step 5"));
    const at = (s: string) => step.indexOf(s);
    expect(at("npx supabase secrets set PUSH_HOOK_SECRET=")).toBeGreaterThan(0);
    expect(at("update public.app_settings set value = value || jsonb_build_object('secret'")).toBeGreaterThan(at("npx supabase secrets set PUSH_HOOK_SECRET="));
    expect(at("4. Deploy the function as above (it shows version 3)")).toBeGreaterThan(at("update public.app_settings set value"));
  });
});

// ---------------------------------------------------------------------------
// a member's deleted post takes its files with it
// ---------------------------------------------------------------------------
describe("deleting your own post removes its files", () => {
  const post = {
    author_id: "u1",
    media_path: "u1/p1.mp4",
    thumb_path: "u1/p1.jpg",
  };

  it("removes the photograph or film and its thumbnail, each from its own bucket", async () => {
    await removeDeletedPostFiles(post);
    expect(h.removed.sort()).toEqual(["media:u1/p1.mp4", "thumbnails:u1/p1.jpg"]);
  });

  it("removes only what is in the author's own folder, and never an address on another site", async () => {
    await removeDeletedPostFiles({ author_id: "u1", media_path: "u2/p1.jpg", thumb_path: null });
    await removeDeletedPostFiles({
      author_id: "u1",
      media_path: "https://upload.wikimedia.org/u1/x.jpg",
      thumb_path: "u1",
    });
    expect(h.removed).toEqual([]);
  });

  it("never throws, whatever storage says, and never waits for good", async () => {
    for (const removal of ["refused", "throws"] as const) {
      h.removal = removal;
      await expect(removeDeletedPostFiles(post)).resolves.toBeUndefined();
    }
    vi.useFakeTimers();
    try {
      h.removal = "hangs";
      const done = removeDeletedPostFiles(post);
      await vi.advanceTimersByTimeAsync(16_000);
      await expect(done).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing in the demo", async () => {
    h.demo = true;
    await removeDeletedPostFiles(post);
    expect(h.removed).toEqual([]);
  });

  it("is asked only after the server said the row is gone, and nothing waits on it", () => {
    const hook = read("src/hooks/usePostActions.ts");
    const fn = hook.slice(hook.indexOf("const deletePost = useCallback("), hook.indexOf("const onMore = useCallback("));
    const deleted = fn.indexOf("await deleteOwnPost(post.id);");
    const caught = fn.indexOf("} catch (err) {");
    const removed = fn.indexOf("void removeDeletedPostFiles(post);");
    expect(deleted).toBeGreaterThan(0);
    expect(removed).toBeGreaterThan(fn.indexOf("notePostDeleted(post.id);"));
    // Not in the refusal's path: there the post is still live.
    expect(removed).toBeGreaterThan(fn.indexOf("return;", caught));
    expect(fn).not.toMatch(/await removeDeletedPostFiles/);
    // The words it is deleted under are now true of the file too.
    expect(hook).toContain("It’s removed for good.");
  });
});
