#!/usr/bin/env node
/**
 * Runs VINTAGE's migrations against a throwaway PostgreSQL cluster and
 * checks the publishing policies behave.
 *
 * Real policies, real roles, real SQL — the storage upsert bug that stopped
 * the founder publishing was invisible to any test that mocked Supabase,
 * because the write policies were correct and it was a missing *read*
 * policy that refused the statement.
 *
 * Skips (exit 0) when no PostgreSQL server binary is installed, so it is
 * safe to run anywhere; set VINTAGE_RLS_REQUIRED=1 to make that a failure.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, chmodSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrations = join(here, "..", "migrations");

function findPgBin() {
  const candidates = [];
  const base = "/usr/lib/postgresql";
  if (existsSync(base)) {
    for (const v of execFileSync("ls", [base]).toString().trim().split("\n").filter(Boolean)) {
      candidates.push(join(base, v, "bin"));
    }
  }
  candidates.push("/usr/local/pgsql/bin", "/usr/bin", "/opt/homebrew/bin");
  return candidates.reverse().find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
}

const pgBin = findPgBin();
if (!pgBin) {
  const required = process.env.VINTAGE_RLS_REQUIRED === "1";
  console.log(`${required ? "✗" : "—"} no PostgreSQL server found; policy tests ${required ? "REQUIRED" : "skipped"}`);
  process.exit(required ? 1 : 0);
}

// PostgreSQL refuses to run as root. When we are root, drop to the postgres
// system account for the server; otherwise run as ourselves.
const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
const runAs = asRoot ? "postgres" : null;
const wrap = (cmd, args) => (runAs ? ["runuser", ["-u", runAs, "--", cmd, ...args]] : [cmd, args]);

const dir = mkdtempSync(join(tmpdir(), "vintage-rls-"));
const data = join(dir, "data");
const sock = join(dir, "sock");
let started = false;

function run(cmd, args, opts = {}) {
  const [c, a] = wrap(cmd, args);
  const r = spawnSync(c, a, { encoding: "utf8", ...opts });
  if (r.status !== 0 && !opts.allowFail) {
    throw new Error(`${cmd} failed (${r.status})\n${r.stdout ?? ""}\n${r.stderr ?? ""}`);
  }
  return r;
}

function psql(args, opts = {}) {
  return run(join(pgBin, "psql"), ["-v", "ON_ERROR_STOP=1", "-h", sock, "-d", "vintage", ...args], opts);
}

try {
  execFileSync("mkdir", ["-p", data, sock]);
  if (runAs) {
    execFileSync("chown", ["-R", runAs, dir]);
  } else {
    chmodSync(dir, 0o700);
  }

  process.stdout.write("· initialising a throwaway cluster … ");
  run(join(pgBin, "initdb"), ["-D", data, "-A", "trust", "--username=vintage_owner", "-E", "UTF8"], {
    stdio: "ignore",
  });
  console.log("done");

  process.stdout.write("· starting postgres … ");
  run(join(pgBin, "pg_ctl"), [
    "-D", data,
    "-o", `-k ${sock} -c listen_addresses=''`,
    "-w", "-t", "60", "start",
  ], { stdio: "ignore" });
  started = true;
  console.log("done");

  run(join(pgBin, "createdb"), ["-h", sock, "-U", "vintage_owner", "vintage"], { stdio: "ignore" });

  const files = [
    join(here, "00_scaffold.sql"),
    ...execFileSync("ls", [migrations])
      .toString().trim().split("\n").filter((f) => f.endsWith(".sql")).sort()
      .map((f) => join(migrations, f)),
    join(here, "01_fixtures.sql"),
  ];

  for (const f of files) {
    const label = f.replace(join(here, ".."), "supabase");
    process.stdout.write(`· ${label} … `);
    psql(["-U", "vintage_owner", "-q", "-f", f], { stdio: ["ignore", "ignore", "pipe"] });
    console.log("ok");
  }

  console.log("");
  const res = psql(["-U", "vintage_owner", "-f", join(here, "02_publish_policies.sql")], {
    allowFail: true,
  });
  process.stdout.write(res.stdout ?? "");
  if (res.status !== 0) {
    process.stderr.write(res.stderr ?? "");
    process.exitCode = 1;
  } else {
    // psql prints RAISE NOTICE on stderr; surface the verdict line.
    const notice = (res.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
    if (notice) console.log(notice.replace(/^NOTICE:\s*/, "✓ "));
  }
  // If the house-account seed has been generated, apply it here too: a
  // bad seed is much cheaper to find in a throwaway database than in the
  // members' one.
  const seedSql = join(here, "..", "production", "08_house_accounts.sql");
  if (existsSync(seedSql) && res.status === 0) {
    console.log("");
    process.stdout.write("· applying supabase/production/08_house_accounts.sql … ");
    const applied = psql(["-U", "vintage_owner", "-q", "-f", seedSql], {
      allowFail: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    if (applied.status !== 0) {
      console.log("FAILED");
      process.stderr.write(applied.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log("ok");
      const seeded = psql(["-U", "vintage_owner", "-f", join(here, "03_house_seed.sql")], {
        allowFail: true,
      });
      process.stdout.write(seeded.stdout ?? "");
      if (seeded.status !== 0) {
        process.stderr.write(seeded.stderr ?? "");
        process.exitCode = 1;
      } else {
        const note = (seeded.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
        if (note) console.log(note.replace(/^NOTICE:\s*/, "✓ "));
      }
    }
  }
  // The staging runbook is SQL a person pastes by hand into the Supabase
  // editor. Run it here too, so a typo in it is found by `npm run test:rls`
  // rather than by someone at a keyboard at midnight.
  const stagingDir = join(here, "..", "staging");
  if (existsSync(stagingDir) && process.exitCode !== 1) {
    console.log("");
    const founder = readFileSync(join(stagingDir, "01_bootstrap_founder.sql"), "utf8")
      .replace("'your.username'", "'founder'");
    const tmp = join(dir, "bootstrap.sql");
    writeFileSync(tmp, founder);
    for (const [label, file] of [
      ["01_bootstrap_founder.sql", tmp],
      ["02_videos.sql", join(stagingDir, "02_videos.sql")],
      ["03_verify.sql", join(stagingDir, "03_verify.sql")],
    ]) {
      process.stdout.write(`· supabase/staging/${label} … `);
      const verify = label.startsWith("03");
      const r = psql(["-U", "vintage_owner", ...(verify ? [] : ["-q"]), "-f", file], {
        allowFail: true,
        stdio: ["ignore", verify ? "pipe" : "ignore", "pipe"],
      });
      if (r.status !== 0) {
        console.log("FAILED");
        process.stderr.write(r.stderr ?? "");
        process.exitCode = 1;
        break;
      }
      console.log("ok");
      // The verification script is a report; show it.
      if (verify) {
        process.stdout.write(r.stdout ?? "");
        for (const line of (r.stderr ?? "").split("\n")) {
          if (line.startsWith("NOTICE:")) console.log(line.replace(/^NOTICE:\s{2}/, "  "));
        }
      }
    }
  }
} catch (err) {
  console.error(String(err && err.message ? err.message : err));
  process.exitCode = 1;
} finally {
  if (started) {
    run(join(pgBin, "pg_ctl"), ["-D", data, "-m", "immediate", "-w", "stop"], {
      stdio: "ignore",
      allowFail: true,
    });
  }
  rmSync(dir, { recursive: true, force: true });
}
