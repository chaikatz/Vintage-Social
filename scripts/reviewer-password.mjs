#!/usr/bin/env node
/**
 * The App Review account's password, set and checked from your own Mac.
 *
 *   node scripts/reviewer-password.mjs hash
 *     Asks for a new password twice (nothing is echoed), hashes it here with
 *     bcrypt, and prints the SQL to paste into the PRODUCTION SQL editor.
 *     The SQL carries only the hash: the password never leaves this machine,
 *     is never written to disk, and never appears in the dashboard's query
 *     history. Nothing but that one account's password row is touched.
 *
 *   node scripts/reviewer-password.mjs verify
 *     Asks for the password once and signs in as the reviewer against the
 *     project in .env.production (or EXPO_PUBLIC_SUPABASE_URL / _ANON_KEY in
 *     the environment), then checks what the app would see: an approved
 *     profile, the invitation allowance, and a Home feed with photographs in
 *     it. Signs out again. Prints PASS or FAIL; prints no secret.
 *
 * Needs bcryptjs for `hash` (a pure-JavaScript bcrypt, not a dependency of
 * the app):  npm i --no-save bcryptjs
 *
 * The hash is bcrypt "$2a$", which Supabase Auth verifies natively, so a
 * password set this way signs in exactly like one set at sign-up.
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const mode = args.find((a) => !a.startsWith("--")) ?? "";
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] ?? "" : null;
};
const EMAIL = flag("email") ?? "appreview@vintagesocial.app";
const PRODUCTION_REF = "scfwowqsqrnzpknzurmm";

// ---------------------------------------------------------------------------
// asking
// ---------------------------------------------------------------------------
// Piped input (a test, a script): one reader for the whole run, handing out
// lines in order, never echoing them. Closing it between questions would
// end stdin, so it stays open.
let piped = null;
function pipedLine() {
  if (!piped) {
    piped = { lines: [], waiting: [], ended: false };
    const rl = createInterface({ input: process.stdin, terminal: false });
    rl.on("line", (line) => {
      const w = piped.waiting.shift();
      if (w) w(line);
      else piped.lines.push(line);
    });
    rl.on("close", () => {
      piped.ended = true;
      for (const w of piped.waiting.splice(0)) w("");
    });
  }
  if (piped.lines.length) return Promise.resolve(piped.lines.shift());
  if (piped.ended) return Promise.resolve("");
  return new Promise((resolve) => piped.waiting.push(resolve));
}

/** A line from the terminal. Hidden input echoes nothing — not even stars. */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      process.stderr.write(question);
      pipedLine().then((line) => {
        process.stderr.write("\n");
        resolve(line);
      });
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => {
        // Show the question itself, swallow the keystrokes.
        if (s.includes(question)) process.stderr.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stderr.write("\n");
      resolve(answer);
    });
  });
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// hash: the SQL, with only the hash in it
// ---------------------------------------------------------------------------
async function hash() {
  let bcrypt;
  try {
    bcrypt = createRequire(import.meta.url)("bcryptjs");
  } catch {
    fail("bcryptjs is not installed. Run:  npm i --no-save bcryptjs   then try again.");
  }
  console.error(`Setting a new password for ${EMAIL}.`);
  console.error("Use 12 characters or more. Nothing you type is shown.");
  const first = await ask("New password: ", { hidden: true });
  if (first.length < 12) fail("Twelve characters or more, please.");
  if (/\s/.test(first)) fail("No spaces — a space is too easy to lose when pasting into App Store Connect.");
  const second = await ask("Again: ", { hidden: true });
  if (first !== second) fail("The two entries differ. Nothing was done.");

  const digest = bcrypt.hashSync(first, 10);
  if (!/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(digest)) fail("The hash did not come out in bcrypt's shape; nothing was printed.");
  if (!bcrypt.compareSync(first, digest)) fail("The hash did not verify against the password; nothing was printed.");

  console.error("\nPaste the following into the PRODUCTION SQL editor (Vintage-Production) and run it.");
  console.error("It changes one row: the reviewer's password hash. Old sessions are signed out.\n");
  console.log(`-- App Review account: new password hash. Generated locally; the password itself is not here.
update auth.users
set encrypted_password = '${digest}',
    email_confirmed_at = coalesce(email_confirmed_at, now()),
    banned_until = null,
    updated_at = now()
where email = '${EMAIL.replace(/'/g, "''")}';

-- Sessions opened with the old password end now.
update auth.refresh_tokens
set revoked = true, updated_at = now()
where user_id = (select id from auth.users where email = '${EMAIL.replace(/'/g, "''")}')
  and revoked = false;

-- Check: one user, confirmed, updated just now; the profile approved with its allowance.
select u.email, u.email_confirmed_at is not null as confirmed, u.updated_at,
       p.username, p.status, p.invite_quota
from auth.users u join public.profiles p on p.id = u.id
where u.email = '${EMAIL.replace(/'/g, "''")}';`);
  console.error("\nThen:  node scripts/reviewer-password.mjs verify");
}

// ---------------------------------------------------------------------------
// verify: sign in as the app would, look at what the app would see
// ---------------------------------------------------------------------------
function readEnvFile(file) {
  if (!existsSync(file)) return {};
  const env = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return env;
}

function backend() {
  const file = process.env.ENV_FILE ?? join(root, ".env.production");
  const fromFile = readEnvFile(file);
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? fromFile.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? fromFile.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
  if (!url || !key) {
    fail(
      `No backend to talk to. Put the production URL and anon key in ${file}\n` +
        "  (EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY — Supabase → Vintage-Production → Project Settings → API),\n" +
        "  or export them in this shell. The anon key is the publishable one, not service_role.",
    );
  }
  const ref = /^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1] ?? "?";
  return { url, key, ref };
}

async function verify() {
  const b = backend();
  console.error(`Project: ${b.ref}${b.ref === PRODUCTION_REF ? " (Vintage-Production)" : "  ← NOT the production project"}`);
  if (b.ref !== PRODUCTION_REF && !args.includes("--yes")) {
    const go = await ask("This is not production. Continue anyway? Type yes: ");
    if (go.trim() !== "yes") fail("Stopped. Nothing was done.");
  }
  const password = await ask(`Password for ${EMAIL} (not shown): `, { hidden: true });
  if (!password) fail("No password given.");

  const headers = { apikey: b.key, "Content-Type": "application/json" };
  const res = await fetch(`${b.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers,
    body: JSON.stringify({ email: EMAIL, password }),
  }).catch((e) => fail(`Could not reach ${b.url}: ${e.message}`));
  if (!res.ok) {
    let why = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      const detail = [j.error_code ?? j.error, j.msg ?? j.error_description].filter(Boolean).join(" — ");
      if (detail) why += `, ${detail}`;
    } catch {
      // nothing more to say
    }
    fail(`Sign-in refused: ${why}. The password in the database is not this one, or the account is not confirmed.`);
  }
  const session = await res.json();
  const token = session.access_token;
  const userId = session.user?.id;
  console.log(`PASS  signed in as ${EMAIL}`);

  const authed = { ...headers, Authorization: `Bearer ${token}` };
  const get = async (path, extra = {}) => {
    const r = await fetch(`${b.url}/rest/v1/${path}`, { headers: { ...authed, ...extra } });
    if (!r.ok) fail(`${path.split("?")[0]} answered ${r.status}`);
    return r;
  };

  // What the gate reads first: the member's own profile row.
  const profile = (await (await get(`profiles?select=username,status,role,invite_quota,member_no&id=eq.${userId}`)).json())[0];
  if (!profile) fail("Signed in, but the profile row could not be read — the app would sit on the splash screen.");
  if (profile.status !== "approved") fail(`Profile status is "${profile.status}" — the app would show the waitlist screen, not the feed.`);
  console.log(`PASS  profile @${profile.username} is approved (role ${profile.role}), ${profile.invite_quota} invitations in the allowance`);

  // What Home reads: posts by the members this account follows.
  const follows = await (await get(`follows?select=followee_id&follower_id=eq.${userId}&status=eq.accepted`)).json();
  const ids = follows.map((f) => f.followee_id);
  if (ids.length === 0) fail("The account follows nobody — Home would be empty.");
  const feed = await get(`posts?select=id&removed_at=is.null&author_id=in.(${ids.join(",")})`, { Prefer: "count=exact", Range: "0-0" });
  const total = Number(/\/(\d+)$/.exec(feed.headers.get("content-range") ?? "")?.[1] ?? 0);
  if (total === 0) fail("Follows exist but no photographs came back — Home would be empty.");
  console.log(`PASS  Home feed: ${total} photographs from ${ids.length} followed members`);

  // The invitation link the review notes mention.
  const link = await (await get(`invite_links?select=slug&owner_id=eq.${userId}`)).json();
  console.log(link[0]?.slug ? `PASS  invitation code "${link[0].slug}" belongs to this account` : "WARN  no invitation link on this account");

  await fetch(`${b.url}/auth/v1/logout`, { method: "POST", headers: authed }).catch(() => undefined);
  console.log("PASS  signed out again. The reviewer account reaches the feed directly.");
}

if (mode === "hash") await hash();
else if (mode === "verify") await verify();
else {
  console.error("usage: node scripts/reviewer-password.mjs hash | verify [--email <address>] [--yes]");
  process.exit(2);
}
