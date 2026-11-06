import { describe, expect, it, vi } from "vitest";
import { pagesOf, rowsOf, withRowsBack, withoutRows, type QueuePages } from "@/components/admin/queuePages";
import { sameTarget } from "@/components/reportTargets";
import { code } from "./helpers/screenSource";

// The cursor rule only: nothing here talks to Supabase or the demo.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/demo/store", () => ({}));
vi.mock("@/lib/env", () => ({ isDemoMode: () => false }));
const { ADMIN_PAGE_SIZE, nextAdminCursor } = await import("@/api/moderation");

/**
 * The admins' queues, a page at a time. Applications and reports used to
 * be read as one page of fifty with no more offered; a decision taken on
 * the screen used to edit that one list. Now the screens hold pages, and
 * a decision leaves, or comes back to, the page its row is in.
 */

type Row = { id: string; created_at: string; post_id: string | null; comment_id: string | null };
const row = (id: string, target: Partial<Row> = {}): Row => ({ id, created_at: `2026-11-0${id.length}T00:00:00Z`, post_id: null, comment_id: null, ...target });
const held = (...pages: Row[][]): QueuePages<Row> => ({ pages, pageParams: pages.map((_, i) => (i ? { at: "x", id: String(i) } : null)) });
const ids = (data: QueuePages<Row> | undefined) => data?.pages.map((p) => p.map((r) => r.id));

describe("the rows a queue holds", () => {
  it("are every page's, in order, each once", () => {
    const data = held([row("a"), row("b")], [row("c"), row("b")], [row("d")]);
    expect(rowsOf(data).map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
    expect(rowsOf(undefined)).toEqual([]);
  });
});

describe("a decision taken on the screen", () => {
  const data = held([row("a"), row("b"), row("c")], [row("d"), row("e")]);

  it("takes its rows off whichever page holds them, and keeps the pages' params", () => {
    const after = withoutRows(data, ["b", "e"]);
    expect(ids(after)).toEqual([["a", "c"], ["d"]]);
    expect(after?.pageParams).toBe(data.pageParams);
    expect(withoutRows(undefined, ["a"])).toBeUndefined();
    expect(withoutRows(data, [])).toBe(data);
  });

  it("knows the page each row was on", () => {
    expect(pagesOf(data, ["b", "e", "z"])).toEqual({ b: 0, e: 1 });
  });

  it("refused, puts each row back in the page it came from, in its place, once", () => {
    const order = rowsOf(data).map((r) => r.id);
    const homes = pagesOf(data, ["b", "e"]);
    const taken = withoutRows(data, ["b", "e"]);
    const back = withRowsBack(taken, [row("b"), row("e")], order, homes);
    expect(ids(back)).toEqual(ids(data));
    // Put back twice (a read brought one back first): still once.
    expect(ids(withRowsBack(back, [row("b")], order, homes))).toEqual(ids(data));
    // A read brought it back on another page than it came from: still once.
    const reread = held([row("a"), row("c"), row("d")], [row("e")]);
    expect(ids(withRowsBack(reread, [row("d")], ["a", "b", "c", "d", "e"], { d: 1 }))).toEqual([["a", "c", "d"], ["e"]]);
  });

  it("refused after its page is no longer held, comes back on the first", () => {
    const shorter = held([row("a"), row("c")]);
    expect(ids(withRowsBack(shorter, [row("e")], ["a", "c", "e"], { e: 1 }))).toEqual([["a", "c", "e"]]);
    expect(withRowsBack(undefined, [row("e")], [], {})).toBeUndefined();
  });

  it("puts nothing on a page that the next page's cursor reads from: the first page stays whole", () => {
    // A row from page 2 put back on page 1 would sit before page 2's cursor and be drawn twice once read again.
    const order = rowsOf(data).map((r) => r.id);
    const back = withRowsBack(withoutRows(data, ["d"]), [row("d")], order, pagesOf(data, ["d"]));
    expect(back?.pages[0].map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(back?.pages[1].map((r) => r.id)).toEqual(["d", "e"]);
  });
});

describe("the reports closed with a removal", () => {
  it("are found on every page read, not only the first", () => {
    const first = Array.from({ length: ADMIN_PAGE_SIZE }, (_, i) => row(`r${i}`, { post_id: i === 0 ? "p1" : `other${i}` }));
    const data = held(first, [row("late", { post_id: "p1" }), row("else", { post_id: "p9" })]);
    expect(nextAdminCursor(first)).toEqual({ at: first[ADMIN_PAGE_SIZE - 1].created_at, id: first[ADMIN_PAGE_SIZE - 1].id });
    expect(sameTarget(rowsOf(data), first[0]).map((r) => r.id)).toEqual(["late"]);
  });
});

/** The two screens, read from their source (nothing here renders a screen). */
describe("the applications and reports screens", () => {
  for (const [file, name, fetcher] of [
    ["app/admin/applications.tsx", "apps", "fetchApplications"],
    ["app/admin/reports.tsx", "reports", "fetchReports"],
  ] as const) {
    it(`${file} reads its queue a page at a time, and asks for the next as the list nears its end`, () => {
      const src = code(file);
      expect(src).not.toMatch(/\buseQuery\(/);
      expect(src).toMatch(
        new RegExp(
          `const ${name} = useInfiniteQuery\\(\\{\\s*queryKey: \\["admin-(apps|reports)", tab\\],\\s*queryFn: \\(\\{ pageParam \\}\\) => ${fetcher}\\(tab, pageParam\\),\\s*initialPageParam: null as AdminCursor \\| null,\\s*getNextPageParam: \\(last\\) => nextAdminCursor\\(last\\),\\s*enabled: isAdmin,\\s*\\}\\);`,
        ),
      );
      // Not while any read is on its way (TanStack's own pattern): a next page asked for during the
      // reread after a decision cancels that reread. Nor again after it failed: the foot offers Try again.
      expect(src).toContain(
        `onEndReached={() => {\n          if (${name}.hasNextPage && !${name}.isFetching && !${name}.isFetchNextPageError) ${name}.fetchNextPage();\n        }}`,
      );
      expect(src).toContain(`${name}.isFetchNextPageError ? <LoadFailed what="the rest" onRetry={() => ${name}.fetchNextPage()} /> : null`);
      // Every edit of the cache goes through the page helpers; none treats it as one list.
      expect(src).not.toMatch(/setQueryData<(ApplicationRow|ReportWithRefs)\[\]>/);
      expect(src).not.toMatch(/\bwithRowBack\(|\bwithoutRow\(/);
    });
  }
});

describe("what a report shows the admin", () => {
  const src = code("app/admin/reports.tsx");
  const card = src.slice(src.indexOf("renderItem={({ item }) => ("), src.indexOf("{tab === \"open\" ? (\n              <View style={styles.actions}>"));

  it("a reported comment: its words and who wrote them, and whether it is removed already", () => {
    expect(card).toMatch(/\{item\.comment \? \(\s*<Text style=\{styles\.resolution\}>\s*\{item\.comment\.author\?\.username \?\? "unknown"\}: “\{item\.comment\.body\}”\s*\{item\.comment\.removed_at \? " · removed" : ""\}/);
  });

  it("a reported member: their name", () => {
    expect(card).toContain("{item.member ? <Text style={styles.resolution}>Member: {item.member.username}</Text> : null}");
  });

  it("a reporter who has left: unknown (0031 keeps the report)", () => {
    expect(card).toContain('reported by {item.reporter?.username ?? "unknown"}');
  });

  it("what has been deleted since, on the open list, with what can be done", () => {
    expect(card).toContain('{tab === "open" && goneSince(item) ? <Text style={styles.details}>{goneSince(item)}</Text> : null}');
    const gone = src.slice(src.indexOf("function goneSince"), src.indexOf("export default function"));
    expect(gone).toContain('report.target_type === "post" && !report.post_id');
    expect(gone).toContain('report.target_type === "comment" && !report.comment');
    expect(gone).toContain('report.target_type === "profile" && !report.profile_id');
    expect(gone.match(/The report can be dismissed\./g)).toHaveLength(3);
  });

  it("a reported comment opens on its photograph's comments", () => {
    const open = src.slice(src.indexOf("const openTarget = "), src.indexOf("const openMember = "));
    expect(open).toContain('else if (report.comment) router.push({ pathname: "/comments", params: { postId: report.comment.post_id } });');
  });
});
