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
        expect(text.slice(at + 7), p.name).toMatch(/^\(select public\.my_block(_partners|ers)\(\)\)::uuid\[\]\)/);
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
      expect(rewrite).toMatch(new RegExp(`revoke execute on function[^;]*public\\.${name}\\([^;]*from public, anon, authenticated;`));
      expect(rewrite).toMatch(new RegExp(`grant execute on function[^;]*public\\.${name}\\([^;]*to authenticated;`));
    }
  });

  it("is proven by the policy harness, which runs the matrix, the plans and the rollback", () => {
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/snapshot_before_0023\.sql/);
    expect(runner).toMatch(/"08_policy_rewrite\.sql", "09_scale_plans\.sql", "10_rollback_0023\.sql"/);
    // And the read-only check the owner runs on production after applying it.
    expect(runner).toMatch(/12_policies_read_once_verify\.sql/);
    const verify = readFileSync(join(root, "supabase", "production", "12_policies_read_once_verify.sql"), "utf8");
    expect(code(verify)).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/i);
  });
});
