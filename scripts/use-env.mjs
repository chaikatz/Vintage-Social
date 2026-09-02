#!/usr/bin/env node
/**
 * Point the local app at STAGING or PRODUCTION.
 *
 *   npm run use:staging
 *   npm run use:production
 *   npm run env            # just say which one is active
 *
 * Copies .env.staging or .env.production over .env, then prints the project
 * it now points at. Metro reads .env at start, so restart `npm run phone`
 * after switching — the script says so.
 *
 * The safety here is not cleverness, it is that the answer is always on
 * screen: every switch prints the target, and `npm run env` prints it
 * without changing anything. Nobody has to remember what .env holds.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];

const read = (file) => {
  if (!existsSync(file)) return null;
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2];
  }
  return env;
};

/** The Supabase project ref is the first label of the host — the one thing
 * that actually distinguishes one backend from another. */
const refOf = (env) => {
  const url = env?.EXPO_PUBLIC_SUPABASE_URL ?? "";
  return /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? null;
};

const describe = (env) => {
  if (!env) return "nothing — .env is missing, so the app runs in demo mode";
  if (env.EXPO_PUBLIC_DEMO_MODE === "1") return "demo data (in-memory, nothing saved)";
  const ref = refOf(env);
  if (!ref) return "an unrecognised backend — check EXPO_PUBLIC_SUPABASE_URL";
  const known = { omvezsrkjizxdfeogccw: "STAGING", scfwowqsqrnzpknzurmm: "PRODUCTION" };
  return `${known[ref] ?? "an unknown project"}  (${ref})`;
};

const current = read(join(root, ".env"));

if (!target || target === "status") {
  console.log(`\n  VINTAGE is pointed at: ${describe(current)}\n`);
  process.exit(0);
}

if (target !== "staging" && target !== "production") {
  console.error(`\n  Unknown target "${target}". Use staging or production.\n`);
  process.exit(1);
}

const source = join(root, `.env.${target}`);
if (!existsSync(source)) {
  console.error(
    `\n  .env.${target} does not exist.\n` +
      (target === "production"
        ? "  Copy .env.production.example to .env.production and fill in the anon\n" +
          "  key from Supabase → Vintage-Production → Project Settings → API.\n"
        : "  It is committed to the repository; try `git checkout .env.staging`.\n"),
  );
  process.exit(1);
}

const next = read(source);
copyFileSync(source, join(root, ".env"));

const rule = "─".repeat(58);
console.log(`\n${rule}`);
console.log(`  VINTAGE is now pointed at: ${describe(next)}`);
if (target === "production") {
  console.log("  This is the real members' database. Anything you post is real.");
} else {
  console.log("  House accounts and seeded photographs. Nothing here is real.");
}
console.log(`${rule}`);
console.log("  Restart the dev server for it to take effect:  npm run phone\n");
