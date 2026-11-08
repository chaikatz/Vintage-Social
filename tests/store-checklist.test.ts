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
const section7 = () => flat(between(doc(), "## 7. The house accounts: what was decided on 8 November", "## 8."));
const num = (n: string) => Number(n.replace(/,/g, ""));
const sqlOnly = (sql: string) => sql.replace(/--[^\n]*/g, "");

/**
 * Production on 8 November 2026, read after 13_remove_unsplash_house_photos.sql
 * ran there. Nothing in the repository can count these, so they are written
 * once here and the checklist is held to them wherever it states production;
 * where a number can be counted from the seed or from the script, the tests
 * below count it.
 */
const PRODUCTION = {
  posts: 469,
  members: 240,
  mapPoints: 131,
  removedLikes: 8346,
  removedMemberLikes: 3,
  removedComments: 3131,
  removedActivity: 11478,
  keptAvatars: 38,
  reviewFollowsAdded: 49,
  houseFollows: 1778,
  houseLikes: 2795,
  houseComments: 1051,
  before: { posts: 1139, members: 231, houseLikes: 11138, houseComments: 4182, reviewHome: 96, reviewLikes: 1183, reviewComments: 450 },
};
const commas = (n: number) => n.toLocaleString("en-US");

/** The house seed as 08_house_accounts.sql writes it: each photograph's author and address, and each account's picture. */
const seedHouse = () => {
  const sql = read("supabase/production/08_house_accounts.sql");
  const posts = [...sql.matchAll(/^\s+\('[0-9a-f-]+', '([0-9a-f-]+)', 'photo', '([^']*)'/gm)].map((m) => ({ author: m[1], media: m[2] }));
  const accounts = [...sql.matchAll(/^\s+\('([0-9a-f-]+)'::uuid, '(?:[^']|'')*', '(?:[^']|'')*', '(?:[^']|'')*', ('[^']*'|null), /gm)]
    .map((m) => ({ id: m[1], avatar: m[2].replace(/^'|'$/g, "") }));
  return { posts, accounts };
};
const isPicsum = (url: string) => /^https:\/\/picsum\.photos\//.test(url);

/** What 13_remove_unsplash_house_photos.sql itself counts: the Unsplash photographs it must find, and the house photographs it must leave. */
const removeCounts = () => {
  const sql = sqlOnly(read("supabase/production/13_remove_unsplash_house_photos.sql"));
  const before = sql.match(/where a\.is_house and p\.media_path ~ '\^https:\/\/picsum\\\.photos\/'\) <> (\d+) then\s+raise exception 'Expected (\d+) Unsplash house photographs\. Nothing was changed\.'/);
  const after = sql.match(/where a\.is_house\) <> (\d+) then\s+raise exception 'Expected (\d+) house photographs to remain\. Nothing was changed\.'/);
  expect(before, "13_remove counts the Unsplash house photographs before it changes anything").toBeTruthy();
  expect(after, "13_remove counts the house photographs it leaves").toBeTruthy();
  expect(before![1], "the count it checks is the count it names").toBe(before![2]);
  expect(after![1], "the count it checks is the count it names").toBe(after![2]);
  return { removed: Number(before![1]), left: Number(after![1]) };
};

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

  it("Content Rights does not claim the house photographs, and counts what production keeps as seed/CREDITS.md and 13_remove do", () => {
    const rights = flat(between(doc(), "- Content Rights:", "- **Age Rating**"));
    expect(rights).not.toMatch(/photographs are yours/);
    expect(rights).toContain("which are **not yours**");
    const unsplash = count("Unsplash Licence");
    const pd = count("Public domain");
    const cc0 = count("CC0");
    const none = count("No restrictions");
    const rows = credits().split("\n").filter((l) => /^\| \[/.test(l)).length;
    expect(unsplash + pd + cc0 + none, "every row in seed/CREDITS.md has one of the four licences").toBe(rows);
    // Production keeps the Wikimedia rows only: 13_remove takes the Unsplash rows and must leave the rest.
    const { removed, left } = removeCounts();
    expect(removed, "13_remove removes as many as seed/CREDITS.md lists under the Unsplash Licence").toBe(unsplash);
    expect(left, "13_remove leaves as many as seed/CREDITS.md lists from Wikimedia Commons").toBe(pd + cc0 + none);
    expect(rights).toContain(`the ${left} on production since 8 November are all from Wikimedia Commons, ${pd} public domain, ${cc0} CC0 and ${none} marked "no restrictions"`);
    expect(rights).toContain(`its table also lists the ${removed} Unsplash photographs the seed has, which production no longer shows`);
    expect(rights).toContain("decided on 8 November");
    // It used to count the Unsplash photographs among what the house accounts show.
    expect(rights).not.toMatch(/are under the Unsplash Licence|of the \d+, \d+ are/);
    const decide = section7();
    if (unsplash > 0) expect(decide).toContain("does not include the right to compile photos from Unsplash to replicate a similar or competing service");
    expect(decide).toContain(`The ${left} are public domain (${pd}), CC0 (${cc0}) or marked "no restrictions" (${none}), all from Wikimedia Commons`);
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
    // The table is the seed's; the header says what production has kept of it since 8 November.
    const { removed, left } = removeCounts();
    const avatars = seedHouse().accounts.filter((a) => isPicsum(a.avatar)).length;
    expect(header).toContain(
      `on 8 November 2026 it removed the ${removed} Unsplash photographs and the ${avatars} Unsplash profile pictures with \`supabase/production/13_remove_unsplash_house_photos.sql\`, so of the rows below only the ${left} from Wikimedia Commons are on production`,
    );
    expect(header).toContain("A fresh project seeded with `08_house_accounts.sql` must run `13_remove_unsplash_house_photos.sql` after it to match production.");
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
    // That is the seed; production removed the Unsplash ones, and the README says where that is recorded.
    expect(readme).toContain("On production the 679 Unsplash ones were removed on 8 November");
    expect(readme).toContain('section 7 of `APP_STORE_LAUNCH.md` records the decision, and "What is still yours to decide" there lists what is still open');
    expect(section7()).toContain("**What is still yours to decide**");
    // They used to say every photograph was public domain or CC0.
    for (const text of [seed, readme]) expect(text).not.toMatch(/(?:Every photograph is|photographs are) public domain or CC0/);
  });

  it("the review notes say the accounts the reviewer follows are the club's own, not people", () => {
    expect(read("supabase/migrations/0011_house_accounts.sql")).toMatch(/add column if not exists is_house/);
    const notes = flat(reviewNotes());
    expect(notes).toContain("The accounts the review account follows are the club's own house accounts: they are not people, they cannot sign in");
    expect(notes).not.toMatch(/Home shows photographs from the members this account follows/);
    // What they show is what production kept on 8 November: Wikimedia Commons, and no Unsplash.
    expect(notes).toContain('they show photographs from Wikimedia Commons that are public domain, CC0 or marked "no restrictions"');
    expect(notes).not.toMatch(/Unsplash|Picsum/);
    // The house accounts have no password, as the notes say.
    expect(read("seed/README.md")).toContain("they cannot sign in");
  });

  it("the counts tell members from house accounts, as production has them since 8 November", () => {
    const where = flat(between(doc(), "### Production", "### The web"));
    expect(where).not.toMatch(/155 approved members/);
    const { posts, accounts } = seedHouse();
    expect(accounts.length, "the seed's house accounts").toBe(150);
    expect(where).toContain(`${accounts.length} **house accounts**`);
    const { removed, left } = removeCounts();
    // Now: the house photographs are what 13_remove left, and the total adds up.
    const now = where.match(/([\d,]+) posts \(read 8 November\): \*\*([\d,]+) from house accounts, ([\d,]+) from members\*\*\. ([\d,]+) posts have a point on the map\./);
    expect(now, "section 1 states production's posts as read on 8 November").toBeTruthy();
    const [total, house, members, map] = now!.slice(1).map(num);
    expect([total, house, members, map]).toEqual([PRODUCTION.posts, left, PRODUCTION.members, PRODUCTION.mapPoints]);
    expect(total).toBe(house + members);
    // Before: the seed's photographs, less what 13_remove took, is what is left.
    const before = where.match(/before the Unsplash photographs were removed, there were ([\d,]+) posts: ([\d,]+) from house accounts and ([\d,]+) from members\./);
    expect(before, "the 5 November numbers, given as before the removal").toBeTruthy();
    const [bTotal, bHouse, bMembers] = before!.slice(1).map(num);
    expect([bTotal, bMembers]).toEqual([PRODUCTION.before.posts, PRODUCTION.before.members]);
    expect(bTotal).toBe(bHouse + bMembers);
    expect(bHouse, "every photograph the seed made").toBe(posts.length);
    expect(bHouse - removed).toBe(left);
    expect(posts.filter((p) => isPicsum(p.media)).length, "the seed's Unsplash photographs are the ones 13_remove counts").toBe(removed);
    // It used to state the 5 November split as production's.
    expect(where).not.toContain("**908 from house accounts, 231 from members**");
    // The house accounts left with nothing: the seed's, less those with a Wikimedia photograph.
    const withPhotographs = new Set(posts.filter((p) => !isPicsum(p.media)).map((p) => p.author)).size;
    expect(where).toContain(`Since 8 November they show ${left} photographs, all from Wikimedia Commons`);
    expect(where).toContain(`${accounts.length - withPhotographs} of the ${accounts.length} have no photographs left`);
    // The review account: the twelve 10_reviewer_account.sql gave it, and the house accounts 13_remove added.
    const made = Number(read("supabase/production/10_reviewer_account.sql").match(/where is_house and status = 'approved' order by post_count desc limit (\d+) loop/)?.[1]);
    expect(made).toBe(12);
    const follows = where.match(/It follows ([\d,]+) accounts \(read 8 November\), \*\*all of them house accounts\*\*: the (\d+) it was made with, and the (\d+) house accounts with photographs that it did not follow, added on 8 November\./);
    expect(follows, "section 1 states the review account's follows as read on 8 November").toBeTruthy();
    const [all, original, added] = follows!.slice(1).map(num);
    expect([original, added]).toEqual([made, PRODUCTION.reviewFollowsAdded]);
    expect(all).toBe(original + added);
    expect(added, "it can only have been given house accounts that have photographs").toBeLessThanOrEqual(withPhotographs);
    expect(where).toContain(`So the reviewer's Home is the ${left} house photographs.`);
    expect(where).not.toMatch(/all 12 are house accounts/);
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

  it("when Delete user meets a foreign key, runs what Delete my account runs first, for every reference that blocks it", () => {
    const step10 = between(doc(), "### Step 10", "\n---\n");
    const block = step10.match(/```sql\n([\s\S]*?)```/)?.[1];
    expect(block, "the SQL lines in step 10").toBeTruthy();
    expect(flat(step10)).toContain("If Delete user fails with a foreign key error");
    expect(step10.indexOf("```sql")).toBeGreaterThan(step10.indexOf("**Delete user**"));
    expect(flat(step10)).toContain("Never do this for the club's only admin");
    // The lines are delete_my_account's own, word for word, with the user's id in place of v_user.
    const fn = read("supabase/migrations/0018_launch_compliance.sql");
    const body = fn.slice(fn.indexOf("create or replace function public.delete_my_account()"), fn.indexOf("delete from auth.users where id = v_user;"));
    const released = (body.match(/^\s*(update public\.\w+ set \w+ = \w+ where \w+ = v_user;|delete from public\.moderation_actions[^;]+;)/gm) ?? [])
      .map((l) => l.trim().replace(/\s+/g, " "));
    const lines = block!.split(/;\s*\n/).map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean)
      .map((l) => (l.endsWith(";") ? l : `${l};`).replace(/'USER_ID'/g, "v_user"));
    expect(released.length).toBe(7);
    expect(lines).toEqual(released);
    // Every reference to a profile that does not go with it (NO ACTION) is one the lines release.
    const schema = read("supabase/migrations/0001_schema.sql");
    const tables = [...schema.matchAll(/create table public\.(\w+) \(([\s\S]*?)\n\);/g)];
    const blocking: string[] = [];
    for (const [, table, cols] of tables) {
      for (const [, col] of cols.matchAll(/^\s+(\w+)\s+uuid[^,\n]*references public\.profiles \(id\)(?! on delete)/gm)) blocking.push(`${table}.${col}`);
    }
    expect(blocking.sort()).toEqual([
      "applications.decided_by", "comments.removed_by", "invites.used_by",
      "moderation_actions.admin_id", "posts.removed_by", "reports.resolved_by",
    ]);
    for (const ref of blocking) {
      const [table, col] = ref.split(".");
      expect(block, ref).toMatch(new RegExp(`public\\.${table} [^;]*where ${col} = 'USER_ID'`));
    }
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
    // Production's numbers since 8 November, and the review account's Home, which carries all of them.
    const decide = section7();
    const { houseFollows, houseLikes, houseComments, before } = PRODUCTION;
    const { left } = removeCounts();
    expect(decide).toContain(
      `There are ${commas(houseFollows)} follows, ${commas(houseLikes)} likes and ${commas(houseComments)} comments, all between house accounts and made by script`,
    );
    expect(decide).toContain(`the ${left} photographs in the review account's Home carry all ${commas(houseLikes)} of those likes and all ${commas(houseComments)} of those comments`);
    // Still there, so still disclosed, and still open.
    expect(decide).toContain(
      `The ${commas(houseLikes)} likes and ${commas(houseComments)} comments between house accounts on the ${left} photographs still exist, and the Terms and the review notes still disclose them.`,
    );
    // The numbers of 6 November only as what came before the removal; it used to give them as production's, and say nothing was deleted.
    expect(decide).toContain(
      `Before the removal (read on 5 and 6 November) there were ${commas(before.posts)} posts (${commas(seedHouse().posts.length)} from house accounts), ${commas(before.houseLikes)} likes and ${commas(before.houseComments)} comments between house accounts, and the review account followed 12 house accounts, whose ${before.reviewHome} photographs carried ${commas(before.reviewLikes)} of those likes and ${before.reviewComments} of those comments.`,
    );
    expect(decide).not.toContain(`${commas(houseFollows)} follows, ${commas(before.houseLikes)} likes`);
    expect(decide).not.toMatch(/Nothing was deleted/);
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

/**
 * The Unsplash house photographs, removed from production on 8 November
 * with 13_remove_unsplash_house_photos.sql. The two 13_ files are the record
 * of what was run and the only way back; the seed was not rebuilt, so the
 * docs must say that a fresh project needs 13_remove after 08 to match.
 */
describe("the Unsplash house photographs removed on 8 November", () => {
  const removePath = "supabase/production/13_remove_unsplash_house_photos.sql";
  const restorePath = "supabase/production/13_restore_unsplash_house_photos.sql";
  const statements = (sql: string) => sqlOnly(sql).split(";").map((s) => s.trim().replace(/\s+/g, " ")).filter(Boolean);
  /** A file's header comment as one line of words, up to the line the script itself starts with. */
  const header = (file: string, firstLine: string) => {
    const text = read(file);
    expect(text.indexOf(firstLine), `${file}: the script as run starts after its header`).toBeGreaterThan(0);
    return flat(text.slice(0, text.indexOf(firstLine)).replace(/^-- ?/gm, ""));
  };

  it("both scripts are kept beside the others, and the remove script counts before and after it changes anything", () => {
    expect(existsSync(path.join(root, removePath)), removePath).toBe(true);
    expect(existsSync(path.join(root, restorePath)), restorePath).toBe(true);
    const { removed, left } = removeCounts();
    expect([removed, left]).toEqual([679, 229]);
    // The count before is checked before the first delete, and the count after only once everything is done.
    const body = sqlOnly(read(removePath));
    expect(body.indexOf(`<> ${removed} then`)).toBeLessThan(body.indexOf("delete from public.posts"));
    expect(body.indexOf(`<> ${left} then`)).toBeGreaterThan(body.indexOf("insert into public.follows"));
    // It refuses to run twice, and the copy it keeps is out of the app's reach.
    expect(body).toContain("if to_regnamespace('removed_20261108') is not null then");
    expect(body).toContain("revoke all on schema removed_20261108 from public, anon, authenticated;");
    // The header is the record: run on production on 8 November, and how to drop the copy.
    const said = header(removePath, "-- VINTAGE · remove the house accounts' Unsplash photographs (8 November 2026)\n");
    expect(said).toContain("RUN ON PRODUCTION (scfwowqsqrnzpknzurmm) ON 8 NOVEMBER 2026");
    expect(said).toContain("drop schema removed_20261108 cascade;");
    expect(said).toContain("13_restore_unsplash_house_photos.sql puts all of it back; that file exists only to undo this one.");
    expect(said).toContain(`it refuses unless there are exactly ${removed} Unsplash house photographs, and undoes everything unless exactly ${left} house photographs are left`);
  });

  it("the restore puts back every table the remove script copied", () => {
    const copied = [...sqlOnly(read(removePath)).matchAll(/create table removed_20261108\.(\w+) as/g)].map((m) => m[1]);
    expect(copied.sort()).toEqual(["activity", "avatars", "comments", "likes", "posts", "reports", "review_follows_added"]);
    const restore = sqlOnly(read(restorePath));
    for (const table of copied) expect(restore, `removed_20261108.${table}`).toMatch(new RegExp(`from removed_20261108\\.${table}\\b|using removed_20261108\\.${table}\\b`));
    // And it is never mistaken for a step.
    const said = header(restorePath, "-- VINTAGE · put back what was removed on 8 November 2026, only if ever wanted.\n");
    expect(said).toContain("NOT A STEP. Never run this in order after 13_remove_unsplash_house_photos.sql.");
    expect(said).toContain("It has not been run on production");
  });

  it("the restore holds off exactly the four triggers it names, before the first row goes back, and turns the same four on after the last", () => {
    const list = statements(read(restorePath));
    const toggles = list.map((s) => s.match(/^alter table public\.(\w+) (disable|enable) trigger (\w+)$/)).filter((m) => m);
    const named = (kind: string) => toggles.filter((m) => m![2] === kind).map((m) => `${m![1]}.${m![3]}`);
    expect(named("disable").sort()).toEqual([
      "activity.activity_push_trigger", "comments.comments_activity_trigger", "likes.likes_activity_trigger", "posts.posts_push_trigger",
    ]);
    expect(named("enable").sort()).toEqual(named("disable").sort());
    // No other switch: not ALL, not USER, not a fifth trigger by another spelling.
    expect(sqlOnly(read(restorePath)).match(/\b(?:disable|enable) trigger\b/gi)?.length).toBe(8);
    const writes = list.map((s, i) => (/^(insert|update|delete)\b/.test(s) ? i : -1)).filter((i) => i >= 0);
    expect(writes.length).toBeGreaterThan(0);
    const first = writes[0];
    const last = writes[writes.length - 1];
    for (const t of named("disable")) {
      const [table, trigger] = t.split(".");
      expect(list.indexOf(`alter table public.${table} disable trigger ${trigger}`), `${t} off before the first write`).toBeLessThan(first);
      expect(list.indexOf(`alter table public.${table} enable trigger ${trigger}`), `${t} on after the last write`).toBeGreaterThan(last);
      // Each is a trigger the migrations make on that table.
      const made = readdirSync(path.join(root, "supabase/migrations"))
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .some((f) => new RegExp(`create trigger ${trigger}\\s+after insert on public\\.${table}\\b`).test(read(`supabase/migrations/${f}`)));
      expect(made, `${trigger} on ${table} in supabase/migrations`).toBe(true);
    }
  });

  it("the checklist records what was removed, and step 4 never runs the 13_ files as verify scripts", () => {
    const { removed, left } = removeCounts();
    const avatars = seedHouse().accounts.filter((a) => isPicsum(a.avatar)).length;
    expect(avatars + PRODUCTION.keptAvatars, "every house account had a picture").toBe(seedHouse().accounts.length);
    const P = PRODUCTION;
    const done = flat(between(doc(), "**Done on 8 November**", "\n---\n"));
    expect(done).toContain(
      `on **production** the ${removed} Unsplash photographs are removed, with their ${commas(P.removedLikes)} likes (${P.removedMemberLikes} of them by members), ${commas(P.removedComments)} comments (none by members) and ${commas(P.removedActivity)} activity rows, and the ${avatars} house profile pictures that were Unsplash photographs are cleared (\`supabase/production/13_remove_unsplash_house_photos.sql\`, run in the SQL Editor)`,
    );
    expect(done).toContain(`also follows the ${P.reviewFollowsAdded} house accounts with photographs that it did not follow, so its Home shows all ${left}`);
    const decide = section7();
    expect(decide).toContain("you took the second, on 8 November");
    expect(decide).toContain("(`supabase/production/13_remove_unsplash_house_photos.sql`, run in the SQL Editor on 8 November");
    expect(decide).toContain(`The ${removed} Unsplash photographs are removed, and with them ${commas(P.removedLikes)} likes`);
    expect(decide).toContain(`The ${avatars} house profile pictures that were Unsplash photographs are cleared. The other ${P.keptAvatars} house profile pictures stay.`);
    expect(decide).toContain(`It follows ${12 + P.reviewFollowsAdded} accounts now, all of them house accounts, and its Home shows all ${left} house photographs (${P.before.reviewHome} before).`);
    expect(decide).toContain("`supabase/production/13_restore_unsplash_house_photos.sql` puts all of it back exactly");
    expect(decide).toContain("run `drop schema removed_20261108 cascade;` in the SQL Editor");
    // What is open: the house accounts left with no photographs, counted from the seed.
    const { posts, accounts } = seedHouse();
    const empty = accounts.length - new Set(posts.filter((p) => !isPicsum(p.media)).map((p) => p.author)).size;
    expect(decide).toContain(`**The ${empty} house accounts with no photographs.** ${empty} of the ${accounts.length} show no photographs now. They are kept, and can still be found and followed.`);
    // Step 4: verify scripts numbered 12 and up, but the 13_ files are not verify scripts; a fresh project runs 13_remove, never 13_restore.
    const step = flat(between(doc(), "### Step 4", "### Step 5"));
    expect(step).toContain("The two `13_` files there are not verify scripts: see item 6.");
    expect(step).toContain("run `supabase/production/13_remove_unsplash_house_photos.sql` (after `10_reviewer_account.sql` too)");
    expect(step).toContain("Never run `13_restore_unsplash_house_photos.sql` as a step: it only undoes 13_remove.");
  });

  it("the seed's own docs say production removed them, and that a fresh project runs 13_remove after 08", () => {
    const { removed, left } = removeCounts();
    const avatars = seedHouse().accounts.filter((a) => isPicsum(a.avatar)).length;
    const seedReadme = flat(read("seed/README.md"));
    expect(seedReadme).toContain(
      `On 8 November 2026 production removed the ${removed} Unsplash photographs and the ${avatars} Unsplash profile pictures with \`supabase/production/13_remove_unsplash_house_photos.sql\`, leaving the ${left} photographs from Wikimedia Commons`,
    );
    expect(seedReadme).toContain("A fresh project seeded with 08 must run `13_remove_unsplash_house_photos.sql` after it");
    const readme = flat(read("supabase/production/README.md"));
    // Its first lines say everything runs in order; the restore must be the named exception.
    expect(readme.slice(0, 600)).toContain("with one exception: `13_restore_unsplash_house_photos.sql` is not a step.");
    expect(readme).toContain(
      `on 8 November production removed the ${removed} Unsplash photographs and the ${avatars} Unsplash profile pictures with \`13_remove_unsplash_house_photos.sql\`, leaving ${left} house photographs, all from Wikimedia Commons. A fresh project seeded with 08 must run 13_remove after it`,
    );
    expect(readme).toContain("### The Unsplash house photographs, removed on 8 November");
    expect(readme).toContain("`13_restore_unsplash_house_photos.sql` puts all of it back exactly");
    expect(readme).toContain("drop schema removed_20261108 cascade;");
    expect(readme).toContain("3. To match production, run `supabase/production/13_remove_unsplash_house_photos.sql` whole, in the SQL Editor (which runs the file as one transaction), after 08");
  });
});
