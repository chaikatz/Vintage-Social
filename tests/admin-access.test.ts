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
        const queries = src.match(/useQuery\(\{[\s\S]*?\n {2}\}\);/g) ?? [];
        expect(queries.length, "its reads").toBeGreaterThan(0);
        for (const q of queries) expect(q, q.split("\n")[1]).toMatch(/\n {4}enabled: isAdmin,\n/);
      });

      it("sends them home once it knows, and only then", () => {
        expect(src).toContain('if (profileLoaded && !isAdmin) return <Redirect href="/(tabs)" />;');
      });

      it("calls every hook before that", () => {
        expect(hooksAfterFirstReturn(src)).toEqual([]);
      });
    });
  }
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
