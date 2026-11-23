import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { errorMessage } from "@/utils/errorMessage";

/**
 * 0041 and the app's half of it: a member's number is shown only if they
 * choose. What it does to the database is proven on PostgreSQL by npm run
 * test:rls (supabase/tests/20_member_number_0041.sql, and verify script
 * 12, row 69). These hold the migration to its promises, and the app to
 * the rule: the word MEMBER always, the number only where the member
 * turned it on, and a database without the column read as hidden.
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const sqlCode = (sql: string) => sql.replace(/--[^\n]*/g, "");
/** The source without its comments, so prose is not taken for code. */
const code = (file: string) =>
  read(file)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
const FILE = "supabase/migrations/0041_member_number_shown_by_choice.sql";
const migration = () => sqlCode(read(FILE));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(path.join(root, dir))) {
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("0041, as a file", () => {
  it("adds the column once, false for everyone and never null", () => {
    expect(migration()).toMatch(
      /alter table public\.profiles\s+add column if not exists show_member_no boolean not null default false;/,
    );
  });

  it("lets members change it and nothing more: one column, no visitor, no policy", () => {
    const s = migration();
    expect(s.match(/\bgrant\b[^;]*;/g)).toEqual(["grant update (show_member_no) on public.profiles to authenticated;"]);
    expect(s).not.toMatch(/\banon\b/);
    expect(s).not.toMatch(/\bservice_role\b/);
    expect(s).not.toMatch(/\b(create|drop|alter) policy\b/i);
    expect(s).not.toMatch(/\brevoke\b/i);
    // The number, and the function that keeps it, are untouched.
    expect(s).not.toMatch(/\bmember_no\b/);
    expect(s).not.toMatch(/own_profile_unchanged/);
  });

  it("waits five seconds at most for a lock, opens no transaction, changes no member's row, and says how to undo it", () => {
    const s = migration();
    expect(s.split(";").map((st) => st.trim()).find(Boolean)).toBe("set local lock_timeout = '5s'");
    expect(s).not.toMatch(/^\s*(begin|commit)\s*;/im);
    expect(s).not.toMatch(/\b(insert into|delete from|truncate)\b/i);
    expect(s).not.toMatch(/\bupdate public\.\w+\s+set\b/i);
    const header = read(FILE);
    expect(header).toMatch(/^-- Rollback \(members' choices are lost with the column\):\n--   revoke update \(show_member_no\) on public\.profiles from authenticated;\n--   alter table public\.profiles drop column if exists show_member_no;/m);
    // 0039 run again takes the column back: the header says to run this after it.
    expect(header).toMatch(/run this file again after it\./);
  });

  it("is proven by the policy harness, after 0040's test, and checked by verify script 12, row 69", () => {
    const runner = read("supabase/tests/run.mjs");
    expect(runner).toMatch(/"19_blocks_messages_files_0040\.sql",\s+"20_member_number_0041\.sql",\s+\]\) \{/);
    expect(runner).toMatch(/rows\.length !== 69/);
    const test = read("supabase/tests/20_member_number_0041.sql");
    expect(test).toMatch(/\\ir \.\.\/migrations\/0041_member_number_shown_by_choice\.sql/);
    // 0039 again, then 0041 again: the order the header names.
    const again = test.indexOf("\\ir ../migrations/0039_writes_only_what_the_app_writes.sql");
    expect(again).toBeGreaterThan(0);
    expect(test.lastIndexOf("\\ir ../migrations/0041_member_number_shown_by_choice.sql")).toBeGreaterThan(again);
    expect(test.trim().endsWith("rollback;")).toBe(true);
    // 0039's own test applies 0041 after each 0039 it applies again, and lists the column.
    const writes = read("supabase/tests/18_writes_0039.sql");
    const twice = [...writes.matchAll(/\\ir \.\.\/migrations\/0039_writes_only_what_the_app_writes\.sql\n\\ir \.\.\/migrations\/0041_member_number_shown_by_choice\.sql/g)];
    expect(twice).toHaveLength(2);
    expect(writes).toContain("profiles UPDATE avatar_url,bio,city,full_name,is_private,show_member_no; ");
    const verify = sqlCode(read("supabase/production/12_policies_read_once_verify.sql"));
    expect(verify).toMatch(/select 69, '0041:/);
    expect(verify).toMatch(/'boolean not null default false, changed by authenticated'\n\)/);
    // Row 50 is 0039's columns; the one 0041 adds is row 69's.
    expect(verify).toMatch(/and a\.attname <> 'show_member_no'/);
    expect(read("supabase/production/12_policies_read_once_verify.sql").split("\n")[0]).toMatch(/verify 0023-0041 /);
  });
});

describe("the number on a profile and a print", () => {
  it("the profile says MEMBER, and the number only where the member chose to show it", () => {
    const header = code("src/components/ProfileHeader.tsx");
    expect(header).toMatch(/const membership = membershipLine\(profile\.member_no, showsMemberNumber\(profile\)\);/);
    expect(header).toMatch(/\{membership \? <Text style=\{styles\.membership\}>\{membership\}<\/Text> : null\}/);
  });

  it("the print's label and its film follow the author's choice, read with their profile", () => {
    const screen = code("app/export.tsx");
    expect(screen).toMatch(/const showMemberNo = showsMemberNumber\(authorQ\.data\);/);
    expect(screen).toMatch(/brandVideo\(post, url, format, paper, memberNo, showMemberNo, setStage\)/);
    expect((screen.match(/memberNo=\{memberNo\}\s+showMemberNo=\{showMemberNo\}/g) ?? []).length).toBe(2);
    expect(code("src/components/ExportCard.tsx")).toMatch(/exportLabelText\(post, memberNo, showMemberNo\)/);
    expect(code("src/utils/exportPost.ts")).toMatch(/exportLabelText\(post, memberNo, showMemberNo\)/);
  });

  it("is drawn for others only there; the admins' Members list keeps every number", () => {
    // Every file of the app that reads a member's number, and why.
    const allowed = new Set([
      "src/types/db.ts",
      "src/utils/membership.ts",
      "src/components/ProfileHeader.tsx",
      "app/export.tsx",
      "app/settings.tsx",
      "app/admin/members.tsx",
      "src/demo/store.ts",
      "src/demo/fixtures.ts",
    ]);
    const readers = [...sourceFiles("app"), ...sourceFiles("src")].filter((f) => /\bmember_no\b/.test(code(f)));
    for (const f of readers) expect(allowed.has(f), `${f} reads member_no: draw it through membershipLine or memberCredit, which ask the member's choice`).toBe(true);
    expect(code("app/admin/members.tsx")).toMatch(/if \(member\.member_no !== null\) parts\.push\(formatMemberNumber\(member\.member_no\)\);/);
  });

  it("never names the column in a read, so a read from a database without it still answers", () => {
    for (const f of [...sourceFiles("app"), ...sourceFiles("src")]) {
      const src = code(f);
      for (const m of src.matchAll(/\.select\(\s*(["`])([\s\S]*?)\1/g)) {
        expect(m[2], f).not.toMatch(/show_member_no/);
      }
    }
    // The profile reads are select("*"): whatever the database has, and nothing it lacks.
    const profiles = code("src/api/profiles.ts");
    expect(profiles).toMatch(/\.from\("profiles"\)\.select\("\*"\)\.eq\("id", id\)\.maybeSingle\(\);/);
    expect(code("src/providers/SessionProvider.tsx")).toMatch(/\.from\("profiles"\)\.select\("\*"\)\.eq\("id", who\)\.maybeSingle\(\);/);
  });
});

describe("the switch in Settings", () => {
  const settings = code("app/settings.tsx");

  it("is written as it is flipped, one write at a time, and goes back if refused", () => {
    expect(settings).toMatch(/onValueChange=\{toggleNumber\}/);
    expect(settings).toMatch(/setShowNumber\(on\);\s*numberWriter\.set\(on\);/);
    expect(settings).toMatch(/await updateOwnProfile\(userIdRef\.current, \{ show_member_no: on \}\);\s*savedShowNumber\.current = on;/);
    expect(settings).toMatch(/onFailed: \(err\) => \{\s*setShowNumber\(savedShowNumber\.current\);\s*showAlert\("Couldn’t change that", errorMessage\(err, "[^"]+"\)\);/);
    // Off unless the member's own profile says otherwise; a profile without the column is off.
    expect(settings).toMatch(/const \[showNumber, setShowNumber\] = useState\(\(\) => showsMemberNumber\(profile\)\);/);
    expect(settings).toMatch(/const savedShowNumber = useRef\(showsMemberNumber\(profile\)\);/);
  });

  it("is named for VoiceOver and says what it does, and Save never sends it", () => {
    const sw = settings.slice(settings.indexOf("Show my member number"));
    expect(sw).toMatch(/accessibilityLabel="Show my member number"/);
    expect(settings).toContain("Your profile always says Member. Turn this on to show your number, ${memberNumberText(memberNo)}, beside it and on the prints you share.");
    const save = settings.slice(settings.indexOf("const save = async"), settings.indexOf("const openDoc"));
    expect(save).not.toMatch(/show_member_no/);
  });

  it("says the app's calm words, not the database's, when the database has no such column yet", () => {
    // What PostgREST answers a write to a column it does not know (a database before 0041).
    const missing = "Could not find the 'show_member_no' column of 'profiles' in the schema cache";
    const fallback = "Your number is shown as it was. Try again in a moment.";
    const asError = Object.assign(new Error(missing), { name: "PostgrestError", code: "PGRST204", details: null, hint: null });
    expect(errorMessage(asError, fallback)).toBe(fallback);
    expect(errorMessage({ code: "PGRST204", message: missing, details: null, hint: null }, fallback)).toBe(fallback);
    // And where 0039 was run again after it: the column is there, the grant is not.
    expect(errorMessage({ code: "42501", message: "permission denied for table profiles", details: null, hint: null }, fallback)).toBe(fallback);
    expect(settings).toContain(`errorMessage(err, "${fallback}")`);
  });

  it("is offered to a member with a number", () => {
    expect(settings).toMatch(/\{typeof memberNo === "number" && memberNo > 0 \? \(\s*<View style=\{\[styles\.settingRow, styles\.settingNext\]\}>/);
  });
});
