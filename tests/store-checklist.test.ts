import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The launch checklist is what the owner follows and what goes into App
 * Store Connect word for word, so the parts that state facts are held to
 * the repository: the migrations to run, the rights in the house
 * photographs, what Apple is told about the house accounts, and the two
 * review blockers that live in other parts of the code.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");
const doc = () => read("APP_STORE_LAUNCH.md");
const between = (text: string, start: string, end: string) => {
  const from = text.indexOf(start);
  expect(from, `"${start}" in APP_STORE_LAUNCH.md`).toBeGreaterThanOrEqual(0);
  const to = text.indexOf(end, from + start.length);
  return text.slice(from, to < 0 ? undefined : to);
};
const reviewNotes = () => between(doc(), "**App Review notes (paste):**", "\n---\n");
const flat = (s: string) => s.replace(/^> ?/gm, "").replace(/\s+/g, " ");

describe("the database step", () => {
  it("runs every new migration, in number order, not a list that a later migration falls out of", () => {
    const step = flat(between(doc(), "### Step 4", "### Step 5"));
    expect(step).toContain("every file from 0023 up, one at a time, in number order");
    expect(step).toContain("take the list from the folder");
    expect(step).toContain("numbered **12 or higher**");
    // The old wording named two files and "in that order", and skipped 0025.
    expect(step).not.toMatch(/Then the same for `0024/);
    expect(step).not.toMatch(/One at a time, in that order/);
    // Every migration this branch carries past 0022 is one the step covers by its number.
    const extra = readdirSync(path.join(root, "supabase/migrations")).filter((f) => /^\d{4}_/.test(f) && Number(f.slice(0, 4)) > 22);
    for (const f of extra) expect(Number(f.slice(0, 4)), f).toBeGreaterThanOrEqual(23);
    const where = flat(between(doc(), "### Production", "### The web"));
    expect(where).not.toMatch(/adds `0023_[^`]+` and `0024_[^`]+` and changes/);
    expect(where).toContain("numbered from **0023 up**");
  });

  /**
   * Verify script 12 grows with the migrations (each new one adds rows to
   * it, and the harness counts them). The step names what it checks on one
   * line; when the script grows, this says exactly what that line should
   * now read.
   */
  const verify = () => read("supabase/production/12_policies_read_once_verify.sql");
  const rowLabels = () =>
    new Map([...verify().matchAll(/select (\d+)(?: as n)?, '((?:[^']|'')*)'/g)].map((m) => [Number(m[1]), m[2]] as const));

  it("names what verify script 12 checks as the script and its harness do", () => {
    const [, from, to] = verify().split("\n")[0].match(/verify (\d{4})-(\d{4})/) ?? [];
    const count = Number(read("supabase/tests/run.mjs").match(/rows\.length !== (\d+)/)?.[1]);
    expect(from, "the script's first line names its range").toBe("0023");
    expect(rowLabels().size, "every row of the script is numbered").toBe(count);
    const line = `Verify script 12 today: \`12_policies_read_once_verify.sql\`, which checks ${from} to ${to} in ${count} rows.`;
    expect(doc(), `APP_STORE_LAUNCH.md step 4: make its verify line read: ${line}`).toContain(`\n   ${line}\n`);
  });

  it("says which rows of the script are each file's, and they are", () => {
    const step = between(doc(), "### Step 4", "### Step 5");
    const lines = [...step.matchAll(/^ {3}\| (\d{4}) \| [^|]+ \| ([\d–, ]+) \|$/gm)];
    expect(lines.length, "the table of files and their rows").toBeGreaterThanOrEqual(12);
    const labels = rowLabels();
    const listed = new Map<number, string>();
    for (const [, file, rows] of lines) {
      for (const part of rows.split(",").map((p) => p.trim())) {
        const [a, b] = part.split("–").map(Number);
        for (let n = a; n <= (b ?? a); n++) {
          expect(labels.has(n), `row ${n} (${file})`).toBe(true);
          const named = labels.get(n)!.match(/^(\d{4}):/)?.[1];
          if (named) expect(named, `row ${n}: ${labels.get(n)}`).toBe(file);
          listed.set(n, file);
        }
      }
    }
    // Every row the script names as a file's is listed under that file, so a file that adds rows (or a
    // file edited in place that adds one) has its line in the table, and the message says what to write.
    const files = new Set(lines.map((l) => l[1]));
    for (const [n, label] of labels) {
      const named = label.match(/^(\d{4}):/)?.[1];
      if (named) {
        expect(listed.get(n), `APP_STORE_LAUNCH.md step 4: list row ${n} under ${named} in the table (its label: "${label}")`).toBe(named);
      }
    }
    // And each file is in the folder.
    const folder = readdirSync(path.join(root, "supabase/migrations")).map((f) => f.slice(0, 4));
    for (const file of files) expect(folder, file).toContain(file);
  });
});

describe("the house accounts, as Apple is told about them", () => {
  const credits = () => read("seed/CREDITS.md");
  const count = (licence: string) => credits().split("\n").filter((l) => l.includes(`| ${licence} |`)).length;

  it("Content Rights does not claim the house photographs, and counts their licences as seed/CREDITS.md does", () => {
    const rights = flat(between(doc(), "- Content Rights:", "- **Age Rating**"));
    expect(rights).not.toMatch(/photographs are yours/);
    expect(rights).toContain("which are **not yours**");
    const unsplash = count("Unsplash Licence");
    const pd = count("Public domain");
    const cc0 = count("CC0");
    const none = count("No restrictions");
    const rows = credits().split("\n").filter((l) => /^\| \[/.test(l)).length;
    expect(unsplash + pd + cc0 + none, "every row in seed/CREDITS.md has one of the four licences").toBe(rows);
    expect(rights).toContain(`of the ${rows}, ${unsplash} are under the Unsplash Licence, ${pd} public domain, ${cc0} CC0 and ${none} marked "no restrictions"`);
    const decide = flat(between(doc(), "## 7. Decide before you submit: the house accounts", "## 8."));
    if (unsplash > 0) expect(decide).toContain("does not include the right to compile photos from Unsplash to replicate a similar or competing service");
    expect(decide).toContain(`The other ${pd + cc0 + none} are public domain (${pd}), CC0 (${cc0}) or marked "no restrictions" (${none})`);
  });

  it("seed/CREDITS.md says above its table what the table says: how many, from where, under which licence", () => {
    const text = credits();
    const header = flat(text.slice(0, text.indexOf("| File |")));
    const rows = text.split("\n").filter((l) => /^\| \[/.test(l)).length;
    const unsplash = count("Unsplash Licence");
    const pd = count("Public domain");
    const cc0 = count("CC0");
    const none = count("No restrictions");
    expect(header).toContain(`${rows} photographs`);
    expect(header).toContain(`${unsplash} from Unsplash, through Lorem Picsum, under the Unsplash Licence`);
    expect(header).toContain(`${pd + cc0 + none} from Wikimedia Commons (${pd} public domain, ${cc0} CC0 and ${none} marked "no restrictions")`);
    // It used to call all of them public domain or CC0, with 679 Unsplash rows beneath.
    expect(header).not.toMatch(/all public domain or CC0/);
    expect(flat(between(doc(), "- Content Rights:", "- **Age Rating**"))).not.toMatch(/header wrongly says/);
  });

  it("seed/build.mjs writes that same header, so running it again does not take it back", () => {
    const text = credits();
    const rows = text.split("\n").filter((l) => /^\| \[/.test(l)).length;
    const src = read("seed/build.mjs");
    const from = src.indexOf("const credits = [") + "const credits = ".length;
    const to = src.indexOf('"| File | Licence | Author |"', from);
    expect(from, "the header in seed/build.mjs").toBeGreaterThan("const credits = ".length);
    const header = new Function("used", "unsplash", "pd", "cc0", "none", `return ${src.slice(from, to)}];`)(
      { size: rows },
      count("Unsplash Licence"),
      count("Public domain"),
      count("CC0"),
      count("No restrictions"),
    ) as string[];
    expect(header.join("\n")).toBe(text.slice(0, text.indexOf("| File |")).replace(/\n$/, ""));
    // Counted whatever the case of the licence's spelling (photos.json has one "Public Domain"), and none left out.
    expect(src).toMatch(/const licenceOf = \(p\) => \(photos\.find\(\(x\) => x\.url === p\.url\)\?\.licence \?\? ""\)\.toLowerCase\(\);/);
    expect(src).toMatch(/if \(unsplash \+ pd \+ cc0 \+ none !== used\.size\) \{\s*throw new Error/);
    expect(src).not.toMatch(/all public domain or CC0/);
  });

  it("the house seed's SQL and its README name the Unsplash Licence beside public domain and CC0", () => {
    // The seed's own header is the one seed/build.mjs writes, so a rebuild leaves it as it is.
    const seed = read("supabase/production/08_house_accounts.sql");
    expect(seed).toContain("-- The photographs are public domain, CC0 or under the Unsplash Licence —");
    expect(read("seed/build.mjs")).toContain("\n-- The photographs are public domain, CC0 or under the Unsplash Licence —\n");
    const readme = flat(read("supabase/production/README.md"));
    expect(readme).toContain("The photographs are public domain, CC0 or under the Unsplash Licence.");
    expect(readme).toContain('see "What is still yours to decide" in `APP_STORE_LAUNCH.md`');
    expect(doc()).toContain("**What is still yours to decide**");
    // They used to say every photograph was public domain or CC0.
    for (const text of [seed, readme]) expect(text).not.toMatch(/(?:Every photograph is|photographs are) public domain or CC0/);
  });

  it("the review notes say the accounts the reviewer follows are the club's own, not people", () => {
    expect(read("supabase/migrations/0011_house_accounts.sql")).toMatch(/add column if not exists is_house/);
    const notes = flat(reviewNotes());
    expect(notes).toContain("The accounts the review account follows are the club's own house accounts: they are not people, they cannot sign in");
    expect(notes).not.toMatch(/Home shows photographs from the members this account follows/);
    // The house accounts have no password, as the notes say.
    expect(read("seed/README.md")).toContain("they cannot sign in");
  });

  it("the counts tell members from house accounts", () => {
    const where = flat(between(doc(), "### Production", "### The web"));
    expect(where).not.toMatch(/155 approved members/);
    expect(where).toContain("150 **house accounts**");
    expect(where).toContain("**908 from house accounts, 231 from members**");
  });
});

describe("how objectionable content is filtered, as the review notes say it", () => {
  it("names admission and people, and says there is no automatic filter", () => {
    const notes = flat(reviewNotes());
    expect(notes).toContain("How objectionable content is filtered: by admission first.");
    expect(notes).toContain("There is no automatic content filter.");
    // "an invitation is tied to the member who sent it": the database records the inviter.
    expect(read("supabase/migrations/0016_invitations_and_places.sql")).toMatch(/invited_by\s+=\s+v_owner/);
    expect(notes).toContain("an invitation is tied to the member who sent it");
    // Location on the label, never the phone's position (tests/store-permissions.test.ts holds the code to it).
    expect(notes).toContain("the phone's own position is never read");
  });

  it("names only what an admin can do: remove content, warn and suspend, never remove a member", () => {
    const notes = flat(reviewNotes());
    expect(notes).toContain("admins remove content and warn or suspend members");
    expect(notes).not.toMatch(/remove (a )?members?\b/);
    // The admin pages: Remove on a reported photograph or comment, Warn and Suspend on a member, and nothing that deletes one.
    const members = read("app/admin/members.tsx");
    expect(members).toMatch(/<Button title="Warn"/);
    expect(members).toMatch(/"Reinstate" : "Suspend"/);
    expect(read("app/admin/reports.tsx")).toMatch(/removePost|removeComment/);
    const api = read("src/api/moderation.ts");
    expect(api).toMatch(/export async function warnMember\(/);
    expect(api).toMatch(/export async function setSuspension\(/);
    expect(api).not.toMatch(/export async function (remove|delete|ban)Member/);
  });
});

describe("the two review blockers of 5 November", () => {
  it("are listed before the build for as long as they are missing", () => {
    const before = flat(between(doc(), "### Before you build", "### Step 1"));
    if (!/deleteMyAccount/.test(read("app/(gate)/pending.tsx"))) {
      expect(before).toContain("Review blocker A · Delete account for someone who is not a member yet (Guideline 5.1.1(v))");
      expect(before).toContain("Until it does, do not submit.");
      expect(flat(doc())).toContain("**Two review blockers must be in the merged branch before you build");
    }
    if (!read("app/(gate)/invite.tsx").includes("By accepting you agree to the")) {
      expect(before).toContain("Review blocker B · The invitation screen says what is agreed to (Guideline 1.2)");
    }
  });

  it("once in the code, are no longer called missing, and the checklist says how to check the branch you build", () => {
    if (!/deleteMyAccount/.test(read("app/(gate)/pending.tsx"))) return;
    if (!read("app/(gate)/invite.tsx").includes("By accepting you agree to the")) return;
    const before = flat(between(doc(), "### Before you build", "### Step 1"));
    expect(before).toContain("search the file for `deleteMyAccount`");
    expect(before).toContain('`app/(gate)/invite.tsx` contains "By accepting you agree to the"');
    for (const missing of [
      /Two review blockers must be in the merged branch/,
      /They are not in this branch/,
      /do not submit before it is/,
      /That is a stopgap only/,
      /review blocker [AB]\)/,
    ]) {
      expect(flat(doc())).not.toMatch(missing);
    }
    const testflight = flat(read("TESTFLIGHT.md"));
    expect(testflight).not.toMatch(/Two review blockers remain|has no way to delete itself yet|does not yet say/);
    expect(testflight).toContain("Delete my account");
    // The phone steps try both, as the reviewer will.
    const phone = flat(between(doc(), "## 6. On your iPhone", "## 7."));
    expect(phone).toContain("tap **Delete my account**");
    expect(phone).toContain("Keep my account");
    expect(phone).toContain('"By accepting you agree to the Terms of Use and Privacy Policy"');
    // The card Apple is sent to opens on its welcome, in the app's own words.
    const invite = read("app/(gate)/invite.tsx");
    for (const words of ["A member has put your name forward", "That invitation isn’t one we know"]) {
      expect(invite, words).toContain(words);
    }
    expect(phone).toContain('the card opens with "A member has put your name forward", never with "That invitation isn’t one we know"');
    const notes = flat(reviewNotes());
    expect(notes).toContain("Delete my account, then two confirmations");
    expect(notes).toContain("accepting agrees to the Terms of Use and Privacy Policy");
  });

  it("and the documents' date is the one the checklist gives", async () => {
    const { LEGAL_UPDATED } = await import("@/legal/documents");
    const phone = flat(between(doc(), "## 6. On your iPhone", "## 7."));
    expect(phone).toContain(`dated ${LEGAL_UPDATED}`);
    expect(flat(between(doc(), "### Step 3", "### Step 4"))).toContain(`"Last updated ${LEGAL_UPDATED}"`);
  });
});

describe("the Support URL", () => {
  it("is not given to Apple before the support page exists", () => {
    if (existsSync(path.join(root, "public/support.html"))) return;
    const web = flat(between(doc(), "### The web", "### What this pass changed"));
    expect(web).toContain("**but it is not a support page yet**");
    expect(web).toContain("Do not enter the Support URL in App Store Connect (step 9) before then");
    expect(flat(between(doc(), "### Step 9", "### Step 10"))).toContain("(only once step 3 shows your address on it)");
  });
});

/**
 * What the checklist says of reports, held to the migrations the branch
 * carries: kept when their reporter leaves (0031), told to the admins when
 * filed (0032), and out of the reporter's own reads (0033). Each line says
 * what is true with the migration and what production does until it is
 * applied; without the migration in the branch, the line must not claim it.
 */
describe("the checklist on reports", () => {
  const sql = () =>
    readdirSync(path.join(root, "supabase/migrations"))
      .filter((f) => /^\d{4}_.*\.sql$/.test(f))
      .sort()
      .map((f) => read(`supabase/migrations/${f}`).replace(/--[^\n]*/g, ""))
      .join("\n");

  it("a report outlives its reporter only as the migrations say", () => {
    const kept = /foreign key\s*\(reporter_id\)\s*references\s+public\.profiles\s*\(id\)\s*on delete set null/i.test(sql());
    const text = flat(doc());
    if (kept) {
      expect(text).toContain("A report outlives the member who filed it only once migration 0031 is applied (step 4)");
      expect(text).toContain("migration 0031 keeps them");
      expect(text).not.toMatch(/Deleting an account deletes the reports that member filed/);
    } else {
      expect(text).not.toMatch(/0031/);
      expect(text).toMatch(/Deleting an account deletes the reports that member filed/);
    }
  });

  it("the admins are told of a new report only as the migrations say", () => {
    const told = /create trigger\s+reports_push_trigger\b/i.test(sql());
    const step10 = flat(between(doc(), "### Step 10", "\n---\n"));
    if (told) {
      expect(step10).toContain("Once migration 0032 is applied and the `push` function redeployed (step 4)");
      expect(step10).not.toMatch(/it is not built/);
    } else {
      expect(step10).not.toMatch(/0032/);
    }
  });

  it("a reported photograph leaves its reporter's reads only as the migrations say", () => {
    const hidden = /create policy\s+"posts: not what I reported"/i.test(sql());
    const text = flat(doc());
    if (hidden) {
      expect(text).toContain("it stays out of everything they read afterwards only once migration 0033 is applied (step 4)");
      expect(text).not.toMatch(/stays visible to them until an admin acts/);
    } else {
      expect(text).not.toMatch(/0033/);
    }
  });
});

/**
 * The owner's own steps after review: redeploying the push function,
 * deleting an account by hand, and what the review notes and the support
 * page say about the house accounts and about reporting from a thread.
 */
describe("the push function's redeploy", () => {
  it("names both of its files, and how to see both were deployed", () => {
    const folder = readdirSync(path.join(root, "supabase/functions/push")).filter((f) => f.endsWith(".ts")).sort();
    expect(folder).toEqual(["index.ts", "logic.ts"]);
    expect(read("supabase/functions/push/index.ts")).toMatch(/from "\.\/logic\.ts"/);
    const step = flat(between(doc(), "### Step 4", "### Step 5"));
    expect(step).toContain("It is now **two files**, `index.ts` and `logic.ts`");
    expect(step).toContain("`npx supabase functions deploy push --project-ref scfwowqsqrnzpknzurmm` which uploads both");
    expect(step).toContain("add a second file named `logic.ts` with the contents of `supabase/functions/push/logic.ts`");
    expect(step).toContain("must show **version 2 or higher, with both files**");
    // It used to offer the dashboard as if the function were one file.
    expect(step).not.toMatch(/push` → deploy the new code\)/);
  });
});

describe("deleting an account by hand", () => {
  it("removes the files in all three buckets before the user, whatever the account's status", () => {
    const step10 = flat(between(doc(), "### Step 10", "\n---\n"));
    const from = step10.indexOf("If someone writes to the support address asking you to delete");
    expect(from).toBeGreaterThanOrEqual(0);
    const bullet = step10.slice(from, step10.indexOf("- Apple's reviewer", from));
    // The app's own way first: it removes the files itself.
    expect(bullet.indexOf("**Delete my account**")).toBeLessThan(bullet.indexOf("1. Check the message"));
    expect(bullet).toContain("**whatever the account's status**");
    expect(bullet).toContain("**each of the three buckets, `avatars`, `media` and `thumbnails`**");
    expect(bullet.indexOf("`thumbnails`")).toBeLessThan(bullet.indexOf("**Delete user**"));
    expect(bullet).toContain("Use the Storage screen, not SQL");
    // It used to name only avatars, and only for a portrait on an application.
    expect(bullet).not.toMatch(/If they added a portrait to their application/);
    // The three are the buckets Delete my account empties.
    const buckets = read("src/api/account.ts").match(/const BUCKETS: Bucket\[\] = \[([^\]]+)\]/)?.[1];
    expect(buckets?.split(",").map((b) => b.trim().replace(/"/g, "")).sort()).toEqual(["avatars", "media", "thumbnails"]);
  });
});

describe("the house accounts' likes and comments", () => {
  it("are disclosed wherever the house accounts are, for as long as the seed makes them", async () => {
    const seed = read("supabase/production/08_house_accounts.sql");
    const graph = seed.slice(seed.indexOf("do $graph$"), seed.indexOf("$graph$;"));
    const scripted = /insert into public\.likes[\s\S]*m\.is_house/.test(graph) && /insert into public\.comments[\s\S]*m\.is_house/.test(graph);
    expect(scripted, "the house seed still likes and comments between house accounts").toBe(true);
    const { TERMS_OF_USE } = await import("@/legal/documents");
    expect(TERMS_OF_USE).toContain(
      "They also follow, like and comment on one another's photographs: those likes and comments were made by script, not written by people.",
    );
    expect(read("public/terms.html")).toContain("They also follow, like and comment on one another");
    const notes = flat(reviewNotes());
    expect(notes).toContain("They also follow, like and comment on one another's photographs: those likes and comments");
    expect(notes).toContain("were made by script when the accounts were made, not written by people");
    const decide = flat(between(doc(), "## 7. Decide before you submit: the house accounts", "## 8."));
    expect(decide).toContain("1,778 follows, 11,138 likes and 4,182 comments, all between house accounts");
    expect(decide).toContain("Nothing was deleted");
  });
});

describe("reporting from a message thread", () => {
  it("is in the review notes and on the support page, and the checklist says to check the branch until the thread has it", () => {
    const notes = flat(reviewNotes());
    expect(notes).toContain('A message thread\'s "…" menu shows the other member\'s profile and lets you report or block them.');
    const support = read("scripts/build-legal.mjs");
    expect(support).toContain("In a message thread, the “…” at the top shows the other member’s profile and lets you report or block them.");
    // The phone step names the menu's own words (r16-client's thread menu).
    expect(flat(between(doc(), "## 6. On your iPhone", "## 7."))).toContain('"…" at the top has View profile, Report member and Block member.');
    if (!/"Report member"/.test(read("app/messages/[id].tsx"))) {
      const before = flat(between(doc(), "### Before you build", "### Step 1"));
      expect(before).toContain("Also check the message thread's **\"…\"** menu is in the branch");
    }
  });
});

describe("a private account's requests, on the phone", () => {
  it("are tried once 0038 is applied, in the app's own words", () => {
    const phone = flat(between(doc(), "## 6. On your iPhone", "## 7."));
    expect(phone).toContain("Private accounts (once 0038 is applied, step 4)");
    expect(phone).toContain("the button reads Requested, and its photographs stay hidden");
    // An account that follows already keeps its follow: no request is made.
    expect(phone).toContain("if you already follow it, unfollow first");
    // With one request waiting, the row reads "1 request waiting", not "Follow requests" (that is its
    // label only when nothing waits): the words on screen at that moment.
    expect(phone).toContain("Settings → 1 request waiting → Accept");
    expect(phone).not.toContain("Settings → Follow requests → Accept");
    expect(phone).toContain("The request leaves Activity");
    const sql = read("supabase/migrations/0038_follows_respect_private_accounts.sql");
    expect(sql).toMatch(/create policy "follows: followee accepts"/);
    expect(sql).toMatch(/create trigger follows_request_notice_gone/);
    const settings = read("app/settings.tsx");
    expect(settings).toContain(">Private account<");
    expect(settings).toMatch(/pending > 0\s+\? `\$\{pending\} \$\{pending === 1 \? "request" : "requests"\} waiting`\s+: "Follow requests"/);
    expect(read("app/user/[username].tsx")).toContain('"Requested"');
    // The steps after it moved down one, and the one that points ahead points at the right one.
    expect(flat(doc())).toContain("Delete this account afterwards in step 20");
    expect(flat(doc())).toContain("Have a second account (or a second phone) for steps 9–13, 16 and 18.");
    expect(phone).toMatch(/18\. On the second account \(not an admin\), type `vintage:\/\/admin\/members`/);
    expect(phone).toMatch(/20\. On the throwaway account: Settings → Delete account/);
  });
});
