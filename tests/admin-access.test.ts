import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { code, hooksAfterFirstReturn, root } from "./helpers/screenSource";

/**
 * The admin pages are for admins, however they are opened.
 *
 * Only the dashboard used to send a member who is not an admin away. The
 * three pages under it rendered for anyone who opened them by a link
 * (vintage://admin/members), with Approve, Suspend and Remove buttons whose
 * calls the database then refused (App Review Guideline 2.1). Each page
 * now reads nothing for them and sends them home, after all its hooks.
 */

const pages = readdirSync(path.join(root, "app/admin"))
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => `app/admin/${f}`);

describe("every admin page", () => {
  it("is found (the dashboard and the three under it)", () => {
    expect(pages.sort()).toEqual(["app/admin/applications.tsx", "app/admin/index.tsx", "app/admin/members.tsx", "app/admin/reports.tsx"]);
  });

  for (const file of pages) {
    describe(file, () => {
      const src = code(file);

      it("asks who is looking", () => {
        expect(src).toMatch(/const \{ isAdmin, profileLoaded \} = useSession\(\);/);
      });

      it("reads nothing for someone who is not an admin", () => {
        const queries = src.match(/use(?:Infinite)?Query\(\{[\s\S]*?\n {2}\}\);/g) ?? [];
        expect(queries.length, "its reads").toBeGreaterThan(0);
        for (const q of queries) expect(q, q.split("\n")[1]).toMatch(/\n {4}enabled: isAdmin,\n/);
      });

      it("sends them home once it knows, and only then", () => {
        expect(src).toContain('if (profileLoaded && !isAdmin) return <Redirect href="/(tabs)" />;');
      });

      it("calls every hook before that", () => {
        expect(hooksAfterFirstReturn(src)).toEqual([]);
      });

      it("breaks alone if a row breaks it, with the way back on the page (opened from a notification, it has no back button)", () => {
        expect(src).toMatch(/^export \{ RecoverPageWithBack as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
      });
    });
  }
});

/**
 * What an admin, or someone at the door, is told when something did not
 * happen: a sentence our own SQL raised for them, or the screen's own
 * words for it (errorMessage). It used to be the error's text as it came:
 * the database talking, or "[object Object]" for a refusal from Supabase,
 * which is a plain object. Every admin page, and every page at the door.
 */
describe("an alert about something that did not happen", () => {
  const files = [
    "app/admin/index.tsx",
    "app/admin/applications.tsx",
    "app/admin/members.tsx",
    "app/admin/reports.tsx",
    "app/(gate)/pending.tsx",
    "app/(gate)/sign-in.tsx",
    "app/(gate)/apply.tsx",
    "app/(gate)/invite.tsx",
  ];

  it("is checked on every admin page and every page at the door that catches an error", () => {
    const door = readdirSync(path.join(root, "app/(gate)"))
      .filter((f) => f.endsWith(".tsx"))
      .map((f) => `app/(gate)/${f}`)
      .filter((f) => /catch \(err\)|onError: \(err/.test(code(f)));
    for (const file of [...pages, ...door]) expect(files, file).toContain(file);
  });

  for (const file of files) {
    it(`${file} says it in the app's words`, () => {
      const src = code(file);
      expect(src).not.toMatch(/err instanceof Error \? err\.message : String\(err\)|String\(err\)|\berr\.message\b/);
      // Every alert that carries a caught error carries it through errorMessage.
      const carried = src.match(/showAlert\([^;]*?\berr\b[^;]*?\);/g) ?? [];
      expect(carried.length, "its alerts about a caught error").toBeGreaterThan(0);
      for (const alert of carried) expect(alert).toMatch(/errorMessage\(\s*err,\s*"[^"]+"/);
      expect(src).toContain('import { errorMessage } from "@/utils/errorMessage";');
    });
  }

  it("Members names what did not happen: the warning, the suspension or reinstatement, the invitations", () => {
    const src = code("app/admin/members.tsx");
    expect(src).toContain('showAlert("Couldn’t send the warning", errorMessage(err, "The member hasn’t been warned. Try again in a moment."))');
    expect(src).toMatch(/onError: \(err, \{ suspended \}\) =>\s*showAlert\(suspended \? "Couldn’t suspend" : "Couldn’t reinstate", errorMessage\(err, "Nothing changed\. Try again in a moment\."\)\)/);
    expect(src).toContain('showAlert("Couldn’t change the invitations", errorMessage(err, "Nothing changed. Try again in a moment."))');
    expect(src).not.toMatch(/showAlert\("Failed"/);
  });

  it("the dashboard names what did not happen, and never counts a queue it could not read as empty", () => {
    const src = code("app/admin/index.tsx");
    expect(src).toContain('showAlert("Couldn’t change the invitations", errorMessage(err, "Nothing changed. Try again in a moment."))');
    expect(src).not.toMatch(/showAlert\("Failed"/);
    // "0 open" was said of a count that failed, and of one still being read.
    expect(src).not.toMatch(/\.data \?\? 0\}/);
    expect(src).toContain('sub: countLine(pendingApps, (n) => `${n} waiting for review`),');
    expect(src).toContain('sub: countLine(openReports, (n) => `${n} open`),');
    expect(src).toMatch(
      /function countLine\([\s\S]*?\): string \{\s*if \(count\.data != null\) return say\(count\.data\);\s*return count\.isError \? "Couldn’t count them just now" : "\\u00a0";\s*\}/,
    );
  });

  it("a list that could not be read says so, with Try again, on every admin page that has one", () => {
    expect(code("app/admin/applications.tsx")).toMatch(/apps\.isError && !apps\.data \? \(\s*<LoadFailed what="the applications" onRetry=\{\(\) => apps\.refetch\(\)\} \/>/);
    expect(code("app/admin/members.tsx")).toMatch(/members\.isError \? \(\s*<LoadFailed what="the members" onRetry=\{\(\) => members\.refetch\(\)\} \/>/);
    expect(code("app/admin/reports.tsx")).toMatch(/reports\.isError && !reports\.data \? \(\s*<LoadFailed what="the reports" onRetry=\{\(\) => reports\.refetch\(\)\} \/>/);
  });
});

describe("the hook-order reader", () => {
  it("finds a hook placed after an early return", () => {
    const broken = 'export default function X() {\n  const a = useA();\n  if (!a) return null;\n  const b = React.useState(0);\n  return <View />;\n}\n';
    expect(hooksAfterFirstReturn(broken)).toEqual(["  const b = React.useState(0);"]);
  });

  it("refuses a screen with no early return to look behind, rather than passing it", () => {
    expect(() => hooksAfterFirstReturn("export default function X() {\n  const a = useA();\n}\n")).toThrow();
  });
});
