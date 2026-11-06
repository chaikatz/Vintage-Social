import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { removalTarget, sameTarget } from "@/components/reportTargets";

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
    expect(actions).toMatch(/: item\.comment_id \? \(\s*<Button\s+title="Remove comment"[\s\S]*?onPress=\{\(\) => remove\(item, "removeComment"\)\}/);
    expect(src).toMatch(
      /if \(action === "removeComment" && report\.comment_id\) await removeComment\(report\.comment_id, note\);\s*removed\.current\.add\(target\);\s*\}\s*await resolveReport\(report\.id, "resolved", "Content removed"\);/,
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
    expect(src).toMatch(
      /onMutate: async \(\{ report, also \}\) => \{\s*const ids = \[report\.id, \.\.\.also\.map\(\(r\) => r\.id\)\];\s*setDeciding\(\(d\) => withIds\(d, ids\)\);\s*await queryClient\.cancelQueries\(\{ queryKey: openKey \}\);[\s\S]*?setQueryData<ReportWithRefs\[\]>\(openKey, \(rows\) => ids\.reduce\(\(list, id\) => withoutRow\(list, id\), rows\)\);/,
    );
    expect(src).toMatch(
      /onError: \(err, \{ report, also \}, ctx\) => \{\s*queryClient\.setQueryData<ReportWithRefs\[\]>\(openKey, \(rows\) =>\s*\[report, \.\.\.also\]\.reduce\(\(list, r\) => withRowBack\(list, r, ctx\?\.order\), rows\),\s*\);\s*showAlert\(/,
    );
    // Every button goes through it: two removals by way of `remove`, and Dismiss.
    expect(actions.match(/onPress=\{\(\) => remove\(item, "remove(Post|Comment)"\)\}/g)).toHaveLength(2);
    expect(actions.match(/act\.mutate\(/g)).toHaveLength(1);
    expect(src).toMatch(/const remove = \(report: ReportWithRefs, action: "removePost" \| "removeComment"\) =>\s*act\.mutate\(\{ report, action, also: sameTarget\(shown, report\) \}\);/);
  });

  it("keeps reports off the list while their action is on its way, whatever a read brings back", () => {
    expect(src).toMatch(
      /onSuccess: async \(_done, \{ report, also \}\) => \{\s*const ids = \[report\.id, \.\.\.also\.map\(\(r\) => r\.id\)\];\s*await queryClient\.cancelQueries\(\{ queryKey: openKey \}\);\s*queryClient\.setQueryData<ReportWithRefs\[\]>\(openKey, \(rows\) => ids\.reduce\(\(list, id\) => withoutRow\(list, id\), rows\)\);/,
    );
    expect(src).toMatch(/onSettled: \(_done, _err, \{ report, also \}\) => \{\s*setDeciding\(\(d\) => withoutIds\(d, \[report\.id, \.\.\.also\.map\(\(r\) => r\.id\)\]\)\);\s*return refresh\(\);/);
    expect(src).toMatch(/const shown = undecided\(reports\.data, deciding\);/);
    expect(src).toMatch(/data=\{shown\}/);
  });

  it("dismisses without removing anything", () => {
    const dismiss = src.slice(src.indexOf('if (action === "dismiss")'), src.indexOf("return;", src.indexOf('if (action === "dismiss")')));
    expect(dismiss).toMatch(/resolveReport\(report\.id, "dismissed", "No action needed"\)/);
    expect(dismiss).not.toMatch(/remove(Post|Comment)/);
  });
});

describe("several reports on the same photograph or comment", () => {
  const post = (id: string, postId: string) => ({ id, post_id: postId, comment_id: null });
  const comment = (id: string, commentId: string) => ({ id, post_id: null, comment_id: commentId });
  const member = (id: string) => ({ id, post_id: null, comment_id: null });

  it("are told apart by what a removal would act on", () => {
    expect(removalTarget(post("r1", "p1"))).toBe("post:p1");
    expect(removalTarget(comment("r2", "c1"))).toBe("comment:c1");
    expect(removalTarget(member("r3"))).toBeNull();
    // A photograph and a comment that happen to share an id are not the same thing.
    expect(removalTarget(post("r4", "x"))).not.toBe(removalTarget(comment("r5", "x")));
  });

  it("are found together, without the report acted on and without reports about other things", () => {
    const rows = [post("r1", "p1"), post("r2", "p1"), post("r3", "p2"), comment("r4", "c1"), comment("r5", "c1"), member("r6"), member("r7")];
    expect(sameTarget(rows, rows[0]).map((r) => r.id)).toEqual(["r2"]);
    expect(sameTarget(rows, rows[2])).toEqual([]);
    expect(sameTarget(rows, rows[4]).map((r) => r.id)).toEqual(["r4"]);
    // Reports about members are not closed together: each is read on its own.
    expect(sameTarget(rows, rows[5])).toEqual([]);
    expect(sameTarget(undefined, rows[0])).toEqual([]);
  });

  it("are closed together by one removal, which is never sent twice from the queue", () => {
    const fn = src.slice(src.indexOf("mutationFn: async"), src.indexOf("onMutate:"));
    // The content is removed only if this screen has not removed it already…
    expect(fn).toMatch(/const target = removalTarget\(report\);\s*if \(target && !removed\.current\.has\(target\)\) \{/);
    // …and remembered once it has been, before its report is closed.
    expect(fn.indexOf("removed.current.add(target);")).toBeGreaterThan(fn.indexOf("await removeComment(report.comment_id, note);"));
    expect(fn.indexOf("removed.current.add(target);")).toBeLessThan(fn.indexOf('await resolveReport(report.id, "resolved", "Content removed");'));
    // The others on the same thing are closed with it, and one that fails to close does not undo the rest.
    expect(fn).toMatch(/await Promise\.allSettled\(also\.map\(\(r\) => resolveReport\(r\.id, "resolved", "Content removed"\)\)\);/);
    // Dismiss closes only its own report.
    expect(actions).toMatch(/act\.mutate\(\{ report: item, action: "dismiss", also: \[\] \}\)/);
  });
});

describe("the applications queue", () => {
  const apps = code("app/admin/applications.tsx");

  it("puts back the refused card alone, not the whole list as it was before the tap", () => {
    expect(apps).not.toMatch(/ctx\.before|const before =/);
    expect(apps).toMatch(
      /onMutate: async \(\{ app \}\) => \{\s*setDeciding\(\(ids\) => withIds\(ids, \[app\.id\]\)\);\s*const key = \["admin-apps", tab\];\s*await queryClient\.cancelQueries\(\{ queryKey: key \}\);\s*const order = [^;]+;\s*queryClient\.setQueryData<ApplicationRow\[\]>\(key, \(rows\) => withoutRow\(rows, app\.id\)\);\s*return \{ key, order \};/,
    );
    expect(apps).toMatch(/onError: \(err, \{ app \}, ctx\) => \{\s*if \(ctx\) queryClient\.setQueryData<ApplicationRow\[\]>\(ctx\.key, \(rows\) => withRowBack\(rows, app, ctx\.order\)\);/);
  });

  it("keeps a card off the list while its decision is on its way, whatever a read brings back", () => {
    expect(apps).toMatch(
      /onSuccess: async \(_done, \{ app \}, ctx\) => \{\s*await queryClient\.cancelQueries\(\{ queryKey: ctx\.key \}\);\s*queryClient\.setQueryData<ApplicationRow\[\]>\(ctx\.key, \(rows\) => withoutRow\(rows, app\.id\)\);/,
    );
    expect(apps).toMatch(/onSettled: \(_done, _err, \{ app \}\) => \{\s*setDeciding\(\(ids\) => withoutIds\(ids, \[app\.id\]\)\);\s*return queryClient\.invalidateQueries/);
    expect(apps).toMatch(/data=\{undecided\(apps\.data, deciding\)\}/);
    expect(apps.match(/decide\.mutate\(\{ app: item, decision: "(approved|waitlisted|rejected)" \}\)/g)).toHaveLength(3);
  });
});

describe("a queue that could not be read", () => {
  it("says so in reports and applications, rather than calling it empty", () => {
    expect(src).toMatch(/reports\.isError \? \(\s*<LoadFailed what="the reports" onRetry=\{\(\) => reports\.refetch\(\)\} \/>/);
    expect(code("app/admin/applications.tsx")).toMatch(/apps\.isError \? \(\s*<LoadFailed what="the applications" onRetry=\{\(\) => apps\.refetch\(\)\} \/>/);
  });

  it("says so in members, where a failed read used to say 'No members found'", () => {
    const members = code("app/admin/members.tsx");
    expect(members).toMatch(
      /ListEmptyComponent=\{\s*members\.isError \? \(\s*<LoadFailed what="the members" onRetry=\{\(\) => members\.refetch\(\)\} \/>\s*\) : members\.isFetched \? \(\s*<EmptyState title="No members found" \/>/,
    );
  });
});
