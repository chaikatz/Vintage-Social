import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Buttons that send something to other people are guarded in the tap
 * itself. A Pressable only goes quiet once React has rendered, so two
 * quick taps both got through: a photograph sent twice to everyone ticked,
 * two share sheets, a report filed twice. Read from the source: these are
 * screens, and the guard is a few lines in each.
 */

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The body of `const name = async (...) => { ... };` as written. */
function fn(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = async`);
  expect(start).toBeGreaterThan(-1);
  const end = src.indexOf("\n  };", start);
  return src.slice(start, end);
}

describe("Send to (a photograph to members)", () => {
  const share = code("app/share.tsx");
  const send = fn(share, "send");

  it("refuses a second tap while the first is sending, before anything awaits", () => {
    expect(send).toMatch(/if \(!postId \|\| selected\.length === 0 \|\| sending\.current\) return;\s*sending\.current = true;/);
    const firstAwait = send.indexOf("await ");
    expect(send.indexOf("sending.current = true")).toBeLessThan(firstAwait);
    expect(send).toMatch(/finally \{\s*sending\.current = false;/);
  });

  it("says which members are ticked", () => {
    expect(share).toMatch(/accessibilityRole="checkbox"\s*accessibilityState=\{\{ checked: on \}\}/);
    expect(share).toMatch(/onPress=\{send\}\s*accessibilityRole="button"/);
  });
});

describe("Share outside (the print)", () => {
  const exp = code("app/export.tsx");
  const share = fn(exp, "share");

  it("refuses a second tap, and shows it is busy from the first", () => {
    expect(share).toMatch(/if \(sharing\.current\) return;\s*sharing\.current = true;\s*setStage\(/);
    expect(share.indexOf("sharing.current = true")).toBeLessThan(share.indexOf("await "));
    expect(share).toMatch(/finally \{\s*sharing\.current = false;/);
  });
});

describe("Report", () => {
  const report = code("app/report.tsx");
  const submit = fn(report, "submit");

  it("sends one report per tap, and none after it is in", () => {
    expect(submit).toMatch(/if \(!session\?\.user\?\.id \|\| !reason \|\| sending\.current\) return;\s*sending\.current = true;/);
    expect(submit.indexOf("sending.current = true")).toBeLessThan(submit.indexOf("await "));
    // Only a failure lets it be sent again.
    expect(submit.match(/sending\.current = false/g)).toHaveLength(1);
    expect(submit).toMatch(/catch \(err\) \{\s*sending\.current = false;/);
  });

  it("says which reason is chosen", () => {
    expect(report).toMatch(/accessibilityRole="radio"\s*accessibilityState=\{\{ checked: reason === r \}\}/);
  });
});

describe("Send invitation", () => {
  const invites = code("app/invites.tsx");

  it("says so when the share sheet cannot open, rather than ending in silence", () => {
    const send = invites.slice(invites.indexOf("const send = () =>"), invites.indexOf("const confirmRotate"));
    expect(send).toMatch(/Share\.share\(\{[\s\S]*?\}\)\.catch\(\(\) =>\s*showAlert\("Couldn’t open sharing", "[^"]+"\),?\s*\);/);
  });
});
