import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HookSecret, isDatabaseCaller, PUSH_SECRET_HEADER } from "../supabase/functions/push/logic";

/**
 * Migration 0040 and the app's half of it: a block holds for comments
 * and likes (and their notices) and reaches the admins; a new message is
 * notified, and its notice stays out of the Activity tab; the avatars
 * bucket takes pictures only; the push function answers only the
 * database. And, beside it, a member's deleted post takes its files with
 * it.
 *
 * The database half is proven against PostgreSQL in
 * supabase/tests/19_blocks_messages_files_0040.sql (npm run test:rls);
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
    expect(runner).toMatch(/"17_follows_0038\.sql",\s+"18_writes_0039\.sql",\s+"19_blocks_messages_files_0040\.sql",/);
    const test = read("supabase/tests/19_blocks_messages_files_0040.sql");
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
    // The secret is read where the database keeps it, with the service key; a failed read throws.
    expect(fn).toMatch(
      /const hookSecret = new HookSecret\(async \(\) => \{\s*const \{ data, error \} = await admin\.from\("app_settings"\)\.select\("value"\)\.eq\("key", "push_hook"\)\.maybeSingle\(\);\s*if \(error\) throw error;\s*return \(data\?\.value as \{ secret\?: unknown \} \| null \| undefined\)\?\.secret;\s*\}\);/,
    );
    expect(fn.indexOf("const admin = createClient(")).toBeLessThan(fn.indexOf("const hookSecret = new HookSecret("));
    const serve = fn.slice(fn.indexOf("Deno.serve("));
    const check = serve.indexOf("if (!(await hookSecret.admits(req.headers.get(PUSH_SECRET_HEADER))))");
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(serve.indexOf("await req.json()"));
    expect(check).toBeLessThan(serve.indexOf("switch (payload.kind)"));
    expect(serve.slice(check, serve.indexOf("let payload"))).toMatch(/return new Response\("Not allowed", \{ status: 401 \}\);/);
    // One place the secret lives: nothing set on the function stands in for it, and none is in the repository.
    expect(fn).not.toMatch(/PUSH_HOOK_SECRET/);
    expect(read("supabase/functions/push/logic.ts")).not.toMatch(/Deno\.env|PUSH_HOOK_SECRET/);
    expect(fn).not.toMatch(/"[0-9a-f]{32,}"/);
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

  it("holds the hook's secret as the database keeps it: read once, kept, read again when old or, now and then, on a mismatch", async () => {
    let clock = 0;
    let stored: unknown = SECRET;
    let reads = 0;
    const secret = new HookSecret(async () => {
      reads++;
      return stored;
    }, () => clock, 600_000, 15_000);
    // A call with no secret reads nothing.
    expect(await secret.admits(null)).toBe(false);
    expect(await secret.admits("")).toBe(false);
    expect(reads).toBe(0);
    // The first call reads; the rest use what was read.
    expect(await secret.admits(SECRET)).toBe(true);
    expect(await secret.admits(SECRET)).toBe(true);
    expect(reads).toBe(1);
    // A wrong one soon after reads nothing more.
    clock = 5_000;
    expect(await secret.admits("wrong")).toBe(false);
    expect(reads).toBe(1);
    // The hook rewritten: a call with the new secret, once a while has passed, reads again and is let in.
    stored = "a-new-secret-the-database-made";
    clock = 20_000;
    expect(await secret.admits("a-new-secret-the-database-made")).toBe(true);
    expect(reads).toBe(2);
    expect(await secret.admits(SECRET)).toBe(false);
    expect(reads).toBe(2);
    // Old, it is read again.
    clock = 20_000 + 600_000;
    expect(await secret.admits("a-new-secret-the-database-made")).toBe(true);
    expect(reads).toBe(3);
    expect(secret.trouble).toBe(null);
  });

  it("refuses everything while the hook has no secret, or cannot be read, and shares one read among calls that come together", async () => {
    let clock = 0;
    let reads = 0;
    let answer: () => Promise<unknown> = async () => undefined;
    const secret = new HookSecret(() => {
      reads++;
      return answer();
    }, () => clock, 600_000, 15_000);
    expect(await secret.admits(SECRET)).toBe(false);
    expect(secret.trouble).toBe("no secret");
    answer = async () => {
      throw new Error("timed out");
    };
    clock = 20_000;
    expect(await secret.admits(SECRET)).toBe(false);
    expect(secret.trouble).toBe("unreadable");
    answer = async () => 42;
    clock = 40_000;
    expect(await secret.admits(SECRET)).toBe(false);
    // Together, one read.
    let release: (v: unknown) => void = () => undefined;
    answer = () => new Promise((resolve) => (release = resolve));
    clock = 60_000;
    reads = 0;
    const calls = [secret.admits(SECRET), secret.admits(SECRET), secret.admits(SECRET)];
    await Promise.resolve();
    release(SECRET);
    expect(await Promise.all(calls)).toEqual([true, true, true]);
    expect(reads).toBe(1);
  });

  it("keeps the secret it holds when a read fails, and says why it refuses when it holds none", async () => {
    let clock = 0;
    let reads = 0;
    let answer: () => Promise<unknown> = async () => SECRET;
    const secret = new HookSecret(() => {
      reads++;
      return answer();
    }, () => clock, 600_000, 15_000);
    expect(secret.trouble).toBe(null);
    expect(await secret.admits(SECRET)).toBe(true);
    // Old, and the read fails (a timeout, the API busy): what was held stays, and the database's calls still go through.
    answer = async () => {
      throw new Error("timed out");
    };
    clock = 600_000;
    expect(await secret.admits(SECRET)).toBe(true);
    expect(reads).toBe(2);
    clock = 605_000;
    expect(await secret.admits(SECRET)).toBe(true);
    expect(secret.trouble).toBe(null);
    // A fresh function whose first read fails holds nothing: it refuses, and says the hook could not be read.
    clock = 0;
    const fresh = new HookSecret(async () => {
      throw new Error("timed out");
    }, () => clock, 600_000, 15_000);
    expect(await fresh.admits(SECRET)).toBe(false);
    expect(fresh.trouble).toBe("unreadable");
    // A hook with no secret, read fine: "no secret".
    const none = new HookSecret(async () => undefined, () => clock, 600_000, 15_000);
    expect(await none.admits(SECRET)).toBe(false);
    expect(none.trouble).toBe("no secret");
  });

  it("is made in the database and kept there: a trigger gives the hook one, keeping the one it had", () => {
    const sql = migration();
    const fn = sql.slice(sql.indexOf("create or replace function private.push_hook_keeps_a_secret()"));
    expect(fn).toMatch(/^create or replace function private\.push_hook_keeps_a_secret\(\)\s+returns trigger\s+language plpgsql\s+set search_path = ''/);
    expect(fn).toMatch(/if new\.key = 'push_hook'\s+and jsonb_typeof\(new\.value\) = 'object'\s+and \(coalesce\(jsonb_typeof\(new\.value->'secret'\), ''\) <> 'string'\s+or new\.value->>'secret' = ''\) then/);
    // The one it had is the row there, so an update and an insert that replaces the row both keep it.
    expect(fn).toMatch(/\(select nullif\(s\.value->>'secret', ''\)\s+from public\.app_settings s\s+where s\.key = 'push_hook'\s+and jsonb_typeof\(s\.value\) = 'object'\s+and jsonb_typeof\(s\.value->'secret'\) = 'string'\),/);
    expect(fn).toMatch(/replace\(pg_catalog\.gen_random_uuid\(\)::text \|\| pg_catalog\.gen_random_uuid\(\)::text, '-', ''\)/);
    expect(sql).toContain("revoke execute on function private.push_hook_keeps_a_secret() from public, anon, authenticated;");
    expect(sql).toMatch(/drop trigger if exists app_settings_push_hook_secret on public\.app_settings;\s+create trigger app_settings_push_hook_secret\s+before insert or update on public\.app_settings\s+for each row execute function private\.push_hook_keeps_a_secret\(\);/);
    // The hook as it is gets one now; run again, it keeps it.
    expect(sql).toMatch(/update public\.app_settings set value = value where key = 'push_hook';/);
    expect(sql.indexOf("update public.app_settings set value = value where key = 'push_hook';")).toBeGreaterThan(sql.indexOf("create trigger app_settings_push_hook_secret"));
  });

  it("needs no secret from the owner: step 4 says 0040, then version 3, and nothing to copy", () => {
    const doc = read("APP_STORE_LAUNCH.md");
    const step = doc.slice(doc.indexOf("### Step 4"), doc.indexOf("### Step 5"));
    expect(step).not.toMatch(/openssl rand|secrets set PUSH_HOOK_SECRET|jsonb_build_object\('secret'/);
    expect(step).toMatch(/0040 makes the secret in the database/);
    expect(step.indexOf("Deploy version 3 only after 0040")).toBeGreaterThan(0);
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
