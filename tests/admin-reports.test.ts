import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The admins' reports queue: every kind of report can be acted on, each
 * report is acted on once, and a refusal is said. Read from the source.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const src = code("app/admin/reports.tsx");
const actions = src.slice(src.indexOf('{tab === "open" ? ('), src.indexOf("</View>\n            ) : null}"));

describe("a reported comment", () => {
  it("can be removed from the queue, which removes the comment and then resolves the report", () => {
    expect(actions).toMatch(/: item\.comment_id \? \(\s*<Button\s+title="Remove comment"[\s\S]*?act\.mutate\(\{ report: item, action: "removeComment" \}\)/);
    expect(src).toMatch(
      /if \(action === "removeComment" && report\.comment_id\) await removeComment\(report\.comment_id, note\);\s*await resolveReport\(report\.id, "resolved", "Content removed"\);/,
    );
  });
});

describe("a reported member", () => {
  it("can be opened from the queue, found by id", () => {
    expect(actions).toMatch(/: item\.profile_id \? \(\s*<Button title="View member"[^>]*onPress=\{\(\) => openMember\(item\)\}/);
    expect(src).toMatch(/const member = await fetchProfileById\(report\.profile_id\);\s*if \(member\) router\.push\(`\/user\/\$\{member\.username\}`\);/);
  });
});

describe("every action", () => {
  it("goes through the one mutation, which takes the report off the open list at once and puts it back if refused", () => {
    expect(src).not.toMatch(/const resolve = useMutation|removeReportedPost/);
    expect(src).toMatch(/setQueryData<ReportWithRefs\[\]>\(openKey, \(rows\) => withoutRow\(rows, report\.id\)\)/);
    expect(src).toMatch(/onError: \(err, \{ report \}, ctx\) => \{\s*queryClient\.setQueryData<ReportWithRefs\[\]>\(openKey, \(rows\) => withRowBack\(rows, report, ctx\?\.order\)\);\s*showAlert\(/);
    expect(actions.match(/act\.mutate\(/g)).toHaveLength(3);
  });

  it("dismisses without removing anything", () => {
    const dismiss = src.slice(src.indexOf('if (action === "dismiss")'), src.indexOf("return;", src.indexOf('if (action === "dismiss")')));
    expect(dismiss).toMatch(/resolveReport\(report\.id, "dismissed", "No action needed"\)/);
    expect(dismiss).not.toMatch(/remove(Post|Comment)/);
  });
});

describe("a queue that could not be read", () => {
  it("says so in reports and applications, rather than calling it empty", () => {
    expect(src).toMatch(/reports\.isError \? \(\s*<LoadFailed what="the reports" onRetry=\{\(\) => reports\.refetch\(\)\} \/>/);
    expect(code("app/admin/applications.tsx")).toMatch(/apps\.isError \? \(\s*<LoadFailed what="the applications" onRetry=\{\(\) => apps\.refetch\(\)\} \/>/);
  });
});
