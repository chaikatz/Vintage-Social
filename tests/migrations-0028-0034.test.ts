import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { routeForNotification } from "@/utils/pushRoute";

/**
 * 0028-0034, as files. What each does to the database is proven on
 * PostgreSQL by npm run test:rls (13_photograph_rows_0028.sql,
 * 14_moderation_0029_0033.sql, 15_seed_thumbnails_0034.sql, and the
 * owner's verify script 12, which the harness runs too); these hold the
 * files to their shape where vitest runs without a database: each says
 * how to roll it back, none opens a transaction of its own or grants
 * anything to signed-out visitors, and each does what its name says and
 * nothing more.
 */

const root = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(root, "supabase", "migrations");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");
// This file's seven; 0035 on have their own (migrations-0035-0037.test.ts).
const later = readdirSync(migrationsDir)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 28 && Number(f.slice(0, 4)) <= 34)
  .sort();
const migration = (n: string) => {
  const f = later.find((x) => x.startsWith(n));
  if (!f) throw new Error(`no migration ${n}`);
  return read(`supabase/migrations/${f}`);
};

describe("0028-0034, each", () => {
  it("are the seven, in order", () => {
    expect(later).toEqual([
      "0028_comments_likes_tags_follow_the_photograph.sql",
      "0029_decisions_reach_the_profile.sql",
      "0030_removed_once.sql",
      "0031_reports_outlive_their_reporter.sql",
      "0032_reports_reach_the_admins.sql",
      "0033_what_a_member_reports_leaves_their_view.sql",
      "0034_seed_thumbnails_at_a_standard_width.sql",
    ]);
  });

  for (const f of later) {
    it(`${f} says how to roll it back, opens no transaction, grants nothing to visitors`, () => {
      const sql = read(`supabase/migrations/${f}`);
      expect(sql).toMatch(/^-- Rollback/m);
      expect(code(sql)).not.toMatch(/^\s*(begin|commit)\s*;/im);
      expect(code(sql)).not.toMatch(/grant [^;]* to [^;]*\banon\b/i);
      expect(code(sql)).not.toMatch(/\bservice_role\b/);
    });
  }

  it("every policy they make is one 08_policy_rewrite.sql knows was made after 0023", () => {
    const made = later.flatMap((f) =>
      [...code(read(`supabase/migrations/${f}`)).matchAll(/create policy\s+"([^"]+)"\s+on\s+public\.(\w+)/g)].map((m) => `${m[2]}|${m[1]}`),
    );
    const rewrite = read("supabase/tests/08_policy_rewrite.sql");
    const listed = [...rewrite.matchAll(/\('(\w+)', '([^']+)'\)/g)].map((m) => `${m[1]}|${m[2]}`);
    expect(made.length).toBe(4);
    for (const p of made) expect(listed, p).toContain(p);
  });

  it("the harness runs each one's tests", () => {
    const runner = read("supabase/tests/run.mjs");
    expect(runner).toMatch(/"13_photograph_rows_0028\.sql"/);
    expect(runner).toMatch(/"14_moderation_0029_0033\.sql"/);
    expect(runner).toMatch(/15_seed_thumbnails_0034\.sql/);
    expect(runner).toMatch(/rows\.length !== 60/);
  });
});

describe("0029: a waitlist or a rejection reaches the profile", () => {
  const sql = code(migration("0029"));
  const fn = (s: string) => s.slice(s.indexOf("create or replace function public.decide_application"), s.indexOf("$$;", s.indexOf("create or replace function public.decide_application")));

  it("writes it, only to a profile still outside the club", () => {
    expect(sql).toMatch(
      /if p_decision in \('waitlisted', 'rejected'\) then\s+update public\.profiles\s+set status = p_decision\s+where id = v_app\.user_id\s+and status in \('applied', 'waitlisted', 'rejected'\);\s+end if;/,
    );
  });

  it("an approval refuses a suspended account, before anything is written or numbered", () => {
    const body = fn(sql);
    const refusal = body.search(
      /if p_decision = 'approved' then\s+select status into v_status from public\.profiles where id = v_app\.user_id for update;\s+if v_status = 'suspended' then\s+raise exception 'This account is suspended';\s+end if;\s+end if;/,
    );
    expect(refusal).toBeGreaterThan(-1);
    expect(refusal).toBeLessThan(body.indexOf("update public.applications"));
    expect(refusal).toBeLessThan(body.indexOf("public.assign_member_no"));
  });

  it("is otherwise 0011's function, approval and all", () => {
    const before = fn(code(read("supabase/migrations/0011_house_accounts.sql")));
    const now = fn(sql)
      .replace(/\s+if p_decision in \('waitlisted', 'rejected'\) then[\s\S]*?end if;\n/, "\n")
      .replace(/\s+if p_decision = 'approved' then\s+select status into v_status[\s\S]*?end if;\s+end if;\n/, "\n")
      .replace(/\s+v_status text;/, "");
    expect(now.replace(/\s+/g, " ")).toBe(before.replace(/\s+/g, " "));
  });

  it("repairs only profiles at applied whose latest application was waitlisted or rejected", () => {
    expect(sql).toMatch(/select distinct on \(user_id\) user_id, status\s+from public\.applications\s+order by user_id, created_at desc, id desc/);
    expect(sql).toMatch(/and p\.status = 'applied'\s+and a\.status in \('waitlisted', 'rejected'\);/);
  });
});

describe("0030: removed once, told once", () => {
  const sql = code(migration("0030"));
  it("both functions stop when their update changed nothing", () => {
    expect(sql).toMatch(/where id = p_post_id and removed_at is null;\s+if not found then\s+return;\s+end if;\s+insert into public\.moderation_actions/);
    expect(sql).toMatch(/where id = p_comment_id and removed_at is null;\s+if not found then\s+return;\s+end if;\s+insert into public\.moderation_actions/);
  });
  it("and still refuse anyone not an admin, and say what was never there", () => {
    expect(sql.match(/if not public\.is_admin\(v_admin\) then\s+raise exception 'Admins only';/g)?.length).toBe(2);
    expect(sql).toMatch(/raise exception 'Post not found';/);
    expect(sql).toMatch(/raise exception 'Comment not found';/);
  });
});

describe("0031: a report outlives its reporter", () => {
  it("the reporter may be null, set so when they go", () => {
    const sql = code(migration("0031"));
    expect(sql).toMatch(/alter table public\.reports alter column reporter_id drop not null;/);
    expect(sql).toMatch(/foreign key \(reporter_id\) references public\.profiles \(id\) on delete set null;/);
  });
  it("the app's report row says so", () => {
    expect(read("src/types/db.ts")).toMatch(/export type ReportRow = \{[^}]*\n\s+reporter_id: string \| null;/);
  });
});

describe("0032: a report reaches the admins", () => {
  const sql = code(migration("0032"));
  it("a trigger after each new report asks the push function, through push_event", () => {
    expect(sql).toMatch(/perform public\.push_event\('report', new\.id\);/);
    expect(sql).toMatch(/create trigger reports_push_trigger\s+after insert on public\.reports\s+for each row execute function public\.on_report_push\(\);/);
    expect(sql).toMatch(/revoke execute on function public\.on_report_push\(\) from public, anon, authenticated;/);
    expect(sql).toMatch(/alter table public\.reports add column if not exists pushed_at timestamptz;/);
  });

  const source = read("supabase/functions/push/index.ts").replace(/\/\/.*$/gm, "");
  const door = source.slice(source.indexOf("async function handleReport"), source.indexOf("async function handleMemories"));

  it("the push function has the door: claimed once, open reports only", () => {
    expect(source).toMatch(/case "report":\s+return json\(await handleReport\(String\(payload\.id \?\? ""\)\)\);/);
    expect(door).toMatch(/\.from\("reports"\)\s+\.update\(\{ pushed_at: new Date\(\)\.toISOString\(\) \}\)\s+\.eq\("id", id\)\s+\.is\("pushed_at", null\)\s+\.eq\("status", "open"\)/);
  });

  it("tells the approved admins, and nothing of what was reported or by whom", () => {
    expect(door).toMatch(/\.eq\("role", "admin"\)\s+\.eq\("status", "approved"\)/);
    expect(door).toMatch(/body: "A report is waiting\.", data: \{ kind: "report", route: "\/admin\/reports" \}/);
    // It reads the report's id and the admins' ids, nothing else.
    expect([...door.matchAll(/\.select\("([^"]*)"\)/g)].map((m) => m[1])).toEqual(["id", "id"]);
    expect(door).not.toMatch(/details|reporter|username|nameOf|\.reason/);
  });

  it("a tap on it opens the Reports screen", () => {
    expect(routeForNotification({ kind: "report", route: "/admin/reports" })).toBe("/admin/reports");
  });
});

describe("0033: what a member reports leaves their view", () => {
  const sql = code(migration("0033"));
  it("one restrictive read policy on posts, asked of the member's own reports once a statement", () => {
    expect(sql).toMatch(/create policy "posts: not what I reported" on public\.posts\s+as restrictive for select using \(/);
    expect(sql).toMatch(/\(select public\.is_admin\(\(select auth\.uid\(\)\)\)\)\s+or author_id = \(select auth\.uid\(\)\)\s+or id <> all \(coalesce\(\(/);
    expect(sql).toMatch(/select array_agg\(r\.post_id\) from public\.reports r\s+where r\.reporter_id = \(select auth\.uid\(\)\) and r\.post_id is not null/);
    // Not correlated with the row: the list is read once, not per photograph.
    expect(sql).not.toMatch(/r\.post_id = (posts\.)?id/);
  });
});

describe("0034: the house thumbnails at a standard width", () => {
  const sql = code(migration("0034"));
  const updates = sql.split(";").filter((s) => /update public\.posts/.test(s));
  it("changes only house photographs whose thumbnail is the full Wikimedia picture, to 960 pixels", () => {
    const wikimedia = updates.filter((u) => /wikimedia/.test(u));
    expect(wikimedia.length).toBe(2);
    for (const u of wikimedia) {
      expect(u).toMatch(/and a\.is_house/);
      expect(u).toMatch(/and p\.thumb_path = p\.media_path/);
      expect(u).toMatch(/set thumb_path = regexp_replace\(/);
      expect(u).not.toMatch(/set[^=]*media_path\s*=/);
      expect(u).toMatch(/960px-/);
      // 500 gave a landscape a short side under the app's 540 (src/uploads/thumbSize.ts).
      expect(u).not.toMatch(/500px-/);
    }
    // A width Wikimedia serves (https://w.wiki/GHai): 480 is refused.
    expect(sql).not.toMatch(/480px-/);
  });

  it("asks picsum for the house thumbnails at the size the app cuts a member's", async () => {
    const { THUMB_SHORT, THUMB_LONG_MAX } = await import("@/uploads/thumbSize");
    expect(updates.length).toBe(3);
    const picsum = updates.find((u) => /picsum/.test(u))!;
    // House accounts' only, the same picture as the photograph, its size
    // read from the photograph's own address, never larger than it.
    expect(picsum).toContain("where a.is_house");
    expect(picsum).toContain("and split_part(p.thumb_path, '/', 5) = m[1]");
    expect(picsum).toContain("regexp_match(p.media_path, '^https://picsum\\.photos/id/([0-9]+)/([0-9]+)/([0-9]+)$') m");
    expect(picsum).toContain(`where least(w, h) >= ${THUMB_SHORT}`);
    expect(picsum).toContain(`least(${THUMB_LONG_MAX}, ceil(${THUMB_SHORT}.0 * greatest(w, h) / least(w, h)))::int as long_side`);
    expect(picsum).toContain(`case when long_side < ${THUMB_LONG_MAX} then ${THUMB_SHORT} else round(${THUMB_LONG_MAX}.0 * h / w)::int end`);
    expect(picsum).not.toMatch(/set[^=]*media_path\s*=/);
    // Run again, nothing changes: only a thumbnail not already at its size.
    expect(picsum).toContain("and p.thumb_path is distinct from asked.thumb");
  });
});
