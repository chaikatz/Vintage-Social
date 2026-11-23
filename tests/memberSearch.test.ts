import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { QueryClient, QueryObserver, keepPreviousData } from "@tanstack/react-query";
import {
  NAMES_FROM,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  SEARCH_MIN_LENGTH,
  USERNAME_MAX,
  likeEscape,
  matchTier,
  nobodyFound,
  orderMatches,
  quoted,
  searchDelay,
  searchKey,
  searchNeedle,
  shownResults,
  usernamePrefix,
  usernameRange,
} from "@/utils/memberSearch";

/**
 * Member search from the first letter: what is asked, in what order the
 * answers stand, and what the list draws while the member types. The
 * requests themselves, as the real client sends them, are held in
 * api-query-shapes.test.ts ("member search"); how the database plans the
 * first letter, in supabase/tests/09_scale_plans.sql.
 */

const m = (id: string, username: string, full_name: string | null = null) => ({ id, username, full_name });

describe("what is asked", () => {
  it("asks from the first letter", () => {
    expect(SEARCH_MIN_LENGTH).toBe(1);
    expect(NAMES_FROM).toBe(2);
    expect(SEARCH_LIMIT).toBe(30);
  });

  it("reads what was typed trimmed, single-spaced, in lower case, without the database's wildcard", () => {
    expect(searchNeedle("  Ma ")).toBe("ma");
    expect(searchNeedle("Maria   Lopez")).toBe("maria lopez");
    expect(searchNeedle("a*")).toBe("a");
    expect(searchNeedle(" * ")).toBe("");
  });

  it("asks about the first letter at once, and waits a beat after that", () => {
    expect(searchDelay("")).toBe(0);
    expect(searchDelay("m")).toBe(0);
    expect(searchDelay("ma")).toBe(SEARCH_DEBOUNCE_MS);
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThan(0);
    expect(SEARCH_DEBOUNCE_MS).toBeLessThanOrEqual(250);
  });

  it("reads usernames by prefix only where what was typed could begin one", () => {
    expect(usernamePrefix("m")).toBe("m");
    expect(usernamePrefix("j.s_1")).toBe("j.s_1");
    expect(usernamePrefix("maria l")).toBeNull();
    expect(usernamePrefix("é")).toBeNull();
  });

  it("reads a prefix as a range that holds every username that starts with it, and in C order no other", () => {
    const usernames = ["a", "a.b", "a_z", "a0", "az", "azzz", "a".padEnd(USERNAME_MAX, "z"), "b", "_a", ".a", "9a", "ab", "zz"].filter(
      (u) => u.length <= USERNAME_MAX,
    );
    for (const prefix of ["a", "az", "a_", "a.", "9", "_", "zz"]) {
      const { from, to } = usernameRange(prefix);
      // Code-point order, as the C collation compares.
      const inside = usernames.filter((u) => u >= from && u <= to);
      expect(inside, prefix).toEqual(usernames.filter((u) => u.startsWith(prefix)));
    }
    // The longest username that starts with the prefix is still inside.
    expect("m".padEnd(USERNAME_MAX, "z") <= usernameRange("m").to).toBe(true);
  });

  it("escapes LIKE's wildcards, and quotes a value inside or=(…)", () => {
    expect(likeEscape("a_b%c\\d")).toBe("a\\_b\\%c\\\\d");
    expect(quoted("%j.s, jr%")).toBe('"%j.s, jr%"');
    expect(quoted('a"b\\c')).toBe('"a\\"b\\\\c"');
  });
});

describe("how well a member matches", () => {
  it("matches one letter at the start of a username only", () => {
    expect(matchTier("m", m("1", "margot"))).toBe(0);
    expect(matchTier("m", m("2", "emma"))).toBeNull();
    expect(matchTier("m", m("3", "zed", "Mia Zed"))).toBeNull();
  });

  it("from the second letter: username start, then a word of the name, then anything that contains it", () => {
    expect(matchTier("ma", m("1", "margot", "Margot Dubois"))).toBe(0);
    expect(matchTier("ma", m("2", "zed", "Lena Matos"))).toBe(1);
    expect(matchTier("ma", m("3", "zed", "Marie-Matos"))).toBe(1);
    expect(matchTier("ma", m("4", "emma", "Emma Stone"))).toBe(2);
    expect(matchTier("ma", m("5", "oscar", "Oscar Wilde"))).toBeNull();
    expect(matchTier("", m("6", "margot"))).toBeNull();
  });

  it("orders the answers by how well they match, then A to Z, each member once, a page at most", () => {
    const rows = [m("e", "emma", "Emma Stone"), m("z", "zed", "Lena Matos"), m("t", "mateo"), m("g", "margot"), m("t", "mateo")];
    expect(orderMatches("ma", rows).map((r) => r.username)).toEqual(["margot", "mateo", "zed", "emma"]);
    const many = Array.from({ length: 50 }, (_, i) => m(String(i), `ma${String(i).padStart(2, "0")}`));
    expect(orderMatches("ma", many)).toHaveLength(SEARCH_LIMIT);
    // One the database matched that these rules cannot place (its case rules are not JavaScript's) is kept, last.
    expect(matchTier("ma", m("x", "other", "Oscar"))).toBeNull();
    expect(orderMatches("ma", [m("x", "other", "Oscar"), m("g", "margot")]).map((r) => r.id)).toEqual(["g", "x"]);
  });
});

describe("what the list draws while the member types", () => {
  const ma = [m("1", "margot", "Margot Dubois"), m("2", "mateo"), m("3", "emma", "Emma Stone")];

  it("draws the answer to what is typed as it came", () => {
    expect(shownResults({ typed: "ma", answered: "ma", rows: ma, held: false })).toBe(ma);
  });

  it("holds the last answer while the next comes, narrowed to what is typed, rather than blanking", () => {
    // Typed on from "ma" to "mar": the list narrows at once.
    expect(shownResults({ typed: "mar", answered: "ma", rows: ma, held: false }).map((r) => r.id)).toEqual(["1"]);
    // An earlier answer held by the query while the new letters' answer comes.
    expect(shownResults({ typed: "mat", answered: "mat", rows: ma, held: true }).map((r) => r.id)).toEqual(["2"]);
    // Back to one letter: only usernames that start with it, as one letter is asked.
    expect(shownResults({ typed: "m", answered: "ma", rows: ma, held: true }).map((r) => r.id)).toEqual(["1", "2"]);
  });

  it("draws nothing before the first answer, or with nothing typed", () => {
    expect(shownResults({ typed: "m", answered: "", rows: undefined, held: false })).toEqual([]);
    expect(shownResults({ typed: "", answered: "ma", rows: ma, held: true })).toEqual([]);
  });

  it("says nobody only of an answer that came, empty, for exactly what is typed", () => {
    const base = { typed: "zz", answered: "zz", rows: [], held: false, fetched: true };
    expect(nobodyFound(base)).toBe(true);
    expect(nobodyFound({ ...base, fetched: false })).toBe(false);
    expect(nobodyFound({ ...base, held: true })).toBe(false);
    expect(nobodyFound({ ...base, answered: "z" })).toBe(false);
    expect(nobodyFound({ ...base, rows: [m("1", "zz_top")] })).toBe(false);
    expect(nobodyFound({ ...base, typed: "", answered: "" })).toBe(false);
  });
});

describe("an answer that comes late", () => {
  /** A promise and its resolver, so answers can be made to come in any order. */
  function later<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));

  it("is never drawn as the answer to letters typed after it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const answers = { m: later<ReturnType<typeof m>[]>(), ma: later<ReturnType<typeof m>[]>() };
    // The options the Search tab gives its query: a key per needle, the last answer held.
    const options = (needle: "m" | "ma") => ({
      queryKey: searchKey(needle),
      queryFn: () => answers[needle].promise,
      placeholderData: keepPreviousData,
    });
    const observer = new QueryObserver(client, options("m"));
    const unsubscribe = observer.subscribe(() => {});
    await tick();
    // "ma" is typed before "m" is answered; "ma" is answered first, then "m", late.
    observer.setOptions(options("ma"));
    answers.ma.resolve([m("1", "margot"), m("2", "mateo")]);
    await tick();
    answers.m.resolve([m("1", "margot"), m("2", "mateo"), m("9", "milo")]);
    await tick();
    const now = observer.getCurrentResult();
    expect(now.data?.map((r) => r.id)).toEqual(["1", "2"]);
    expect(now.isPlaceholderData).toBe(false);
    expect(shownResults({ typed: "ma", answered: "ma", rows: now.data, held: now.isPlaceholderData }).map((r) => r.id)).toEqual(["1", "2"]);
    // The late answer is filed under its own letters, where it is true.
    expect(client.getQueryData(searchKey("m"))).toHaveLength(3);
    unsubscribe();
    client.clear();
  });

  it("is what the Search tab's query is keyed and held by", () => {
    const tab = readFileSync(path.resolve(import.meta.dirname, "..", "app/(tabs)/search.tsx"), "utf8");
    expect(tab).toMatch(/const typed = searchNeedle\(q\);/);
    expect(tab).toMatch(/const searching = typed\.length >= SEARCH_MIN_LENGTH;/);
    expect(tab).toMatch(/const settled = useDebounced\(typed, searchDelay\(typed\)\);/);
    expect(tab).toMatch(/queryKey: searchKey\(settled\),/);
    expect(tab).toMatch(/enabled: settled\.length >= SEARCH_MIN_LENGTH,\s*placeholderData: keepPreviousData,/);
    expect(tab).toMatch(/shownResults\(\{ typed, answered: settled, rows: results\.data, held: results\.isPlaceholderData \}\)/);
    expect(tab).toMatch(/data=\{failed \? NO_ROWS : ranked\}/);
    // No minimum of its own: the old second-letter one is gone.
    expect(tab).not.toMatch(/length >= 2|settledQ/);
    // The rows are drawn once each, not again on every keystroke.
    expect(tab).toMatch(/const SearchResult = memo\(function SearchResult/);
    expect(tab).toMatch(/renderItem=\{renderResult\}/);
  });
});
