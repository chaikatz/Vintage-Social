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
import { extensionStandIns, withStandIns } from "./standins.mjs";

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

  // pg_net and pg_cron are Supabase's, not PostgreSQL's: a stock server has
  // neither, and 0017 asks for both. Where one is missing, a migration that
  // creates it is applied from a copy that makes, instead, the one function
  // the migrations call from it (net.http_post, cron.schedule), with the
  // same name and arguments and no effect. Nothing else in the file
  // changes, and a server that has the real extension gets the real one.
  const available = new Set(
    psql(["-U", "vintage_owner", "-At", "-c",
      "select name from pg_available_extensions where name in ('pg_net', 'pg_cron')"])
      .stdout.trim().split("\n").filter(Boolean),
  );
  const standIns = extensionStandIns(available);

  const files = [
    join(here, "00_scaffold.sql"),
    ...execFileSync("ls", [migrations])
      .toString().trim().split("\n").filter((f) => f.endsWith(".sql")).sort()
      .map((f) => join(migrations, f)),
    join(here, "01_fixtures.sql"),
  ];

  let snapshotTaken = false;
  for (const f of files) {
    const label = f.replace(join(here, ".."), "supabase");
    // Keep the policies, indexes and functions 0023 replaces, so
    // 08_policy_rewrite.sql can ask every question again under them.
    const name = f.split("/").pop();
    if (!snapshotTaken && f.startsWith(migrations) && name >= "0023") {
      process.stdout.write("· supabase/tests/snapshot_before_0023.sql … ");
      psql(["-U", "vintage_owner", "-q", "-f", join(here, "snapshot_before_0023.sql")], { stdio: ["ignore", "ignore", "pipe"] });
      snapshotTaken = true;
      console.log("ok");
    }
    const { path: applied, stood } = withStandIns(f, standIns, dir, (copy) => {
      if (runAs) execFileSync("chown", [runAs, copy]);
    });
    process.stdout.write(`· ${label}${stood.length ? ` (stand-in for ${stood.join(", ")})` : ""} … `);
    // Each migration in one transaction (-1), as Supabase's migration
    // runner and the SQL editor apply a file: what one does is all there or
    // none of it, and `set local` (0023's lock_timeout) holds for the file.
    const single = f.startsWith(migrations) ? ["-1"] : [];
    psql(["-U", "vintage_owner", "-q", ...single, "-f", applied], { stdio: ["ignore", "ignore", "pipe"] });
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
  // Invitation links, before the seed: they only need the fixtures.
  if (res.status === 0) {
    console.log("");
    process.stdout.write("· supabase/tests/04_invite_links.sql … ");
    const links = psql(["-U", "vintage_owner", "-f", join(here, "04_invite_links.sql")], {
      allowFail: true,
    });
    if (links.status !== 0) {
      console.log("FAILED");
      process.stdout.write(links.stdout ?? "");
      process.stderr.write(links.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log("ok");
      const note = (links.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
      if (note) console.log(note.replace(/^NOTICE:\s*/, "✓ "));
    }
  }

  // Sharing beyond the club: the link, the file behind it, and turning it off.
  if (res.status === 0 && process.exitCode !== 1) {
    process.stdout.write("· supabase/tests/05_shares.sql … ");
    const shares = psql(["-U", "vintage_owner", "-f", join(here, "05_shares.sql")], {
      allowFail: true,
    });
    if (shares.status !== 0) {
      console.log("FAILED");
      process.stdout.write(shares.stdout ?? "");
      process.stderr.write(shares.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log("ok");
      const note = (shares.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
      if (note) console.log(note.replace(/^NOTICE:\s*/, "✓ "));
    }
  }

  // Deleting a photograph that was sent in a message, and what a message
  // may become after. Rolls back, so the files below find what they expect.
  if (res.status === 0 && process.exitCode !== 1) {
    process.stdout.write("· supabase/tests/06_post_deletion.sql … ");
    const deletion = psql(["-U", "vintage_owner", "-f", join(here, "06_post_deletion.sql")], {
      allowFail: true,
    });
    if (deletion.status !== 0) {
      console.log("FAILED");
      process.stdout.write(deletion.stdout ?? "");
      process.stderr.write(deletion.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log("ok");
      const note = (deletion.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
      if (note) console.log(note.replace(/^NOTICE:\s*/, "✓ "));
    }
  }

  // A member's own names and arrangement for their eras: who writes the
  // row, who reads it, and what it may hold. Rolls back, like the last.
  if (res.status === 0 && process.exitCode !== 1) {
    process.stdout.write("· supabase/tests/07_era_edits.sql … ");
    const eras = psql(["-U", "vintage_owner", "-f", join(here, "07_era_edits.sql")], {
      allowFail: true,
    });
    if (eras.status !== 0) {
      console.log("FAILED");
      process.stdout.write(eras.stdout ?? "");
      process.stderr.write(eras.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log("ok");
      const note = (eras.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
      if (note) console.log(note.replace(/^NOTICE:\s*/, "✓ "));
    }
  }

  // 0023: every member asks every table everything, under the rewritten
  // policies and under the ones they replaced, and gets the same answers
  // (08); the plans at many times today's size (09); and the rollback
  // file, applied for real, puts the old policies back exactly before
  // 0023 is applied again (10). 08 and 09 roll back; 10 leaves the
  // database as 0023 made it.
  for (const file of [
    "08_policy_rewrite.sql",
    "09_scale_plans.sql",
    "10_rollback_0023.sql",
    "11_block_privacy.sql",
    "12_feed_page.sql",
    "13_photograph_rows_0028.sql",
    "14_moderation_0029_0033.sql",
  ]) {
    if (res.status !== 0 || process.exitCode === 1) break;
    if (!existsSync(join(here, file))) continue;
    process.stdout.write(`· supabase/tests/${file} … `);
    const started = Date.now();
    const r = psql(["-U", "vintage_owner", "-f", join(here, file)], { allowFail: true });
    if (r.status !== 0) {
      console.log("FAILED");
      process.stdout.write(r.stdout ?? "");
      process.stderr.write(r.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log(`ok (${((Date.now() - started) / 1000).toFixed(1)} s)`);
      const note = (r.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
      if (note) console.log(note.replace(/^NOTICE:\s*/, "✓ "));
      for (const l of (r.stdout ?? "").split("\n")) if (/^\s*(asked|plan:|time:)/.test(l)) console.log(`  ${l.trim()}`);
    }
  }

  // The read-only script the owner runs on production after 0023-0034: it
  // must run clean here, without a single error (the SQL editor shows only
  // the last statement's result, or only the error), and its one table,
  // the last statement's, must say ok on every row.
  const verify0023 = join(here, "..", "production", "12_policies_read_once_verify.sql");
  if (existsSync(verify0023) && res.status === 0 && process.exitCode !== 1) {
    process.stdout.write("· supabase/production/12_policies_read_once_verify.sql … ");
    const r = psql(["-U", "vintage_owner", "-A", "-F", "|", "-f", verify0023], { allowFail: true });
    const rows = (r.stdout ?? "").split("\n").filter((l) => /^\d+\|/.test(l));
    const failing = rows.filter((l) => !l.endsWith("|t"));
    const errors = (r.stderr ?? "").split("\n").filter((l) => /ERROR:/.test(l));
    if (r.status !== 0 || rows.length !== 34 || failing.length > 0 || errors.length > 0) {
      console.log("FAILED");
      process.stdout.write(r.stdout ?? "");
      process.stderr.write(r.stderr ?? "");
      process.exitCode = 1;
    } else {
      console.log(`ok (${rows.length} checks in one table, every one ok, no error)`);
    }
  }

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
        // 0034 over the seed as production has it: the house thumbnails.
        process.stdout.write("· supabase/tests/15_seed_thumbnails_0034.sql … ");
        const thumbs = psql(["-U", "vintage_owner", "-f", join(here, "15_seed_thumbnails_0034.sql")], { allowFail: true });
        if (thumbs.status !== 0) {
          console.log("FAILED");
          process.stdout.write(thumbs.stdout ?? "");
          process.stderr.write(thumbs.stderr ?? "");
          process.exitCode = 1;
        } else {
          console.log("ok");
          const passed = (thumbs.stderr ?? "").split("\n").find((l) => l.includes("checks passed"));
          if (passed) console.log(passed.replace(/^NOTICE:\s*/, "✓ "));
        }
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
