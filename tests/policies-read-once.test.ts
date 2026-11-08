import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Migration 0023 rewrites every policy that reads the caller so it reads
 * them once a statement. The proof that nothing anyone may do changed is
 * on PostgreSQL (supabase/tests/08_policy_rewrite.sql, run by
 * npm run test:rls); these guard the file itself where vitest runs
 * without a database: no policy it writes reads the caller a row at a
 * time, and no policy that reads the caller was left out of it.
 */

const root = join(import.meta.dirname, "..");
const migrations = join(root, "supabase", "migrations");
const REWRITE = "0023_policies_read_once.sql";

/** Every `create policy` statement in a file: its name, table and text. */
function policies(sql: string): { name: string; table: string; text: string }[] {
  const out: { name: string; table: string; text: string }[] = [];
  const re = /create policy\s+"([^"]+)"\s+on\s+([\w.]+)([\s\S]*?);/gi;
  for (const m of sql.matchAll(re)) out.push({ name: m[1], table: m[2], text: m[0] });
  return out;
}

/** A policy's text with comments taken out. */
const code = (text: string) => text.replace(/--[^\n]*/g, "");

const rewrite = readFileSync(join(migrations, REWRITE), "utf8");
const rewritten = policies(rewrite);

describe("0023: every policy reads the caller once", () => {
  it("rewrites 73 policies: 65 in public, 8 on storage.objects", () => {
    expect(rewritten.length).toBe(73);
    expect(rewritten.filter((p) => p.table === "storage.objects").length).toBe(8);
    expect(new Set(rewritten.map((p) => `${p.table} ${p.name}`)).size).toBe(73);
  });

  it("never calls auth.uid() outside a scalar subquery in a policy", () => {
    for (const p of rewritten) {
      const bare = code(p.text).replace(/\(select auth\.uid\(\)\)/g, "");
      expect(bare, p.name).not.toMatch(/auth\.uid\(\)/);
    }
  });

  it("asks is_admin and is_active_member once, through a subquery", () => {
    for (const p of rewritten) {
      const bare = code(p.text).replace(/\(select public\.(is_admin|is_active_member)\(\(select auth\.uid\(\)\)\)\)/g, "");
      expect(bare, p.name).not.toMatch(/is_admin\(|is_active_member\(/);
    }
  });

  it("asks about blocks once, never a row at a time", () => {
    for (const p of rewritten) {
      expect(code(p.text), p.name).not.toMatch(/blocked_between\(|blocked_by\(/);
      const text = code(p.text);
      for (let at = text.indexOf("= any ("); at >= 0; at = text.indexOf("= any (", at + 1)) {
        expect(text.slice(at + 7), p.name).toMatch(/^\(select private\.my_block(_partners|ers)\(\)\)::uuid\[\]\)/);
      }
    }
  });

  it("leaves out no policy that read the caller before it", () => {
    // The last definition of each policy in 0003-0022 is what production runs.
    const latest = new Map<string, string>();
    for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql") && f < REWRITE).sort()) {
      for (const p of policies(readFileSync(join(migrations, file), "utf8"))) {
        latest.set(`${p.table.replace(/^(?!public\.|storage\.)/, "public.")} ${p.name}`, p.text);
      }
    }
    const callerReading = [...latest].filter(([, text]) => /auth\.uid\(\)/.test(code(text))).map(([key]) => key);
    const covered = new Set(rewritten.map((p) => `${p.table} ${p.name}`));
    expect(callerReading.length).toBe(73);
    expect(callerReading.filter((key) => !covered.has(key))).toEqual([]);
  });

  it("keeps each policy's command, roles and kind", () => {
    const head = (text: string) => {
      const t = code(text).replace(/\s+/g, " ").toLowerCase();
      return {
        restrictive: / as restrictive /.test(t),
        cmd: (t.match(/ for (select|insert|update|delete|all) /) ?? [])[1],
        role: (t.match(/ to (authenticated|anon|public) /) ?? [])[1] ?? "public",
      };
    };
    const latest = new Map<string, string>();
    for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql") && f < REWRITE).sort()) {
      for (const p of policies(readFileSync(join(migrations, file), "utf8"))) {
        latest.set(`${p.table.replace(/^(?!public\.|storage\.)/, "public.")} ${p.name}`, p.text);
      }
    }
    for (const p of rewritten) {
      const before = latest.get(`${p.table} ${p.name}`);
      expect(before, p.name).toBeDefined();
      expect(head(p.text), p.name).toEqual(head(before!));
    }
  });

  it("drops each policy before making it again, so it can run twice", () => {
    for (const p of rewritten) {
      expect(rewrite).toContain(`drop policy if exists "${p.name}" on ${p.table};`);
    }
    expect(code(rewrite)).not.toMatch(/\bdrop index\b|\bdrop table\b|\bdrop column\b|\bdelete from\b|\btruncate\b/i);
    expect(code(rewrite).match(/create index (?!if not exists)/gi) ?? []).toEqual([]);
    expect((code(rewrite).match(/create index if not exists/gi) ?? []).length).toBe(30);
  });

  it("gives the new functions to members only", () => {
    for (const fn of ["my_block_partners()", "my_blockers()", "own_profile_unchanged(text, text, integer, integer, uuid, boolean)"]) {
      const name = fn.replace(/\(.*/, "");
      expect(rewrite).toMatch(new RegExp(`revoke execute on function[^;]*private\\.${name}\\([^;]*from public, anon, authenticated;`));
      expect(rewrite).toMatch(new RegExp(`grant execute on function[^;]*private\\.${name}\\([^;]*to authenticated;`));
    }
  });

  // PostgREST publishes every function in public that a role may execute
  // (/rest/v1/rpc/<name>). A SECURITY DEFINER function there answers past
  // row-level security: my_blockers() in public would hand any member the
  // ids of everyone who has blocked them. 0023's definer helpers belong in
  // a schema the API does not publish.
  it("makes no SECURITY DEFINER function in public, where the API would publish it", () => {
    const fns = [...code(rewrite).matchAll(/create or replace function\s+([\w.]+)\s*\(([\s\S]*?)\$\$/gi)];
    expect(fns.length).toBe(3);
    for (const [, name, head] of fns) {
      if (/security definer/i.test(head)) expect(name, name).toMatch(/^private\./);
    }
    expect(code(rewrite)).toMatch(/create schema if not exists private;/);
    expect(code(rewrite)).toMatch(/revoke all on schema private from public, anon;/);
    expect(code(rewrite)).not.toMatch(/grant [^;]* on schema private to [^;]*\banon\b/);
    // And nothing anywhere calls them in public any more.
    expect(code(rewrite)).not.toMatch(/public\.(my_block_partners|my_blockers|own_profile_unchanged)\b/);
  });

  it("will not wait behind a long transaction while holding every table", () => {
    // DROP/CREATE POLICY take ACCESS EXCLUSIVE until commit; the first
    // statement bounds how long any one lock may be waited for.
    const first = code(rewrite).split(";").map((s) => s.trim()).find(Boolean);
    expect(first).toMatch(/^set local lock_timeout = '\d+s'$/);
  });

  it("is proven by the policy harness, which runs the matrix, the plans and the rollback", () => {
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/snapshot_before_0023\.sql/);
    expect(runner).toMatch(/"08_policy_rewrite\.sql",\s*"09_scale_plans\.sql",\s*"10_rollback_0023\.sql"/);
    // And the read-only check the owner runs on production after applying it.
    expect(runner).toMatch(/12_policies_read_once_verify\.sql/);
    const verify = readFileSync(join(root, "supabase", "production", "12_policies_read_once_verify.sql"), "utf8");
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
  });

  // The SQL editor shows only the last statement's result, and a run that
  // ends in an error shows only the error: the owner must see the table.
  it("ends the production check with its table of checks, and never raises", () => {
    const verify = code(readFileSync(join(root, "supabase", "production", "12_policies_read_once_verify.sql"), "utf8"));
    expect(verify).not.toMatch(/\braise\b/i);
    const statements = verify.split(/;\s*\n/).map((st) => st.trim()).filter(Boolean);
    const last = statements[statements.length - 1];
    expect(last).toMatch(/^with checks as \(/);
    expect(last).toMatch(/select n, what, found, expected, coalesce\(found = expected, false\) as ok\s+from checks\s+order by n;?$/);
    // The plan's answers reach the table through a setting, not a message.
    expect(verify).toMatch(/perform set_config\('vintage\.verify_plan', v_answer, false\);/);
    expect((last.match(/current_setting\('vintage\.verify_plan', true\)/g) ?? []).length).toBe(4);
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/r\.status !== 0 \|\| rows\.length !== 55 \|\| failing\.length > 0 \|\| errors\.length > 0/);
  });
});

describe("0025: the home feed in one piece", () => {
  const sql = code(readFileSync(join(migrations, "0025_feed_page.sql"), "utf8"));

  it("runs as the member asking, so every policy on posts and follows applies", () => {
    expect(sql).toMatch(/security invoker/);
    expect(sql).not.toMatch(/security definer/);
  });

  it("is the member's own posts and their accepted follows', live, newest first, a bounded page", () => {
    expect(sql).toMatch(/v_me\s+uuid := auth\.uid\(\);/);
    expect(sql).toMatch(/if v_me is null then\s+return;/);
    expect(sql).toMatch(/coalesce\(array_agg\(f\.followee_id\), '\{\}'::uuid\[\]\) \|\| v_me/);
    expect(sql).toMatch(/f\.follower_id = v_me\s+and f\.status = 'accepted'/);
    expect(sql).toMatch(/p\.removed_at is null/);
    expect(sql).toMatch(/order by p\.created_at desc, p\.id desc/);
    expect(sql).toMatch(/least\(greatest\(coalesce\(p_limit, 12\), 1\), 100\)/);
  });

  // By offset, a post deleted between two pages made the next one skip a
  // post, and one arriving made it repeat one; deep pages read every post
  // above them. A page starts after the last post the reader holds.
  it("pages after the last post held (time, then id), never by an offset", () => {
    expect(sql).toMatch(/p_before_at timestamptz default null,\s+p_before_id uuid default null/);
    expect(sql).not.toMatch(/p_offset|offset \$/);
    expect(sql).toMatch(
      /if p_before_at is not null then\s+v_sql := v_sql \|\| '\s+and p\.created_at <= \$3\s+and \(p\.created_at < \$3 or p\.id < \$4\)';/,
    );
    expect(sql).toMatch(/drop function if exists public\.feed_page\(integer, integer\);/);
  });

  // Asked as one statement with the follows as a subquery, the planner
  // cannot see how many authors there are and walks every live post in
  // the club for a sparse feed (6,611 posts read for a member following
  // nobody, at 1,000 members). The posts query is planned with the list.
  it("plans the posts query with the author list in hand, not as a subquery", () => {
    expect(sql).toMatch(/language plpgsql/);
    expect(sql).toMatch(/v_sql := 'select p\.\* from public\.posts p[\s\S]*?p\.author_id = any \(\$1\)'/);
    expect(sql).toMatch(/order by p\.created_at desc, p\.id desc\s+limit \$2';\s+return query execute v_sql\s+using v_authors,/);
    expect(sql).not.toMatch(/author_id in \(\s*select/);
    expect(readFileSync(join(root, "supabase", "tests", "09_scale_plans.sql"), "utf8")).toMatch(
      /feed_page for a member who follows nobody reads their own photographs, not the club''s/,
    );
  });

  it("is for members only, and the harness compares it with the old read page by page", () => {
    expect(sql).toMatch(/revoke execute on function public\.feed_page\(integer, timestamptz, uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.feed_page\(integer, timestamptz, uuid\) to authenticated;/);
    expect(readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8")).toMatch(/"12_feed_page\.sql"/);
  });
});

describe("0024: who has blocked whom answers only for the caller", () => {
  const sql = code(readFileSync(join(migrations, "0024_block_checks_answer_for_the_caller.sql"), "utf8"));

  it("blocked_between answers only when the caller is one of the two", () => {
    const body = sql.slice(sql.indexOf("function public.blocked_between"), sql.indexOf("function public.blocked_by"));
    expect(body).toMatch(/and auth\.uid\(\) in \(p_a, p_b\)/);
    expect(body).toMatch(/security definer set search_path = public/);
  });

  it("blocked_by answers only when the caller is the one who might be blocked", () => {
    const body = sql.slice(sql.indexOf("function public.blocked_by"));
    expect(body).toMatch(/and p_me = auth\.uid\(\)/);
    expect(body).toMatch(/security definer set search_path = public/);
  });

  it("changes no grant, and the harness asks them about other people", () => {
    expect(sql).not.toMatch(/\b(grant|revoke)\b/i);
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/"11_block_privacy\.sql"/);
  });
});

describe("0026 and 0027: the push function's own reads and writes", () => {
  const followers = code(readFileSync(join(migrations, "0026_followers_in_order.sql"), "utf8"));
  const tickets = code(readFileSync(join(migrations, "0027_push_tickets.sql"), "utf8"));

  it("0026 keeps an author's accepted followers in follower order, for keyset pages", () => {
    expect(followers).toMatch(
      /create index if not exists follows_followers_by_id_idx on public\.follows \(followee_id, follower_id\)\s+where status = 'accepted';/,
    );
    expect(followers).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b/i);
  });

  it("0027 keeps Expo's tickets where only the service role can reach them", () => {
    expect(tickets).toMatch(/create table if not exists public\.push_tickets/);
    expect(tickets).toMatch(/references public\.push_tokens \(token\) on delete cascade/);
    expect(tickets).toMatch(/alter table public\.push_tickets enable row level security;/);
    expect(tickets).toMatch(/revoke all on public\.push_tickets from public, anon, authenticated;/);
    expect(tickets).not.toMatch(/create policy/i);
    // The foreign key's lookup has its index (every foreign key does, 0023).
    expect(tickets).toMatch(/create index if not exists push_tickets_token_idx on public\.push_tickets \(token\);/);
  });

  it("both wait at most five seconds for a lock, like 0023", () => {
    for (const sql of [followers, tickets]) {
      expect(sql.split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    }
  });
});

describe("0028: comments, likes and tags only with their photograph", () => {
  const file = "0028_comments_likes_tags_follow_the_photograph.sql";
  const proposal = code(readFileSync(join(migrations, file), "utf8"));

  it("is a migration now, and the harness proves it against the database without it", () => {
    expect(readdirSync(join(root, "supabase", "tests")).some((f) => /^proposed_/.test(f))).toBe(false);
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/"13_photograph_rows_0028\.sql"/);
    const test = readFileSync(join(root, "supabase", "tests", "13_photograph_rows_0028.sql"), "utf8");
    // Taken away, read, put back by the migration file itself, read again.
    expect(test).toMatch(/drop policy "comments: only with their photograph" on public\.comments;/);
    expect(test).toMatch(new RegExp(`\\\\ir \\.\\./migrations/${file.replace(/\./g, "\\.")}`));
    expect(test.trim().endsWith("rollback;")).toBe(true);
  });

  it("only narrows reading: three restrictive select policies, each keeping the member's own rows", () => {
    const made = policies(proposal);
    expect(made.map((p) => `${p.table} ${p.name}`)).toEqual([
      "public.comments comments: only with their photograph",
      "public.likes likes: only with their photograph",
      "public.post_tags post_tags: only with their photograph",
    ]);
    for (const p of made) {
      expect(p.text, p.name).toMatch(/as restrictive for select using \(/);
      expect(p.text, p.name).toMatch(/or exists \(select 1 from public\.posts p where p\.id = post_id\)/);
    }
    expect(made[0].text).toMatch(/author_id = \(select auth\.uid\(\)\)/);
    expect(made[1].text).toMatch(/user_id = \(select auth\.uid\(\)\)/);
    expect(made[2].text).toMatch(/user_id = \(select auth\.uid\(\)\)\s+or tagged_by = \(select auth\.uid\(\)\)/);
    expect(proposal).not.toMatch(/\b(grant|revoke|alter table|delete from|update public)\b/i);
  });
});
