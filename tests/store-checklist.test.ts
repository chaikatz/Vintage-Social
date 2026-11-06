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
