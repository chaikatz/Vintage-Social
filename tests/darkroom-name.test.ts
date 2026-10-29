import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * The room is called the Memory Room wherever a member can read or hear
 * it. The code still calls it the Darkroom — its route, its modules, the
 * files it keeps on the phone, the dark paper's stored value — and those
 * stay as they are: renamed, they would leave a member's shelf and
 * history behind in files nobody reads, and the shares already saved with
 * the old value. So every string and every run of JSX text in app/,
 * src/, api/ and the server's functions is read, comments and import
 * paths left out, and the old word, spaced or not, is let through only in
 * the internal names below, each for its reason, and never where it is
 * shown or read aloud.
 */

const root = path.resolve(import.meta.dirname, "..");

const INTERNAL: [RegExp, string][] = [
  [/^\/darkroom$/, "the route"],
  [/^darkroom$/, "the route's name, the `from` the editor is opened with, the dark paper's stored value"],
  [/^darkroom(-[a-z]+)+-?$/, "a test id"],
  [/^darkroom-[a-z-]+\.json$/, "a file the room keeps on the phone"],
  [/^vintage\.darkroom-[a-z-]+$/, "the same file's key in the browser demo"],
];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.tsx?$/.test(e.name) ? [p] : [];
  });
}

interface Said {
  file: string;
  line: number;
  text: string;
  /** JSX text is on the screen as it stands; only a string can be a name. */
  jsx: boolean;
  /** A string shown or read aloud as it stands: a {…} child, or any attribute but an id or a name. */
  shown: boolean;
}

/** The attributes that name an element for the code, never for a member. */
const NAMES = new Set(["testID", "nativeID", "name"]);

function shownAt(node: ts.Node, sf: ts.SourceFile): boolean {
  let at = node.parent;
  if (at != null && ts.isJsxExpression(at)) {
    if (!ts.isJsxAttribute(at.parent)) return true;
    at = at.parent;
  }
  return at != null && ts.isJsxAttribute(at) && !NAMES.has(at.name.getText(sf));
}

/** Every string and run of JSX text in a file that says the old word, but not import paths or types. */
function saidIn(file: string, source: string): Said[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Said[] = [];
  const visit = (node: ts.Node) => {
    const parent = node.parent;
    const skipped =
      parent != null &&
      (((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) ||
        (ts.isCallExpression(parent) && (parent.expression.kind === ts.SyntaxKind.ImportKeyword || parent.expression.getText(sf) === "require")) ||
        ts.isLiteralTypeNode(parent));
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteralToken(node)) text = node.text;
    else if (ts.isJsxText(node)) text = node.getText(sf);
    if (text != null && !skipped && /dark\s*room/i.test(text)) {
      out.push({
        file: path.relative(root, file),
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        text: text.trim().replace(/\s+/g, " "),
        jsx: ts.isJsxText(node),
        shown: shownAt(node, sf),
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const internal = (s: Said) => !s.jsx && !s.shown && INTERNAL.some(([rule]) => rule.test(s.text));

describe("the room's name", () => {
  // The app, and what the server sends a member: the share and invite pages, the pushes.
  const dirs = ["app", "src", "api", "supabase/functions"];
  const files = dirs.flatMap((d) => walk(path.join(root, d)));
  const said = files.flatMap((f) => saidIn(f, readFileSync(f, "utf8")));

  it("reads the whole app, and finds the internal names it lets through", () => {
    expect(files.length).toBeGreaterThan(100);
    for (const d of dirs) expect(files.some((f) => path.relative(root, f).startsWith(`${d}/`)), d).toBe(true);
    expect(said.filter(internal).length).toBeGreaterThan(20);
  });

  it("is never the Darkroom in anything a member reads or hears", () => {
    const heard = said.filter((s) => !internal(s)).map((s) => `${s.file}:${s.line} ${s.text}`);
    expect(heard).toEqual([]);
  });

  it("reads strings, template literals and JSX text alike, and leaves comments and import paths alone", () => {
    const probe = [
      'import { x } from "@/components/darkroom/words";',
      "// The Darkroom, in a comment.",
      "/** The Darkroom, in a doc comment. */",
      'const a = "darkroom-plate";',
      'const b = "Opens it in the Darkroom.";',
      "const c = `${n} in the Darkroom`;",
      "const d = <Text>The Darkroom</Text>;",
      'const e = <Text accessibilityHint="Opens the darkroom." />;',
      'type T = "paper" | "darkroom";',
      "const f = <Text>The Dark Room</Text>;",
      'const g = <Text accessibilityLabel="darkroom" />;',
      'const h = <Text>{"darkroom"}</Text>;',
      'const i = <View testID="darkroom" nativeID={"darkroom"} />;',
      'const j = paper === "darkroom";',
    ].join("\n");
    const found = saidIn(path.join(root, "app/probe.tsx"), probe);
    expect(found.map((s) => s.line)).toEqual([4, 5, 6, 7, 8, 10, 11, 12, 13, 13, 14]);
    expect(found.filter((s) => !internal(s)).map((s) => s.text)).toEqual([
      "Opens it in the Darkroom.",
      "in the Darkroom",
      "The Darkroom",
      "Opens the darkroom.",
      "The Dark Room",
      "darkroom",
      "darkroom",
    ]);
  });

  it("lets an internal name through only as a string, never as words on the screen or read aloud", () => {
    const at = { file: "x.tsx", line: 1 };
    expect(internal({ ...at, text: "darkroom", jsx: false, shown: false })).toBe(true);
    expect(internal({ ...at, text: "darkroom", jsx: true, shown: false })).toBe(false);
    expect(internal({ ...at, text: "darkroom", jsx: false, shown: true })).toBe(false);
    for (const text of ["Darkroom", "The darkroom", "darkroom brown", "the darkroom's", "Darkroom-plate", "Dark Room", "dark room"]) {
      expect(internal({ ...at, text, jsx: false, shown: false }), text).toBe(false);
    }
  });

  it("is the Memory Room on the room's own pages and in Settings", async () => {
    const { deniedPage, emptyPage, endPage, firstVisitPage } = await import("@/components/darkroom/words");
    const ctx = { now: new Date(2026, 9, 22).getTime(), limited: false };
    expect(firstVisitPage("undetermined").eyebrow).toBe("The Memory Room");
    expect(deniedPage(18).eyebrow).toBe("The Memory Room");
    for (const why of ["library", "selection", "few", "tooNew", "failed"] as const) expect(emptyPage(why, ctx).eyebrow, why).toBe("The Memory Room");
    expect(endPage({ kind: "readFailed" }, { ...ctx, years: null }).eyebrow).toBe("The Memory Room");
    const settings = readFileSync(path.join(root, "app/settings.tsx"), "utf8");
    expect(settings).toContain("Forget what the Memory Room has shown me");
    expect(settings).toContain('"Forget what the Memory Room has shown you?"');
  });

  it("is not the Darkroom in anything iOS shows for the app", () => {
    expect(readFileSync(path.join(root, "app.json"), "utf8")).not.toMatch(/dark\s*room/i);
  });

  it("is not the Darkroom on the web pages", () => {
    const pages = readdirSync(path.join(root, "public")).filter((f) => f.endsWith(".html"));
    expect(pages.length).toBeGreaterThan(0);
    for (const page of pages) expect(readFileSync(path.join(root, "public", page), "utf8"), page).not.toMatch(/dark\s*room/i);
  });
});
