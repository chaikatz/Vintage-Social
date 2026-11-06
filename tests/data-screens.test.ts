import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { errorMessage } from "@/utils/errorMessage";

/**
 * Report, Send to and the follow lists: a bad row there breaks only that
 * screen, with the way back on its page; their alerts say what did not
 * happen in the screen's own words, never what was thrown as it came; and
 * a photograph whose member is kept back names nobody without throwing.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const SCREENS = ["app/report.tsx", "app/share.tsx", "app/follows.tsx"];

describe("Report, Send to and the follow lists", () => {
  it("each has a recover page of its own, with the way back on it", () => {
    // Two are sheets, which have no back button; a list opened from a
    // link is the first in its stack. Without one, a bad row there took
    // the member out to the whole app's recover page.
    for (const file of SCREENS) {
      expect(code(file), file).toMatch(/^export \{ RecoverPageWithBack as ErrorBoundary \} from "@\/navigation\/Recover";$/m);
    }
  });

  it("never print what was thrown as it came", () => {
    for (const file of SCREENS) {
      const src = code(file);
      expect(src, file).not.toMatch(/instanceof Error \? \w+\.message : String\(/);
      expect(src, file).not.toMatch(/showAlert\([^;]*String\((err|e|error)\)/);
      expect(src, file).not.toMatch(/showAlert\([^;]*\b(err|e|error)\.message\b/);
    }
    expect(code("app/report.tsx")).toMatch(
      /showAlert\("Couldn’t send report", errorMessage\(err, "Your report isn’t sent yet\. Try again in a moment\."\)\);/,
    );
    // A refusal from the database reads as the screen's words, not its own.
    const refused = { code: "42501", message: 'new row violates row-level security policy for table "reports"', details: null, hint: null };
    expect(errorMessage(refused, "Your report isn’t sent yet. Try again in a moment.")).toBe("Your report isn’t sent yet. Try again in a moment.");
  });

  it("Send to names nobody, rather than throwing, for a photograph whose member is kept back", () => {
    const share = code("app/share.tsx");
    expect(share).toMatch(/\{post\?\.author\?\.username \?\? ""\}/);
    expect(share).not.toMatch(/post\??\.author\.username/);
  });
});
