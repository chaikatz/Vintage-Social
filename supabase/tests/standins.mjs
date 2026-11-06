/**
 * Stand-ins for the two Supabase extensions a stock PostgreSQL lacks.
 *
 * pg_net and pg_cron come with every Supabase project and with no plain
 * PostgreSQL install, and 0017 creates both, so on a stock server the
 * policy tests stopped at 0017 and never reached anything after it. Where
 * the server running them has neither, a migration that creates one is
 * applied from a copy that makes, in its place, the one function the
 * migrations call from it (net.http_post, cron.schedule), with the same
 * name and arguments and no effect. Nothing else in the file changes, and
 * a server that has the real extension is given the real one.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

/** What stands in for each extension this server does not have. */
export function extensionStandIns(available) {
  const out = [];
  if (!available.has("pg_net")) {
    out.push({
      name: "pg_net",
      statement: "create extension if not exists pg_net with schema extensions;",
      sql: [
        "create schema if not exists extensions;",
        "create schema if not exists net;",
        "create or replace function net.http_post(",
        "  url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,",
        "  headers jsonb default '{}'::jsonb, timeout_milliseconds integer default 5000)",
        "returns bigint language sql as 'select 1::bigint';",
      ].join("\n"),
    });
  }
  if (!available.has("pg_cron")) {
    out.push({
      name: "pg_cron",
      statement: "create extension if not exists pg_cron;",
      sql: [
        "create schema if not exists cron;",
        "create or replace function cron.schedule(job_name text, schedule text, command text)",
        "returns bigint language sql as 'select 1::bigint';",
      ].join("\n"),
    });
  }
  return out;
}

/**
 * The file to apply: the migration itself, or a copy in `scratch` with its
 * missing extensions stood in for. `onCopy` is told the copy's path (the
 * runner hands it to the server's account when it runs as root).
 */
export function withStandIns(file, standIns, scratch, onCopy = () => {}) {
  if (standIns.length === 0) return { path: file, stood: [] };
  let text = readFileSync(file, "utf8");
  const stood = [];
  for (const s of standIns) {
    if (!text.includes(s.statement)) continue;
    text = text.replace(s.statement, s.sql);
    stood.push(s.name);
  }
  if (stood.length === 0) return { path: file, stood };
  const copy = join(scratch, `standin-${basename(file)}`);
  writeFileSync(copy, text);
  onCopy(copy);
  return { path: copy, stood };
}
