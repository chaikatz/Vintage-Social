import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// A plain ESM helper, shared with the policy-test runner.
import { extensionStandIns, withStandIns } from "../supabase/tests/standins.mjs";

/**
 * The policy tests (npm run test:rls) run every migration against a stock
 * PostgreSQL. 0017 creates pg_net and pg_cron, which only Supabase ships,
 * so on a stock server the run used to stop at 0017 and nothing after it
 * — 0018's blocking policies, 0019's shares, 0022's eras, 0023's rewrite —
 * was ever checked. These hold the runner to standing in for exactly
 * those two, and nothing else.
 */

const root = join(import.meta.dirname, "..");
const push = join(root, "supabase", "migrations", "0017_push.sql");
const scratches: string[] = [];
const scratchDir = () => {
  const d = mkdtempSync(join(tmpdir(), "vintage-standin-"));
  scratches.push(d);
  return d;
};
afterAll(() => {
  for (const d of scratches) rmSync(d, { recursive: true, force: true });
});

describe("the policy runner on a server without Supabase's extensions", () => {
  it("stands in for each one the server lacks, and only those", () => {
    expect(extensionStandIns(new Set()).map((s: { name: string }) => s.name)).toEqual(["pg_net", "pg_cron"]);
    expect(extensionStandIns(new Set(["pg_net"])).map((s: { name: string }) => s.name)).toEqual(["pg_cron"]);
    expect(extensionStandIns(new Set(["pg_net", "pg_cron"]))).toEqual([]);
  });

  it("applies 0017 from a copy that differs only where an extension was created", () => {
    const scratch = scratchDir();
    const standIns = extensionStandIns(new Set());
    const { path, stood } = withStandIns(push, standIns, scratch);
    expect(stood).toEqual(["pg_net", "pg_cron"]);
    expect(path).not.toBe(push);

    const original = readFileSync(push, "utf8");
    const copy = readFileSync(path, "utf8");
    expect(copy).not.toMatch(/create extension if not exists pg_net/);
    expect(copy).not.toMatch(/create extension if not exists pg_cron/);
    // Put the two statements back and the copy is the migration, byte for byte.
    let restored = copy;
    for (const s of standIns) restored = restored.replace(s.sql, s.statement);
    expect(restored).toBe(original);
  });

  it("gives the stand-ins every argument 0017 passes them by name", () => {
    const original = readFileSync(push, "utf8");
    const call = original.slice(original.indexOf("net.http_post("), original.indexOf(");", original.indexOf("net.http_post(")));
    const named = [...call.matchAll(/(\w+)\s*:=/g)].map((m) => m[1]);
    expect(named.sort()).toEqual(["body", "headers", "timeout_milliseconds", "url"]);
    const net = extensionStandIns(new Set()).find((s: { name: string }) => s.name === "pg_net")!.sql as string;
    for (const arg of named) expect(net).toMatch(new RegExp(`\\b${arg}\\b`));
    const cron = extensionStandIns(new Set()).find((s: { name: string }) => s.name === "pg_cron")!.sql as string;
    expect(original).toMatch(/select cron\.schedule\(\s*'[^']+',\s*'[^']+',/);
    expect(cron).toMatch(/cron\.schedule\(job_name text, schedule text, command text\)/);
  });

  it("leaves a migration that creates no extension alone", () => {
    const scratch = scratchDir();
    const schema = join(root, "supabase", "migrations", "0001_schema.sql");
    expect(withStandIns(schema, extensionStandIns(new Set()), scratch)).toEqual({ path: schema, stood: [] });
  });

  it("is what the runner applies every migration through", () => {
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/import \{ extensionStandIns, withStandIns \} from "\.\/standins\.mjs"/);
    expect(runner).toMatch(/pg_available_extensions/);
    expect(runner).toMatch(/withStandIns\(f, standIns, dir/);
    expect(runner).toMatch(/"-f", applied\]/);
  });

  it("applies each migration in one transaction, as Supabase and the SQL editor do", () => {
    const runner = readFileSync(join(root, "supabase", "tests", "run.mjs"), "utf8");
    expect(runner).toMatch(/const single = f\.startsWith\(migrations\) \? \["-1"\] : \[\];/);
    expect(runner).toMatch(/psql\(\["-U", "vintage_owner", "-q", \.\.\.single, "-f", applied\]/);
  });
});
