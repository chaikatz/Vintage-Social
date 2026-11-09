import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0039: members write only what the app writes. What it does to the
 * database is proven on PostgreSQL by npm run test:rls
 * (supabase/tests/18_writes_0039.sql, every hole tried and refused and
 * every write the app makes tried and allowed, and the owner's verify
 * script 12, rows 49-60). These hold the migration to the app where vitest
 * runs without a database: each table's granted columns are exactly the
 * columns the app's writes send, so a new column in a write fails here,
 * with the line to add to the migration, before it fails on a phone.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");
const FILE = "supabase/migrations/0039_writes_only_what_the_app_writes.sql";
const sql = () => code(read(FILE));

/** The columns 0039 grants members on a table, for one privilege, sorted. */
function granted(table: string, privilege: "insert" | "update"): string[] {
  const re = new RegExp(`grant ${privilege} \\(([^)]*)\\)\\s+on public\\.${table} to authenticated;`);
  const m = sql().match(re);
  if (!m) return [];
  return m[1].split(",").map((c) => c.trim()).filter(Boolean).sort();
}

/** The keys of the object literal that starts at the first `{` after `from`. */
function objectKeys(text: string, from: number): string[] {
  const open = text.indexOf("{", from);
  let depth = 0;
  let end = open;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}") depth--;
    if (depth === 0) {
      end = i;
      break;
    }
  }
  const body = text.slice(open + 1, end).replace(/\/\/[^\n]*/g, "");
  // Top-level entries only: split on commas outside brackets and calls.
  const entries: string[] = [];
  let level = 0;
  let current = "";
  for (const ch of body) {
    if ("([{".includes(ch)) level++;
    if (")]}".includes(ch)) level--;
    if (ch === "," && level === 0) {
      entries.push(current);
      current = "";
    } else current += ch;
  }
  entries.push(current);
  const keys: string[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (!entry) continue;
    if (entry.startsWith("...")) continue;
    const m = entry.match(/^(\w+)\s*(:|$)/);
    if (m) keys.push(m[1]);
  }
  return keys.sort();
}

/** The keys of the object a write sends: the first `marker` in `file`, then its object literal. */
function sent(file: string, marker: string): string[] {
  const text = read(file);
  const at = text.indexOf(marker);
  expect(at, `${file}: ${marker}`).toBeGreaterThanOrEqual(0);
  return objectKeys(text, at + marker.length - 1);
}

/** The fields of an exported interface. */
function fields(file: string, name: string): string[] {
  const text = read(file);
  const at = text.indexOf(`export interface ${name} {`);
  expect(at, `${file}: interface ${name}`).toBeGreaterThanOrEqual(0);
  const body = text.slice(text.indexOf("{", at) + 1, text.indexOf("\n}", at));
  return [...body.matchAll(/^\s+(\w+)\??:/gm)].map((m) => m[1]).sort();
}

describe("0039: the columns members may write are the columns the app sends", () => {
  it("a new photograph: every field of NewPost, which the outbox sends whole", () => {
    expect(granted("posts", "insert")).toEqual(fields("src/api/posts.ts", "NewPost"));
    expect(read("src/api/posts.ts")).toMatch(/supabase\.from\("posts"\)\.insert\(post\)/);
    expect(read("src/uploads/outbox.ts")).toMatch(/function newPostFor\(job: OutboxJob\): NewPost \{/);
  });

  it("a photograph changed: its caption, from Edit caption", () => {
    expect(granted("posts", "update")).toEqual(["caption"]);
    expect(sent("src/api/posts.ts", '.from("posts")\n    .update(')).toEqual(["caption"]);
  });

  it("a profile: what Settings and sign-up change, and nothing filed", () => {
    expect(granted("profiles", "update")).toEqual(fields("src/api/profiles.ts", "ProfileEdits"));
    expect(sent("src/api/membership.ts", '.from("profiles").update(')).toEqual(["avatar_url"]);
    expect(granted("profiles", "insert")).toEqual([]);
    expect(sql()).toMatch(/revoke insert, update on public\.profiles from anon, authenticated;/);
  });

  it("an application: what the Apply form sends", () => {
    expect(granted("applications", "insert")).toEqual(sent("src/api/membership.ts", '.from("applications").insert('));
  });

  it("conversations, messages, tags, comments, likes, follows, reports, share records and notices", () => {
    expect(granted("conversations", "insert")).toEqual(sent("src/api/messages.ts", '.from("conversations")\n    .insert('));
    expect(granted("conversations", "update")).toEqual([]);
    expect(granted("messages", "insert")).toEqual(sent("src/api/messages.ts", '.from("messages").insert('));
    expect(sent("src/api/messages.ts", '.from("messages")\n    .update(')).toEqual(["read_at"]);
    // tagMembers maps each member to { post_id, user_id, tagged_by }, all
    // together and, if one is refused, each on its own.
    const tags = read("src/api/tags.ts");
    expect(tags).toMatch(/const row = \(user_id: string\) => \(\{ post_id: postId, user_id, tagged_by: taggedBy \}\);/);
    expect(tags).toMatch(/\.from\("post_tags"\)\.insert\(ids\.map\(row\)\)/);
    expect(tags).toMatch(/\.from\("post_tags"\)\.insert\(row\(id\)\)/);
    expect((tags.match(/\.from\("post_tags"\)\.insert\(/g) ?? []).length).toBe(2);
    expect(granted("post_tags", "insert")).toEqual(["post_id", "tagged_by", "user_id"]);
    expect(granted("post_tags", "update")).toEqual(sent("src/api/tags.ts", '.from("post_tags")\n    .update('));
    expect(granted("comments", "insert")).toEqual(sent("src/api/posts.ts", '.from("comments")\n    .insert('));
    expect(granted("likes", "insert")).toEqual(sent("src/api/posts.ts", '.from("likes").insert('));
    expect(granted("follows", "insert")).toEqual(sent("src/api/profiles.ts", '.from("follows")\n    .insert('));
    expect(granted("reports", "insert")).toEqual(sent("src/api/moderation.ts", 'await supabase.from("reports").insert('));
    expect(granted("share_events", "insert")).toEqual(sent("src/api/shares.ts", '.from("share_events").insert('));
    expect(granted("activity", "update")).toEqual(sent("src/api/activity.ts", '.from("activity")\n    .update('));
    expect(granted("activity", "insert")).toEqual([]);
  });

  it("takes each table's privilege back whole before giving columns of it, and gives visitors nothing", () => {
    const s = sql();
    for (const [, privileges, table] of [...s.matchAll(/grant (insert|update) \([^)]*\)\s+on public\.(\w+) to authenticated;/g)]) {
      const revoke = s.search(new RegExp(`revoke [a-z, ]*\\b${privileges}\\b[a-z, ]* on [a-z_., ]*public\\.${table}\\b[a-z_., ]* from anon, authenticated;`));
      const grant = s.search(new RegExp(`grant ${privileges} \\([^)]*\\)\\s+on public\\.${table} to authenticated;`));
      expect(revoke, `${table} ${privileges}: taken back first`).toBeGreaterThanOrEqual(0);
      expect(revoke, `${table} ${privileges}: taken back first`).toBeLessThan(grant);
    }
    expect(s).not.toMatch(/grant [^;]* to [^;]*\banon\b/i);
    expect(s).not.toMatch(/\bservice_role\b/);
    // Follows' and messages' updates are 0038's and 0021's: left alone.
    expect(s).not.toMatch(/revoke [a-z, ]*update[a-z, ]* on public\.(follows|messages)\b/);
    expect(s).toMatch(
      /revoke insert, update on public\.app_settings, public\.blocks, public\.invite_links, public\.invites,\s+public\.moderation_actions, public\.post_shares from anon, authenticated;/,
    );
    expect(s).toMatch(/revoke insert, update on public\.era_edits, public\.notification_prefs, public\.push_tokens from anon;/);
  });
});

describe("0039: files from the member's own folder, as the app names them", () => {
  const OWN = "'/[A-Za-z0-9_-][A-Za-z0-9._-]*$'";

  it("the outbox names a photograph's files {member}/{post id}.{ext}, and Settings a portrait {member}/avatar-{time}.jpg", () => {
    expect(read("src/utils/storagePath.ts")).toMatch(/return `\$\{userId\}\/\$\{filename\}`;/);
    const outbox = read("src/uploads/outbox.ts");
    expect(outbox).toMatch(/return ownedPath\(job\.draft\.userId, `\$\{job\.id\}\.\$\{job\.prepared\?\.ext \?\? "jpg"\}`\);/);
    expect(outbox).toMatch(/return ownedPath\(job\.draft\.userId, `\$\{job\.id\}\.jpg`\);/);
    expect(read("app/settings.tsx")).toMatch(/uploadFile\("avatars", `\$\{userId\}\/avatar-\$\{Date\.now\(\)\}\.jpg`/);
    expect(read("src/api/membership.ts")).toMatch(/uploadFile\("avatars", `\$\{user\.id\}\/avatar\.jpg`/);
    // Each of those is one name, one level down, in the folder the pattern allows.
    const own = new RegExp("^0a390000-0000-4000-8000-000000000001/[A-Za-z0-9_-][A-Za-z0-9._-]*$");
    for (const name of ["0b390000-0000-4000-8000-000000000011.jpg", "0B390000-0000-4000-8000-000000000012.mov", "avatar.jpg", "avatar-1762600000000.jpg"]) {
      expect(`0a390000-0000-4000-8000-000000000001/${name}`).toMatch(own);
    }
    for (const bad of ["https://attacker.example/x.jpg", "0a390000-0000-4000-8000-000000000002/x.jpg", "0a390000-0000-4000-8000-000000000001/../x/y.jpg", "0a390000-0000-4000-8000-000000000001/..", "0a390000-0000-4000-8000-000000000001/a/b.jpg", "x.jpg"]) {
      expect(bad).not.toMatch(own);
    }
  });

  it("asks it of a new photograph's two files, a profile's portrait and an application's, in restrictive policies", () => {
    const s = sql();
    const pattern = `('^' || (select auth.uid())::text || ${OWN})`;
    expect(s).toContain(`media_path ~ ${pattern}`);
    expect(s).toContain(`thumb_path ~ ${pattern}`);
    expect(s.split(`avatar_url ~ ${pattern}`).length - 1).toBe(2);
    for (const [name, table, cmd] of [
      ["posts: files from the author's own folder", "posts", "insert"],
      ["applications: a portrait from the applicant's own folder", "applications", "insert"],
      ["posts: a caption while live, by a member", "posts", "update"],
      ["profiles: own-folder portrait, nothing while suspended", "profiles", "update"],
      ["messages: read marks by the member they were sent to", "messages", "update"],
    ]) {
      expect(name.length, `${name}: within PostgreSQL's 63 characters`).toBeLessThanOrEqual(63);
      expect(s).toContain(`drop policy if exists "${name}" on public.${table};`);
      expect(s).toContain(`create policy "${name}" on public.${table}\n  as restrictive for ${cmd}`);
    }
    // 0023's rewrite test knows them as policies a later migration added.
    const rewrite = read("supabase/tests/08_policy_rewrite.sql");
    for (const name of ["posts: files from the author''s own folder", "posts: a caption while live, by a member",
      "applications: a portrait from the applicant''s own folder", "profiles: own-folder portrait, nothing while suspended",
      "messages: read marks by the member they were sent to"]) {
      expect(rewrite).toContain(`'${name}')`);
    }
  });

  it("a caption only while the photograph is up and its author a member; a profile not while suspended", () => {
    const s = sql();
    expect(s).toMatch(
      /create policy "posts: a caption while live, by a member" on public\.posts\s+as restrictive for update\s+using \(removed_at is null and \(select public\.is_active_member\(\(select auth\.uid\(\)\)\)\)\)\s+with check \(removed_at is null and \(select public\.is_active_member\(\(select auth\.uid\(\)\)\)\)\);/,
    );
    expect(s).toMatch(/as restrictive for update\s+using \(status <> 'suspended'\)\s+with check \(\s+status <> 'suspended'/);
    expect(s).toMatch(/using \(sender_id <> \(select auth\.uid\(\)\)\)\s+with check \(sender_id <> \(select auth\.uid\(\)\)\);/);
    // The app marks only the other member's messages read.
    expect(read("src/api/messages.ts")).toMatch(/\.update\(\{ read_at: new Date\(\)\.toISOString\(\) \}\)\s+\.eq\("conversation_id", conversationId\)\s+\.neq\("sender_id", userId\)/);
  });
});

describe("0039: the old invitation functions", () => {
  const fn = (name: string) => {
    const s = sql();
    const at = s.indexOf(`create or replace function public.${name}(`);
    expect(at, name).toBeGreaterThanOrEqual(0);
    return s.slice(at, s.indexOf("$$;", at));
  };

  it("join_with_invite and redeem_invite refuse a suspended account, and take up nothing for a member, as redeem_invite_link does", () => {
    for (const name of ["join_with_invite", "redeem_invite"]) {
      expect(fn(name)).toMatch(
        /select status into v_status from public\.profiles where id = v_user;\s+if v_status = 'approved' then\s+return false;\s+end if;\s+if v_status = 'suspended' then\s+raise exception 'This account is suspended';\s+end if;/,
      );
      expect(fn(name)).toMatch(/security definer\s+set search_path = public/);
    }
    // The words redeem_invite_link uses, which the app shows.
    expect(read("supabase/migrations/0016_invitations_and_places.sql")).toContain("raise exception 'This account is suspended';");
  });

  it("one allowance: create_invite holds the member's row and counts members in and codes out; redeem_invite counts as the link does", () => {
    const create = fn("create_invite");
    expect(create).toMatch(/select invite_quota into v_quota from public\.profiles where id = v_user for update;/);
    expect(create).toMatch(/\(select count\(\*\) from public\.profiles c where c\.invited_by = v_user\)\s+\+ \(select count\(\*\) from public\.invites i\s+where i\.created_by = v_user and i\.used_by is null and i\.used_at is null\)/);
    const redeem = fn("redeem_invite");
    expect(redeem).toMatch(/where code = upper\(trim\(p_code\)\) and used_by is null and used_at is null\s+for update;/);
    expect(redeem).toMatch(/from public\.profiles p where p\.id = v_invite\.created_by and p\.status = 'approved'\s+for update;/);
    expect(redeem).toMatch(/select count\(\*\)::integer into v_used from public\.profiles c where c\.invited_by = v_invite\.created_by;\s+if v_used >= v_quota then\s+return false;/);
    // The app calls neither: it takes up an invitation with redeem_invite_link.
    for (const file of ["src/api/membership.ts", "app/(gate)/invite.tsx"]) {
      expect(read(file)).not.toMatch(/rpc\("(create_invite|redeem_invite|join_with_invite)"/);
    }
  });
});

describe("0039, as a file", () => {
  it("waits five seconds at most for a lock, opens no transaction, and says how to roll it back", () => {
    const s = sql();
    expect(s.split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    expect(s).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(read(FILE)).toMatch(/^-- Rollback: supabase\/tests\/0039_rollback\.sql/m);
    // It changes no member's data: nothing outside the functions it replaces writes a row.
    const outside = s.replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(outside).not.toMatch(/\b(insert into|delete from|truncate)\b/i);
    expect(outside).not.toMatch(/\bupdate public\.\w+\s+set\b/i);
  });

  it("has a way back that is a tested file, and the harness runs its test", () => {
    const back = code(read("supabase/tests/0039_rollback.sql"));
    expect(back.split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    for (const [, name] of sql().matchAll(/create policy "([^"]+)"/g)) {
      expect(back, name).toContain(`drop policy if exists "${name}"`);
    }
    for (const name of ["join_with_invite(p_slug text)", "redeem_invite(p_code text)", "create_invite()"]) {
      expect(back).toContain(`CREATE OR REPLACE FUNCTION public.${name}`);
    }
    const test = read("supabase/tests/18_writes_0039.sql");
    expect(test.indexOf("\\ir 0039_rollback.sql")).toBeGreaterThan(0);
    expect(test.lastIndexOf("\\ir ../migrations/0039_writes_only_what_the_app_writes.sql")).toBeGreaterThan(test.indexOf("\\ir 0039_rollback.sql"));
    expect(test.trim().endsWith("rollback;")).toBe(true);
    expect(read("supabase/tests/run.mjs")).toMatch(/"17_follows_0038\.sql",\s+"18_writes_0039\.sql",/);
  });

  it("is checked by the owner's verify script, rows 49 to 60", () => {
    const verify = code(read("supabase/production/12_policies_read_once_verify.sql"));
    for (let n = 49; n <= 60; n++) expect(verify).toMatch(new RegExp(`select ${n}, '0039:`));
    expect(verify).toMatch(/select 4, 'policies on public', count\(\*\)::text, '85'/);
    expect(verify).toMatch(/select 6, 'restrictive policies \(blocking, 0028, 0033, 0038, 0039, 0040\)', count\(\*\)::text, '27'/);
  });
});
