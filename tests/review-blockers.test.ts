import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The two review blockers at the door, read from the source (nothing here
 * can render a screen).
 *
 * A (Guideline 5.1.1(v)): an account the app made can be deleted in the
 * app. An applicant who is waiting or was not accepted, and a suspended
 * member, see only the waiting screen; Settings is out of their reach.
 *
 * B (Guideline 1.2): the invitation, which makes an account as the
 * application does, says what is agreed to before it is made.
 */

const root = path.resolve(import.meta.dirname, "..");
/** The file without its comments, so a sentence in a comment proves nothing. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The hooks the default-exported screen calls after its first early
 * return. A hook below an early return is called on some renders and not
 * others, and React throws ("Rendered fewer hooks than expected"): that was
 * "Sign out crashes the waitlist screen". Read from the component's own
 * statements, which the formatter indents by two spaces.
 */
export function hooksAfterFirstReturn(src: string): string[] {
  const start = src.indexOf("export default function");
  expect(start, "a default-exported screen").toBeGreaterThanOrEqual(0);
  const lines = src.slice(start).split("\n");
  const end = lines.findIndex((l, i) => i > 0 && l === "}");
  const body = lines.slice(1, end < 0 ? undefined : end).filter((l) => /^ {2}\S/.test(l));
  const first = body.findIndex((l) => /^ {2}(if \(.*\) )?return\b/.test(l));
  expect(first, "an early return to look behind").toBeGreaterThanOrEqual(0);
  return body.slice(first + 1).filter((l) => /\b(React\.)?use[A-Z]\w*\(/.test(l));
}

describe("A · the waiting screen deletes the account", () => {
  const src = code("app/(gate)/pending.tsx");

  it("has a quiet Delete my account under Sign out", () => {
    expect(src).toMatch(
      /<GateButton title="Sign out" variant="quiet"[^>]*\/>\s*<GateButton title="Delete my account" variant="quiet" onPress=\{confirmDelete\} loading=\{deleting\}/,
    );
    // Outside every condition: waiting, not accepted, suspended, no application.
    const actions = src.slice(src.indexOf("<View style={styles.actions}>"));
    expect(actions.slice(actions.lastIndexOf(": null}"), actions.indexOf('title="Delete my account"'))).not.toMatch(/\?\s*\(/);
  });

  it("asks the same two questions as Settings, and Cancel or Keep my account leaves it as it was", () => {
    const settings = code("app/settings.tsx");
    for (const words of ['"Delete your account?"', 'text: "Delete account"', '"Are you sure?"', '"This is the last step. Everything is deleted now."', 'text: "Yes, delete everything"', 'text: "Keep my account", style: "cancel"', 'text: "Cancel", style: "cancel"']) {
      expect(settings, words).toContain(words);
      expect(src, words).toContain(words);
    }
    // The second question is asked from the first's destructive answer, and the deletion from the second's.
    expect(src).toMatch(
      /text: "Delete account",\s*style: "destructive",\s*onPress: \(\) =>\s*showAlert\("Are you sure\?"[^[]*\[\s*\{\s*text: "Yes, delete everything",\s*style: "destructive",\s*onPress: async \(\) => \{/,
    );
  });

  it("deletes, forgets what the phone held, then leaves through Sign out", () => {
    expect(src).toMatch(/await deleteMyAccount\(userId\);\s*queryClient\.clear\(\);\s*await signOut\(\);/);
    expect(src).toContain('import { deleteMyAccount } from "@/api/account";');
  });

  it("says honestly what a failure may have left, and that trying again finishes it", () => {
    const failure = src.slice(src.indexOf("await signOut();"), src.indexOf('{ text: "Keep my account"'));
    expect(failure).toMatch(/catch \(err\) \{\s*setDeleting\(false\);/);
    expect(failure).toContain('"Couldn’t delete the account"');
    expect(failure).toMatch(/errorMessage\(\s*err,/);
    expect(failure).toContain("may already have been removed");
    expect(failure).toContain("Try again to finish deleting it.");
    // Never the database's words, never "[object Object]".
    expect(failure).not.toMatch(/err\.message|String\(err\)/);
  });

  it("calls every hook before its redirect", () => {
    expect(src).toMatch(/const \[deleting, setDeleting\] = React\.useState\(false\);[\s\S]*if \(session === null\) return <Redirect/);
    expect(hooksAfterFirstReturn(src)).toEqual([]);
  });
});

describe("B · the invitation says what is agreed to", () => {
  const src = code("app/(gate)/invite.tsx");
  const apply = code("app/(gate)/apply.tsx");

  it("under Accept the invitation, with both documents a tap away, as the application does", () => {
    const after = src.slice(src.indexOf('<GateButton title="Accept the invitation"'));
    expect(after).toMatch(
      /^<GateButton title="Accept the invitation"[^>]*\/>\s*<Text style=\{styles\.agree\}>\s*By accepting you agree to the\{" "\}\s*<Text style=\{styles\.agreeLink\} onPress=\{\(\) => router\.push\("\/legal\/terms"\)\}[^>]*>\s*Terms of Use\s*<\/Text>\{" "\}\s*and\{" "\}\s*<Text style=\{styles\.agreeLink\} onPress=\{\(\) => router\.push\("\/legal\/privacy"\)\}[^>]*>\s*Privacy Policy\s*<\/Text>/,
    );
    expect(apply).toContain("By applying you agree to the");
    expect(apply).toContain('router.push("/legal/terms")');
  });

  it("in the application's own type", () => {
    const style = (s: string, name: string) => s.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0].replace(/\s+/g, " ").replace(`${name}:`, "") ?? "";
    expect(style(src, "agree")).toBe(style(apply, "footnote"));
    expect(style(src, "agreeLink")).toBe(style(apply, "footLink"));
    expect(style(src, "agree")).not.toBe("");
  });
});

describe("every screen at the door calls its hooks before any early return", () => {
  for (const file of ["app/(gate)/pending.tsx", "app/admin/index.tsx"]) {
    it(file, () => expect(hooksAfterFirstReturn(code(file))).toEqual([]));
  }

  it("and the reader finds a hook placed after one", () => {
    const broken = 'export default function X() {\n  const a = useA();\n  if (!a) return null;\n  const b = React.useState(0);\n  return <View />;\n}\n';
    expect(hooksAfterFirstReturn(broken)).toEqual(["  const b = React.useState(0);"]);
  });
});
