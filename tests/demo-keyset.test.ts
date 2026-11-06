import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoKeysetPage, type Cursor } from "@/api/keyset";

/**
 * The web demo pages Followers, Following, Send to and the admin's queues
 * as the server does, after the last row held. It used to find that row
 * by its id and start after it; once the row had left the list between
 * two pages (an unfollow, an application decided) it was not found, the
 * next page began at the top again, and every row came round twice (Send
 * to drew duplicate keys). Now the next page starts at the first row past
 * the cursor's time and id, whether or not its row is still there.
 */

type Row = { id: string; at: string };
const key = (r: Row): Cursor => ({ at: r.at, id: r.id });
const rows = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    // Pairs filed in the same instant: the id decides between them.
    at: new Date(Date.UTC(2026, 0, 1) + Math.floor(i / 2) * 1000).toISOString(),
  }));

function walk(list: () => Row[], size: number, ascending: boolean, between?: (held: Row[]) => void): string[] {
  const seen: string[] = [];
  let cursor: Cursor | null = null;
  for (let i = 0; i < 100; i++) {
    const page = demoKeysetPage(list(), key, cursor, size, ascending);
    seen.push(...page.map((r) => r.id));
    if (page.length < size) break;
    cursor = key(page[page.length - 1]);
    between?.(page);
  }
  return seen;
}

describe("the demo's lists, a page at a time", () => {
  it("newest first, every row once, ties by id", () => {
    const all = rows(23);
    const seen = walk(() => all, 5, false);
    expect(seen).toEqual([...all].reverse().map((r) => r.id));
  });

  it("oldest first, every row once", () => {
    const all = rows(23);
    expect(walk(() => all, 4, true)).toEqual(all.map((r) => r.id));
  });

  it("the last row held leaving the list between two pages neither starts it again nor skips one", () => {
    let all = rows(30);
    const removed: string[] = [];
    const seen = walk(
      () => all,
      6,
      false,
      (page) => {
        const last = page[page.length - 1].id;
        removed.push(last);
        all = all.filter((r) => r.id !== last);
      },
    );
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(
      rows(30)
        .reverse()
        .map((r) => r.id),
    );
    expect(removed.length).toBeGreaterThan(2);
  });

  it("an oldest-first queue whose last row held was decided between two pages goes on after it", () => {
    let all = rows(30);
    const seen = walk(
      () => all,
      5,
      true,
      (page) => {
        all = all.filter((r) => r.id !== page[page.length - 1].id);
      },
    );
    expect(seen).toEqual(rows(30).map((r) => r.id));
  });

  it("a row arriving at the top between two pages is not drawn twice", () => {
    let all = rows(20);
    let n = 0;
    const seen = walk(
      () => all,
      5,
      false,
      () => {
        n++;
        all = [...all, { id: `ffffffff-0000-4000-8000-${String(n).padStart(12, "0")}`, at: "2027-01-01T00:00:00.000Z" }];
      },
    );
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen.slice(0, 20)).toEqual(
      rows(20)
        .reverse()
        .map((r) => r.id),
    );
  });

  it("is what Followers, Following and the admin's queues page by in the demo", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const profiles = readFileSync(path.join(root, "src/api/profiles.ts"), "utf8");
    const moderation = readFileSync(path.join(root, "src/api/moderation.ts"), "utf8");
    const demoPage = profiles.slice(profiles.indexOf("function demoPage("), profiles.indexOf("\n}\n", profiles.indexOf("function demoPage(")));
    const demoPageOf = moderation.slice(moderation.indexOf("function demoPageOf"), moderation.indexOf("\n}\n", moderation.indexOf("function demoPageOf")));
    for (const body of [demoPage, demoPageOf]) {
      expect(body).toMatch(/demoKeysetPage\(/);
      expect(body).not.toMatch(/findIndex/);
    }
    expect(profiles).toMatch(/return demoPage\(demo\.demoFollowRows\(userId, side\), before\);/);
  });
});
