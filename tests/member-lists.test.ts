import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { undecided, withIds, withRowBack, withoutIds, withoutRow } from "@/components/decidedRows";

/**
 * Follow requests, followers and following, and the blocked list: a
 * decided request leaves at once and cannot be decided twice, a refusal
 * puts back that one alone, and a list that could not be read says so
 * with a way to try again instead of claiming it is empty.
 */

const a = { id: "a", n: 1 };
const b = { id: "b", n: 2 };
const c = { id: "c", n: 3 };

describe("a list being decided", () => {
  it("drops the row decided", () => {
    expect(withoutRow([a, b, c], "b")).toEqual([a, c]);
    expect(withoutRow(undefined, "b")).toBeUndefined();
  });

  it("puts back the refused row alone, in its place, not the rows decided since", () => {
    const order = ["a", "b", "c"];
    // b was refused while c had already been decided and taken by the server.
    expect(withRowBack([a], b, order)).toEqual([a, b]);
    expect(withRowBack([c], a, order)).toEqual([a, c]);
  });

  it("never doubles a row that is already there", () => {
    expect(withRowBack([a, b], b, ["a", "b"])).toEqual([a, b]);
  });

  it("puts an unplaced row at the end", () => {
    expect(withRowBack([a], c)).toEqual([a, c]);
    expect(withRowBack(undefined, c)).toBeUndefined();
  });

  it("draws no row whose decision is on its way, even when a read has brought it back", () => {
    // b was taken off at the tap; another decision's read, which reached the
    // server before b's decision did, put it back in the cached list.
    const deciding = withIds(new Set(), ["b"]);
    expect(undecided([a, b, c], deciding)).toEqual([a, c]);
    expect(undecided(undefined, deciding)).toEqual([]);
    // Settled, it is drawn as the list has it.
    expect(undecided([a, b, c], withoutIds(deciding, ["b"]))).toEqual([a, b, c]);
  });

  it("keeps the set of decisions on their way without changing the one it was given", () => {
    const none: ReadonlySet<string> = new Set();
    const two = withIds(none, ["a", "b"]);
    expect([...two].sort()).toEqual(["a", "b"]);
    expect(none.size).toBe(0);
    const one = withoutIds(two, ["a"]);
    expect([...one]).toEqual(["b"]);
    expect(two.size).toBe(2);
    // Nothing to take out: the same set, so nothing is drawn again for it.
    expect(withoutIds(one, ["z"])).toBe(one);
    expect(undecided([a], none)).toEqual([a]);
  });
});

const root = path.resolve(import.meta.dirname, "..");
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Requests", () => {
  const src = code("app/requests.tsx");

  it("takes a request off the list the moment it is decided, and puts it back if refused", () => {
    expect(src).toMatch(/onMutate: async \(\{ follower \}\) => \{[\s\S]*?setQueryData<ProfileRow\[\]>\(key, \(rows\) => withoutRow\(rows, follower\.id\)\)/);
    expect(src).toMatch(/onError: \(err, \{ follower \}, ctx\) => \{\s*queryClient\.setQueryData<ProfileRow\[\]>\(key, \(rows\) => withRowBack\(rows, follower, ctx\?\.order\)\);/);
    expect(src).toMatch(/onSettled: \(_done, _err, \{ follower \}\) => \{[\s\S]*?return queryClient\.invalidateQueries\(\{ queryKey: key \}\);/);
  });

  it("keeps a request off the list while its decision is on its way, whatever a read brings back", () => {
    // Hidden from the tap…
    expect(src).toMatch(/onMutate: async \(\{ follower \}\) => \{\s*setDeciding\(\(ids\) => withIds\(ids, \[follower\.id\]\)\);/);
    // …taken out again once the server has it, after any read that left before…
    expect(src).toMatch(
      /onSuccess: async \(_done, \{ follower \}\) => \{\s*await queryClient\.cancelQueries\(\{ queryKey: key \}\);\s*queryClient\.setQueryData<ProfileRow\[\]>\(key, \(rows\) => withoutRow\(rows, follower\.id\)\);/,
    );
    // …and shown by its own state only once it has settled.
    expect(src).toMatch(/onSettled: \(_done, _err, \{ follower \}\) => \{\s*setDeciding\(\(ids\) => withoutIds\(ids, \[follower\.id\]\)\);/);
    expect(src).toMatch(/data=\{undecided\(requests\.data, deciding\)\}/);
  });

  it("names each button with the member it is for", () => {
    expect(src).toMatch(/accessibilityLabel=\{`Accept \$\{item\.username\}`\}/);
    expect(src).toMatch(/accessibilityLabel=\{`Decline \$\{item\.username\}`\}/);
  });
});

describe("a member list that could not be read", () => {
  for (const [file, q] of [
    ["app/requests.tsx", "requests"],
    ["app/follows.tsx", "list"],
    ["app/blocked.tsx", "blocked"],
  ] as const) {
    it(`${file} says so, with a way to try again, rather than calling it empty`, () => {
      const src = code(file);
      expect(src).toMatch(
        new RegExp(
          `if \\(${q}\\.isError && !${q}\\.data\\) \\{\\s*return \\(\\s*<Screen padded=\\{false\\}>[^]*?<LoadFailed [^>]*onRetry=\\{\\(\\) => ${q}\\.refetch\\(\\)\\} />\\s*</Screen>`,
        ),
      );
    });
  }
});

describe("Send to", () => {
  it("says the members you follow could not be read, rather than that there is nobody to send to", () => {
    expect(code("app/share.tsx")).toMatch(/peopleQ\.isError \? \(\s*<LoadFailed what="who you follow" onRetry=\{\(\) => peopleQ\.refetch\(\)\} \/>\s*\) : peopleQ\.isFetched \? \(/);
  });
});

describe("Followers and following", () => {
  it("says when a follow or unfollow was refused", () => {
    const src = code("app/follows.tsx");
    expect(src).toMatch(/onError: \(err, \{ next \}\) =>\s*showAlert\(next \? "Couldn’t follow" : "Couldn’t unfollow"/);
  });
});

describe("Blocked members", () => {
  it("names each Unblock with the member it is for", () => {
    expect(code("app/blocked.tsx")).toMatch(/accessibilityLabel=\{`Unblock \$\{item\.username\}`\}/);
  });
});
