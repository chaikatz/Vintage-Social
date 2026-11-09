import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 0035-0037, as files. What each does to the database is proven on
 * PostgreSQL by npm run test:rls (16_launch_data_0035_0037.sql, the plan
 * in 09_scale_plans.sql, and the owner's verify script 12, which the
 * harness runs too); these hold the files to their shape where vitest
 * runs without a database.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const code = (sql: string) => sql.replace(/--[^\n]*/g, "");
const files = readdirSync(path.join(root, "supabase", "migrations"))
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 35 && Number(f.slice(0, 4)) <= 37)
  .sort();
const migration = (n: string) => {
  const f = files.find((x) => x.startsWith(n));
  if (!f) throw new Error(`no migration ${n}`);
  return read(`supabase/migrations/${f}`);
};

describe("0035-0037, each", () => {
  it("are the three, in order", () => {
    expect(files).toEqual([
      "0035_own_files_whatever_the_membership.sql",
      "0036_push_token_follows_the_member.sql",
      "0037_unread_counts_in_the_database.sql",
    ]);
  });

  for (const f of files) {
    it(`${f} says how to roll it back, opens no transaction, grants nothing to visitors`, () => {
      const sql = read(`supabase/migrations/${f}`);
      expect(sql).toMatch(/^-- Rollback/m);
      expect(code(sql)).not.toMatch(/^\s*(begin|commit)\s*;/im);
      expect(code(sql)).not.toMatch(/grant [^;]* to [^;]*\banon\b/i);
      expect(code(sql)).not.toMatch(/\bservice_role\b/);
    });
  }

  it("the harness runs their tests, the plan, and the owner's check with their rows", () => {
    const runner = read("supabase/tests/run.mjs");
    expect(runner).toMatch(/"14_moderation_0029_0033\.sql",\s*"16_launch_data_0035_0037\.sql",/);
    expect(runner).toMatch(/rows\.length !== 67/);
    const plans = read("supabase/tests/09_scale_plans.sql");
    expect(plans).toMatch(/\('unread messages', tests\.plan_as\(:'me',\s*\(select p\.prosrc from pg_proc p/);
    expect(plans).toMatch(/\('unread messages', 'messages_unread_idx'\),/);
    const verify = code(read("supabase/production/12_policies_read_once_verify.sql"));
    for (const n of [35, 36, 37, 38, 39]) expect(verify).toMatch(new RegExp(`select ${n}, '00(34|35|36|37):`));
  });
});

describe("0035: a member's own files, whatever their membership", () => {
  const sql = code(migration("0035"));

  it("lets a member read their own folder's rows in media and thumbnails, and asks nothing about membership", () => {
    expect(sql).toMatch(
      /create policy "media: read own folder" on storage\.objects\s+for select to authenticated\s+using \(\s*bucket_id in \('media', 'thumbnails'\)\s+and \(storage\.foldername\(name\)\)\[1\] = \(select auth\.uid\(\)\)::text\s*\);/,
    );
    expect(sql).not.toMatch(/is_active_member/);
  });

  it("replaces that one policy and no other, and will not wait behind a long transaction", () => {
    expect(sql.match(/create policy/g)).toHaveLength(1);
    expect(sql.match(/drop policy/g)).toHaveLength(1);
    expect(sql).toMatch(/drop policy if exists "media: read own folder" on storage\.objects;/);
    expect(sql.split(";").map((s) => s.trim()).find(Boolean)).toMatch(/^set local lock_timeout = '\d+s'$/);
  });

  it("is put back after 0023 is applied again over its rollback, as on the project", () => {
    const rollback = read("supabase/tests/10_rollback_0023.sql");
    const again = [...rollback.matchAll(/\\ir \.\.\/migrations\/0023_policies_read_once\.sql\n\\ir \.\.\/migrations\/0035_own_files_whatever_the_membership\.sql/g)];
    expect(again).toHaveLength(2);
    expect(rollback.match(/\\ir \.\.\/migrations\/0023_policies_read_once\.sql/g)).toHaveLength(2);
  });
});

describe("0036: a phone's push token under whoever signed in on it last", () => {
  const sql = code(migration("0036"));
  const fn = sql.slice(sql.indexOf("create or replace function public.claim_push_token"), sql.indexOf("$$;"));

  it("runs as its owner, with an empty search path, every name qualified", () => {
    expect(fn).toMatch(/\(p_token text, p_platform text, p_device text\)\s+returns void\s+language plpgsql\s+volatile\s+security definer\s+set search_path = ''/);
    expect(fn).not.toMatch(/\b(from|into)\s+(?!public\.)\w+/);
    expect(fn).toMatch(/insert into public\.push_tokens/);
  });

  it("files the token under the caller, whoever held it, and only the caller", () => {
    expect(fn).toMatch(/v_me uuid := auth\.uid\(\);/);
    expect(fn).toMatch(/if v_me is null then\s+raise exception 'Not signed in' using errcode = '42501';/);
    expect(fn).toMatch(/values \(p_token, v_me, p_platform, left\(p_device, 200\), now\(\), null\)/);
    expect(fn).toMatch(/on conflict \(token\) do update\s+set user_id\s+= excluded\.user_id,/);
    // It reads nothing back and answers nothing.
    expect(fn).not.toMatch(/\breturning\b|\bselect\b/);
  });

  it("refuses what the table would not take", () => {
    expect(fn).toMatch(/length\(p_token\) = 0 or length\(p_token\) > 512/);
    expect(fn).toMatch(/p_platform not in \('ios', 'android', 'web'\)/);
  });

  it("is for members only", () => {
    expect(sql).toMatch(/revoke execute on function public\.claim_push_token\(text, text, text\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.claim_push_token\(text, text, text\) to authenticated;/);
  });

  it("is the one SECURITY DEFINER function a later migration publishes, and the policy harness names it", () => {
    const rewrite = read("supabase/tests/08_policy_rewrite.sql");
    expect(rewrite).toMatch(/and p\.oid::regprocedure::text not in \('claim_push_token\(text,text,text\)'\)/);
    for (const f of files.filter((x) => !x.startsWith("0036"))) {
      expect(code(read(`supabase/migrations/${f}`)), f).not.toMatch(/security definer/);
    }
  });
});

describe("0037: unread messages counted in the database", () => {
  const sql = code(migration("0037"));

  it("runs as the reader, read only, with an empty search path", () => {
    expect(sql).toMatch(/returns table \(conversation_id uuid, unread bigint\)\s+language sql\s+stable\s+security invoker\s+set search_path = ''/);
    expect(sql).not.toMatch(/security definer/);
  });

  it("counts, a thread at a time, the unread messages the other member sent in the reader's own threads", () => {
    expect(sql).toMatch(/from public\.conversations c\s+join public\.messages m on m\.conversation_id = c\.id/);
    expect(sql).toMatch(/where \(c\.user_a = \(select auth\.uid\(\)\) or c\.user_b = \(select auth\.uid\(\)\)\)/);
    expect(sql).toMatch(/and m\.read_at is null\s+and m\.sender_id <> \(select auth\.uid\(\)\)/);
    expect(sql).toMatch(/group by m\.conversation_id, c\.last_message_at\s+order by c\.last_message_at desc, m\.conversation_id/);
  });

  it("is for members only", () => {
    expect(sql).toMatch(/revoke execute on function public\.unread_message_counts\(\) from public, anon;/);
    expect(sql).toMatch(/grant execute on function public\.unread_message_counts\(\) to authenticated;/);
  });
});
