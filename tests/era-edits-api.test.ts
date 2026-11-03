import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A member's arrangement of their eras, as the app asks for it and keeps
 * it: what a row, no row, a missing table and a failure read as; the
 * upsert that saves it, and the time zone it keeps; a change shown at
 * once and taken back when it does not save; changes made while a save
 * is on its way; reads that land in the middle of a save, or are on
 * their way when a change is made; the editor the page is given; and the
 * demo store keeping to the database's rules.
 *
 * The cache is the real one (@tanstack/query-core, through react-query),
 * and a read or a save can be held until the test answers it, so the
 * races are played out in the order a slow network would play them.
 *
 * The database half (migration 0022) is proven against PostgreSQL in
 * supabase/tests/07_era_edits.sql.
 */

import type { PostRow } from "@/types/db";

type Answer = { data: unknown; error: unknown };

const h = vi.hoisted(() => ({
  demo: false,
  calls: [] as string[],
  read: { data: null as unknown, error: null as unknown },
  /** When set, a read waits until the test answers it. */
  holdReads: false,
  reads: [] as { answer: (result: { data: unknown; error: unknown }) => void }[],
  saves: [] as { row: unknown; options: unknown; settle: (error: unknown) => void }[],
  /** Every row upserted, held or not. */
  upserts: [] as unknown[],
  /** When set, a save waits until the test settles it. */
  hold: false,
  saveError: null as unknown,
  alerts: [] as string[],
  /** Draws from the phone's random source, and, when set, a source that only ever gives bytes no key can use. */
  draws: 0,
  spent: false,
  /** The member's photographs, as a read of them gives them back, or the error it fails with. */
  posts: [] as unknown[],
  postsError: null as unknown,
}));

vi.mock("@/lib/env", () => ({
  isDemoMode: () => h.demo,
  isSupabaseConfigured: () => true,
  requireEnv: () => ({ supabaseUrl: "https://proj.supabase.co/", supabaseAnonKey: "anon-key" }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (column: string, value: string) => ({
          maybeSingle: () => {
            h.calls.push(`read ${table} ${columns} ${column}=${value}`);
            if (!h.holdReads) return Promise.resolve(h.read);
            return new Promise((resolve) => h.reads.push({ answer: resolve }));
          },
          // The member's photographs (fetchUserPosts), as many as there are.
          is: () => ({
            order: () => Promise.resolve(h.postsError ? { data: null, error: h.postsError } : { data: h.posts, error: null }),
          }),
        }),
      }),
      upsert: (row: unknown, options: unknown) => {
        h.calls.push(`upsert ${table}`);
        h.upserts.push(row);
        if (!h.hold) return Promise.resolve({ error: h.saveError });
        return new Promise((resolve) => h.saves.push({ row, options, settle: (error) => resolve({ error }) }));
      },
    }),
  },
}));

vi.mock("react-native", () => ({ Platform: { OS: "ios" }, Alert: { alert: () => undefined } }));
// The phone's secure random source, as node has one: a new era's key is drawn from it (newEraKey).
vi.mock("expo-crypto", async () => {
  const { randomBytes } = await import("node:crypto");
  return {
    getRandomBytes: (n: number) => {
      h.draws++;
      return h.spent ? new Uint8Array(n).fill(255) : new Uint8Array(randomBytes(n));
    },
  };
});
vi.mock("@/utils/alert", () => ({ showAlert: (title: string) => void h.alerts.push(title) }));

const { ERA_SAVE_FAILED, READ_WAIT_MS, changeEraEdits, eraEditsKey, eraEditsQuery, fetchEraEdits, readEraEdits, saveEraEdits } =
  await import("@/api/eraEdits");
const { MADE_ERA, NO_EDITS, ROWS_PER_READ, deviceZone, editEras, moveToEra, renameEra } = await import("@/utils/eraEdits");
const { fetchUserPosts, userPostsCutShort } = await import("@/api/posts");
const { removePostEverywhere } = await import("@/utils/postCache");
const { eraMoveStage } = await import("@/components/eraSheet");
const { newEraKey } = await import("@/utils/newEraKey");
const { eraEditor } = await import("@/hooks/useEraEdits");
const { errorMessage } = await import("@/utils/errorMessage");
const demo = await import("@/demo/store");
const { DEMO_IDS } = await import("@/demo/fixtures");

type Edits = typeof NO_EDITS;

const ME = "me";
const key = eraEditsKey(ME);
const tick = () => new Promise((r) => setTimeout(r, 0));
/** The zone a first arrangement is kept with: this machine's own. */
const HERE = deviceZone();
const shown = () => client.getQueryData<{ edits: Edits; ready: boolean }>(key);
const row = (titles: Record<string, string>, moves: Record<string, string> = {}, time_zone: string | null = null): Answer => ({
  data: { titles, moves, time_zone },
  error: null,
});

let client: QueryClient;
const zone = process.env.TZ;
beforeEach(() => {
  h.demo = false;
  h.calls.length = 0;
  h.read = { data: null, error: null };
  h.holdReads = false;
  h.reads.length = 0;
  h.saves.length = 0;
  h.upserts.length = 0;
  h.hold = false;
  h.saveError = null;
  h.alerts.length = 0;
  h.draws = 0;
  h.spent = false;
  h.posts = [];
  h.postsError = null;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
  // Nothing held is left hanging for the next test, even when this one failed half way.
  h.hold = false;
  h.holdReads = false;
  for (const save of h.saves) save.settle(null);
  for (const read of h.reads) read.answer(h.read);
  await tick();
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe("reading a member's arrangement", () => {
  it("reads their one row, by author, with the zone its keys were read in", async () => {
    h.read = row({ "Lisbon 2023": "Lisbon, slowly" }, { p1: "Lisbon 2023" }, "Europe/Lisbon");
    await expect(fetchEraEdits("a1")).resolves.toEqual({
      edits: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: { p1: "Lisbon 2023" }, zone: "Europe/Lisbon" },
      ready: true,
    });
    expect(h.calls).toEqual(["read era_edits titles, moves, time_zone author_id=a1"]);
  });

  it("reads no row as no change, ready to be changed", async () => {
    await expect(fetchEraEdits("a1")).resolves.toEqual({ edits: NO_EDITS, ready: true });
  });

  it("reads a table that is not there yet as no change, and nowhere to keep one", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      h.read = { data: null, error: { code, message: 'Could not find the table "public.era_edits"', details: null, hint: null } };
      await expect(fetchEraEdits("a1")).resolves.toEqual({ edits: NO_EDITS, ready: false });
    }
  });

  it("passes any other failure on, to be tried again", async () => {
    const lost = { code: "", message: "TypeError: Network request failed", details: "", hint: "" };
    h.read = { data: null, error: lost };
    await expect(fetchEraEdits("a1")).rejects.toBe(lost);
  });

  it("is what every screen reads through, one cache entry each", () => {
    const query = eraEditsQuery("a1");
    expect(query.queryKey).toEqual(["era-edits", "a1"]);
    expect(query.queryKey).toEqual(eraEditsKey("a1"));
  });
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

describe("saving", () => {
  it("upserts the whole arrangement over the member's own row, with its zone", async () => {
    h.hold = true;
    const saved = saveEraEdits(ME, { titles: { a: "A" }, moves: { p: "a" }, zone: "Europe/Lisbon" });
    await tick();
    expect(h.saves[0].row).toEqual({ author_id: ME, titles: { a: "A" }, moves: { p: "a" }, time_zone: "Europe/Lisbon" });
    expect(h.saves[0].options).toEqual({ onConflict: "author_id" });
    h.saves[0].settle(null);
    await expect(saved).resolves.toBeUndefined();
  });

  it("writes no zone where it has none", async () => {
    await saveEraEdits(ME, { titles: { a: "A" }, moves: {} });
    expect(h.upserts).toEqual([{ author_id: ME, titles: { a: "A" }, moves: {}, time_zone: null }]);
  });

  it("passes a refusal on as it came, and the member's words never show it", async () => {
    const refused = { code: "42501", message: 'new row violates row-level security policy for table "era_edits"', details: null, hint: null };
    h.saveError = refused;
    const caught = await saveEraEdits(ME, NO_EDITS).catch((err: unknown) => err);
    expect(caught).toBe(refused);
    expect(errorMessage(caught, ERA_SAVE_FAILED.body)).toBe(ERA_SAVE_FAILED.body);
    expect(ERA_SAVE_FAILED).toEqual({ title: "Couldn’t save that change", body: "Your eras are as they were. Try again in a moment." });
  });
});

// ---------------------------------------------------------------------------
// A change, shown at once
// ---------------------------------------------------------------------------

describe("a change to the member's own arrangement", () => {
  const rename = (title: string, era = "Lisbon 2023") => (e: Edits) => renameEra(e, era, title);

  it("is on the page before the server has it, and stays once it does", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    const done = changeEraEdits(client, ME, rename("Lisbon, slowly"));
    const after = { edits: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: {}, zone: HERE }, ready: true };
    expect(shown()).toEqual(after);
    await tick();
    expect(h.saves).toHaveLength(1);
    h.saves[0].settle(null);
    await done;
    expect(shown()).toEqual(after);
  });

  it("is taken back when it does not save, and the failure is passed on once", async () => {
    const before = { titles: { "Kyoto 2024": "Spring" }, moves: {} };
    client.setQueryData(key, { edits: before, ready: true });
    h.saveError = { code: "", message: "TypeError: Network request failed" };
    await expect(changeEraEdits(client, ME, rename("Lisbon, slowly"))).rejects.toBe(h.saveError);
    expect(shown()).toEqual({ edits: before, ready: true });
  });

  it("taken back, is read again, as the save may have landed and only its answer been lost", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.saveError = { code: "", message: "TypeError: Network request failed" };
    // The upsert reached the row; its answer did not reach the phone.
    h.read = row({ "Lisbon 2023": "One" }, {}, "Europe/Lisbon");
    await expect(changeEraEdits(client, ME, rename("One"))).rejects.toBe(h.saveError);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);

    // A page that has it open reads it again at once, and draws what the server holds.
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    const observer = new QueryObserver(client, { ...eraEditsQuery(ME), staleTime: Infinity });
    const stop = observer.subscribe(() => undefined);
    h.calls.length = 0;
    await expect(changeEraEdits(client, ME, rename("One"))).rejects.toBe(h.saveError);
    await vi.waitFor(() => expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "One" }));
    expect(h.calls).toEqual(["upsert era_edits", "read era_edits titles, moves, time_zone author_id=me"]);
    stop();
  });

  it("made while a save is on its way shows at once and is saved next, the last word last", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    const first = changeEraEdits(client, ME, rename("One"));
    await tick();
    const second = changeEraEdits(client, ME, rename("Two", "Kyoto 2024"));
    await second; // it rides on the save under way
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "One", "Kyoto 2024": "Two" });
    expect(h.saves).toHaveLength(1);
    h.saves[0].settle(null);
    await tick();
    expect(h.saves).toHaveLength(2);
    expect(h.saves[1].row).toEqual({
      author_id: ME,
      titles: { "Lisbon 2023": "One", "Kyoto 2024": "Two" },
      moves: {},
      time_zone: HERE ?? null,
    });
    h.saves[1].settle(null);
    await first;
    expect(h.calls.filter((c) => c.startsWith("upsert"))).toHaveLength(2);
  });

  it("goes back to what the server last held when a later save fails, keeping what saved before it", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    const first = changeEraEdits(client, ME, rename("One"));
    await tick();
    void changeEraEdits(client, ME, rename("Two", "Kyoto 2024"));
    h.saves[0].settle(null);
    await tick();
    h.saves[1].settle({ code: "", message: "TypeError: Network request failed" });
    await expect(first).rejects.toMatchObject({ message: "TypeError: Network request failed" });
    expect(shown()?.edits).toEqual({ titles: { "Lisbon 2023": "One" }, moves: {}, zone: HERE });
  });

  it("is not made before the arrangement has been read, nor where there is nowhere to keep it", async () => {
    await changeEraEdits(client, ME, rename("One"));
    client.setQueryData(key, { edits: NO_EDITS, ready: false });
    await changeEraEdits(client, ME, rename("One"));
    expect(shown()).toEqual({ edits: NO_EDITS, ready: false });
    expect(h.calls).toEqual([]);
  });

  it("that changes nothing saves nothing", async () => {
    client.setQueryData(key, { edits: { titles: { "Lisbon 2023": "One" }, moves: {} }, ready: true });
    await changeEraEdits(client, ME, rename("One"));
    await changeEraEdits(client, ME, (e) => moveToEra(e, [], "p1", "Lisbon 2023"));
    expect(h.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The zone an arrangement keeps
// ---------------------------------------------------------------------------

describe("the time zone an arrangement is kept with", () => {
  it("is the phone's own at the first save, and the same one ever after, wherever the member goes", async () => {
    process.env.TZ = "Europe/Lisbon";
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    await changeEraEdits(client, ME, (e) => renameEra(e, "Lisbon 2024", "New Year"));
    expect(h.upserts).toEqual([{ author_id: ME, titles: { "Lisbon 2024": "New Year" }, moves: {}, time_zone: "Europe/Lisbon" }]);
    expect(shown()?.edits.zone).toBe("Europe/Lisbon");

    // Off to New York: the next change keeps Lisbon, so no key changes meaning.
    process.env.TZ = "America/New_York";
    await changeEraEdits(client, ME, (e) => renameEra(e, "Porto 2024", "Porto"));
    expect(h.upserts[1]).toMatchObject({ time_zone: "Europe/Lisbon" });
  });

  it("is the one read from the server, where there is one", async () => {
    process.env.TZ = "America/New_York";
    client.setQueryData(key, { edits: { titles: {}, moves: {}, zone: "Asia/Tokyo" }, ready: true });
    await changeEraEdits(client, ME, (e) => renameEra(e, "Kyoto 2024", "Spring"));
    expect(h.upserts[0]).toMatchObject({ time_zone: "Asia/Tokyo" });
  });

  it("is the phone's own only where the phone names one it can read", () => {
    process.env.TZ = "Europe/Lisbon";
    expect(deviceZone()).toBe("Europe/Lisbon");
    const resolved = Intl.DateTimeFormat.prototype.resolvedOptions;
    try {
      Intl.DateTimeFormat.prototype.resolvedOptions = function () {
        return { ...resolved.call(this), timeZone: "Not/A_Zone" };
      };
      expect(deviceZone()).toBeUndefined();
      Intl.DateTimeFormat.prototype.resolvedOptions = function () {
        return { ...resolved.call(this), timeZone: "Lisbon; drop table" };
      };
      expect(deviceZone()).toBeUndefined();
    } finally {
      Intl.DateTimeFormat.prototype.resolvedOptions = resolved;
    }
  });
});

// ---------------------------------------------------------------------------
// Reads that cross a save
// ---------------------------------------------------------------------------

describe("a read that crosses a save", () => {
  const rename = (era: string, title: string) => (e: Edits) => renameEra(e, era, title);
  const page = () => new QueryObserver(client, eraEditsQuery(ME));

  it("answered mid-save with the row as it was, neither takes the change off the page nor is saved back", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    h.holdReads = true;
    const done = changeEraEdits(client, ME, rename("Lisbon 2023", "Portugal"));
    await tick();
    expect(h.saves).toHaveLength(1);

    // Pulled to refresh while the save is on its way; the server answers before the save reaches the row.
    void page().refetch();
    await tick();
    h.reads[0].answer(row({}));
    await tick();
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "Portugal" });

    h.saves[0].settle(null);
    await done;
    expect(h.upserts).toHaveLength(1);
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "Portugal" });
  });

  it("still on its way when the save lands, is called off, so its old answer never reaches the page", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    h.holdReads = true;
    const done = changeEraEdits(client, ME, rename("Lisbon 2023", "Portugal"));
    await tick();
    void page().refetch();
    await tick();
    h.saves[0].settle(null);
    await done;
    h.reads[0].answer(row({}));
    await tick();
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "Portugal" });
    expect(h.upserts).toHaveLength(1);
  });

  it("answered with the first save, keeps the change made since on the page, and it is saved next", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    h.holdReads = true;
    const first = changeEraEdits(client, ME, rename("Lisbon 2023", "A"));
    await tick();
    await changeEraEdits(client, ME, rename("Kyoto 2024", "B"));
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "A", "Kyoto 2024": "B" });

    // The first save has reached the row; a read now answers with it alone.
    void page().refetch();
    await tick();
    h.reads[0].answer(row({ "Lisbon 2023": "A" }, {}, HERE ?? null));
    await tick();
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "A", "Kyoto 2024": "B" });

    h.saves[0].settle(null);
    await tick();
    expect(h.saves).toHaveLength(2);
    expect(h.saves[1].row).toEqual({ author_id: ME, titles: { "Lisbon 2023": "A", "Kyoto 2024": "B" }, moves: {}, time_zone: HERE ?? null });
    h.saves[1].settle(null);
    await first;
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "A", "Kyoto 2024": "B" });
  });

  it("on its way when a change is made, is waited for, and the change is made over what it brings", async () => {
    // This phone holds an older arrangement; another has since named Lisbon.
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.holdReads = true;
    void page().refetch();
    await tick();
    expect(h.reads).toHaveLength(1);

    const done = changeEraEdits(client, ME, rename("Porto 2023", "Mine"));
    // On the page at once, as any change is.
    expect(shown()?.edits.titles).toEqual({ "Porto 2023": "Mine" });
    await tick();
    expect(h.upserts).toEqual([]); // nothing saved over a row not yet seen
    expect(shown()?.edits.titles).toEqual({ "Porto 2023": "Mine" });

    h.reads[0].answer(row({ "Lisbon 2023": "From iPad" }, {}, "Europe/Lisbon"));
    await done;
    expect(h.upserts).toEqual([
      { author_id: ME, titles: { "Lisbon 2023": "From iPad", "Porto 2023": "Mine" }, moves: {}, time_zone: "Europe/Lisbon" },
    ]);
    expect(shown()?.edits.titles).toEqual({ "Lisbon 2023": "From iPad", "Porto 2023": "Mine" });
  });

  it("on its way, takes the changes made as it is waited for: each on the page at once, all saved once, the last word last", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.holdReads = true;
    void page().refetch();
    await tick();

    const first = changeEraEdits(client, ME, rename("Porto 2023", "Mine"));
    await changeEraEdits(client, ME, rename("Kyoto 2024", "Spring")); // it rides on the wait
    await changeEraEdits(client, ME, rename("Porto 2023", "Ours"));
    expect(shown()?.edits.titles).toEqual({ "Porto 2023": "Ours", "Kyoto 2024": "Spring" });
    await tick();
    expect(h.upserts).toEqual([]);

    h.reads[0].answer(row({ "Lisbon 2023": "From iPad" }, {}, "Europe/Lisbon"));
    await first;
    const all = { "Lisbon 2023": "From iPad", "Porto 2023": "Ours", "Kyoto 2024": "Spring" };
    expect(h.upserts).toEqual([{ author_id: ME, titles: all, moves: {}, time_zone: "Europe/Lisbon" }]);
    expect(shown()?.edits.titles).toEqual(all);
  });

  it("on its way and called off for a fresh one by a pull to refresh, the fresh one is waited for, never the page as it was", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.holdReads = true;
    void page().refetch(); // a read on focus, say
    await tick();
    const done = changeEraEdits(client, ME, rename("Porto 2023", "Mine"));
    await tick();

    // Pulled to refresh: the read on its way is called off, quietly, for a fresh one.
    void page().refetch();
    await tick();
    expect(h.reads).toHaveLength(2);
    await tick();
    expect(h.upserts).toEqual([]);

    h.reads[0].answer(row({})); // called off: its answer goes nowhere
    h.reads[1].answer(row({ "Lisbon 2023": "From iPad" }, {}, "Europe/Lisbon"));
    await done;
    const both = { "Lisbon 2023": "From iPad", "Porto 2023": "Mine" };
    expect(h.upserts).toEqual([{ author_id: ME, titles: both, moves: {}, time_zone: "Europe/Lisbon" }]);
    expect(shown()?.edits.titles).toEqual(both);
  });

  it("on its way and failing, is not waited for through its tries: the change is saved over the page as it was", async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 5 } } });
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.holdReads = true;
    void page().refetch();
    await tick();
    const done = changeEraEdits(client, ME, rename("Porto 2023", "Mine"));

    h.reads[0].answer({ data: null, error: { code: "", message: "TypeError: Network request failed" } });
    await tick();
    // Saved now, not once the tries are over; were the phone offline, it would fail, and the member be told.
    expect(h.upserts).toEqual([{ author_id: ME, titles: { "Porto 2023": "Mine" }, moves: {}, time_zone: HERE ?? null }]);
    await done;
    expect(shown()?.edits.titles).toEqual({ "Porto 2023": "Mine" });
  });

  it("waiting for the phone to be back online, is not waited for", async () => {
    onlineManager.setOnline(false);
    try {
      client.setQueryData(key, { edits: NO_EDITS, ready: true });
      void page().refetch();
      await tick();
      expect(client.getQueryState(key)?.fetchStatus).toBe("paused");

      const done = changeEraEdits(client, ME, rename("Porto 2023", "Mine"));
      await tick();
      expect(h.upserts).toEqual([{ author_id: ME, titles: { "Porto 2023": "Mine" }, moves: {}, time_zone: HERE ?? null }]);
      await done;
    } finally {
      onlineManager.setOnline(true);
    }
  });

  it("on its way and slow to come, is waited for no longer than a few seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      client.setQueryData(key, { edits: NO_EDITS, ready: true });
      h.holdReads = true;
      void page().refetch();
      await vi.advanceTimersByTimeAsync(0);
      const done = changeEraEdits(client, ME, rename("Porto 2023", "Mine"));

      await vi.advanceTimersByTimeAsync(READ_WAIT_MS - 1);
      expect(h.upserts).toEqual([]);
      await vi.advanceTimersByTimeAsync(1);
      expect(h.upserts).toEqual([{ author_id: ME, titles: { "Porto 2023": "Mine" }, moves: {}, time_zone: HERE ?? null }]);
      await done;
      expect(READ_WAIT_MS).toBeLessThanOrEqual(5000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is the arrangement as read whenever nothing is being saved", async () => {
    h.read = row({ "Lisbon 2023": "Lisbon, slowly" });
    await expect(readEraEdits(ME)).resolves.toEqual({ edits: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: {} }, ready: true });
  });
});

// ---------------------------------------------------------------------------
// The editor the page is given
// ---------------------------------------------------------------------------

describe("the editor on the member's own page", () => {
  const post = (id: string, taken: string, location: string) =>
    ({ id, taken_at: taken, created_at: "2026-09-01T12:00:00", location }) as unknown as PostRow;
  const posts = [
    post("k1", "2024-03-02T12:00:00", "Kyoto"),
    post("k2", "2024-03-05T12:00:00", "Kyoto"),
    post("l1", "2023-05-02T12:00:00", "Lisbon"),
    post("l2", "2023-05-20T12:00:00", "Lisbon"),
  ];
  const gone = post("gone", "2023-05-03T12:00:00", "Lisbon");

  it("says a move was made only when one was", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    const editor = eraEditor(client, ME, posts);
    expect(editor.move(posts[2], "Kyoto 2024")).toBe(true);
    expect(shown()?.edits.moves).toEqual({ l1: "Kyoto 2024" });
    await tick();
    // Already there; an era the reading does not make; a photograph deleted elsewhere.
    expect(editor.move(posts[2], "Kyoto 2024")).toBe(false);
    expect(editor.move(posts[3], "Paris 1999")).toBe(false);
    expect(editor.move(gone, "Kyoto 2024")).toBe(false);
    await tick();
    expect(h.upserts).toHaveLength(1);
  });

  it("moves nothing before the arrangement has been read", () => {
    expect(eraEditor(client, ME, posts).move(posts[2], "Kyoto 2024")).toBe(false);
    client.setQueryData(key, { edits: NO_EDITS, ready: false });
    expect(eraEditor(client, ME, posts).move(posts[2], "Kyoto 2024")).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("lets go of names and moves that no longer apply as it renames", async () => {
    client.setQueryData(key, {
      edits: { titles: { "Kyiv 2022": "Home", "Kyoto 2024": "Spring" }, moves: { deleted: "Kyoto 2024", l2: "Kyiv 2022" } },
      ready: true,
    });
    eraEditor(client, ME, posts).rename("Lisbon 2023", "Portugal");
    await tick();
    expect(h.upserts).toEqual([
      { author_id: ME, titles: { "Kyoto 2024": "Spring", "Lisbon 2023": "Portugal" }, moves: {}, time_zone: HERE ?? null },
    ]);
  });

  it("tells the member, once, when a change does not save", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.saveError = { code: "", message: "TypeError: Network request failed" };
    eraEditor(client, ME, posts).rename("Lisbon 2023", "Portugal");
    await vi.waitFor(() => expect(h.alerts).toEqual([ERA_SAVE_FAILED.title]));
  });

  // Kyoto 2024 (k1, k2) and Lisbon 2023 (l1, l2), and one posted without a capture date.
  const undated = { ...post("u1", "2023-05-03T12:00:00", "Lisbon"), taken_at: null } as PostRow;
  const all = [...posts, undated];
  /** Keys drawn in turn, as a source would give them, counting each draw. */
  const keys = () => {
    let n = 0;
    return Object.assign(() => `~${String(++n).padStart(10, "0")}`, { drawn: () => n });
  };

  it("adds photographs to an era as one change, saved once, and says whether any moved", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    const editor = eraEditor(client, ME, all);
    expect(editor.add("Kyoto 2024", ["l1", "u1", "k1"])).toBe(true);
    expect(shown()?.edits.moves).toEqual({ l1: "Kyoto 2024", u1: "Kyoto 2024" });
    await tick();
    expect(h.upserts).toHaveLength(1);
    // All there already; an era that is not one; photographs deleted elsewhere; nothing at all.
    expect(editor.add("Kyoto 2024", ["l1", "u1"])).toBe(false);
    expect(editor.add("Paris 1999", ["l2"])).toBe(false);
    expect(editor.add("Lisbon 2023", ["gone"])).toBe(false);
    expect(editor.add("Lisbon 2023", [])).toBe(false);
    await tick();
    expect(h.upserts).toHaveLength(1);
  });

  it("makes a new era, saved once, and gives back its key, drawn once", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    const draw = keys();
    const editor = eraEditor(client, ME, all, draw);
    const made = editor.create("  Portugal ", ["l1", "u1", "gone"]);
    expect(made).toBe("~0000000001");
    expect(draw.drawn()).toBe(1);
    expect(shown()?.edits).toMatchObject({ titles: { "~0000000001": "Portugal" }, moves: { l1: "~0000000001", u1: "~0000000001" } });
    await tick();
    expect(h.upserts).toEqual([
      {
        author_id: ME,
        titles: { "~0000000001": "Portugal" },
        moves: { l1: "~0000000001", u1: "~0000000001" },
        time_zone: HERE ?? null,
      },
    ]);
    const era = editEras(all, shown()!.edits).find((e) => e.key === made);
    expect(era).toMatchObject({ title: "Portugal", made: true, renamed: false });
    // No name; no photographs of theirs: nothing made, and nothing saved.
    expect(editor.create("   ", ["l2"])).toBeNull();
    expect(editor.create("Elsewhere", ["gone"])).toBeNull();
    await tick();
    expect(h.upserts).toHaveLength(1);
  });

  it("makes the same era, by the key it gave back, when the change is made again over a read that lands", async () => {
    // This phone holds an older arrangement; another has since named Lisbon.
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.holdReads = true;
    void new QueryObserver(client, eraEditsQuery(ME)).refetch();
    await tick();
    const draw = keys();
    const made = eraEditor(client, ME, all, draw).create("Portugal", ["l1", "l2"]);
    expect(made).toBe("~0000000001");
    h.reads[0].answer(row({ "Lisbon 2023": "From iPad" }, {}, "Europe/Lisbon"));
    await vi.waitFor(() => expect(h.upserts).toHaveLength(1));
    expect(h.upserts[0]).toEqual({
      author_id: ME,
      titles: { "Lisbon 2023": "From iPad", "~0000000001": "Portugal" },
      moves: { l1: "~0000000001", l2: "~0000000001" },
      time_zone: "Europe/Lisbon",
    });
    expect(draw.drawn()).toBe(1);
  });

  it("takes a photograph out, and deletes an era the member made, each once, and says whether it did", async () => {
    const made = "~0000000001";
    client.setQueryData(key, {
      edits: { titles: { [made]: "Portugal" }, moves: { l1: made, l2: made, k1: "Lisbon 2023" } },
      ready: true,
    });
    const editor = eraEditor(client, ME, all);
    expect(editor.takeOut(posts[0])).toBe(true);
    expect(shown()?.edits.moves).toEqual({ l1: made, l2: made });
    // In Kyoto of itself now, with nothing to take it out of.
    expect(editor.takeOut(posts[0])).toBe(false);
    expect(editor.takeOut(undated)).toBe(false);
    await tick();
    expect(editor.deleteEra(made)).toBe(true);
    expect(shown()?.edits).toMatchObject({ titles: {}, moves: {} });
    expect(editor.deleteEra(made)).toBe(false);
    // An automatic era is how the photographs fall, not something to delete.
    expect(editor.deleteEra("Lisbon 2023")).toBe(false);
    await tick();
    expect(h.upserts).toHaveLength(2);
  });

  it("changes nothing before the arrangement has been read", () => {
    const editor = eraEditor(client, ME, all, keys());
    expect(editor.add("Kyoto 2024", ["l1"])).toBe(false);
    expect(editor.create("Portugal", ["l1"])).toBeNull();
    expect(editor.takeOut(posts[2])).toBe(false);
    expect(editor.deleteEra("~0000000001")).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it("draws a new era's key from the phone's secure source, a new one each time", () => {
    const drawn = Array.from({ length: 500 }, () => newEraKey());
    expect(drawn.every((k) => MADE_ERA.test(k))).toBe(true);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(h.draws).toBe(500);
    // And the editor reaches for it when the tests give none.
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    expect(eraEditor(client, ME, all).create("Portugal", ["l1"])).toMatch(MADE_ERA);
    expect(h.draws).toBe(501);
  });

  it("says so, rather than go on drawing, from a source that never gives a byte a key can use", () => {
    h.spent = true;
    expect(() => newEraKey()).toThrow("There was no randomness to make an era’s key from.");
    expect(h.draws).toBe(8);
  });

  describe("over a list that may not be all of the member's photographs", () => {
    const made = "~0000000001";
    // An era of the member's own, of photographs past those read, and a name for an era of theirs.
    const past = { titles: { [made]: "Old days", "Summer 2019": "Heat" }, moves: { p1002: made, p1003: made } };
    const listKey = ["user-posts", ME];
    /** A read of the member's photographs, as every screen asks for one. */
    const read = () => client.fetchQuery({ queryKey: listKey, queryFn: () => fetchUserPosts(ME) });
    const list = () => client.getQueryData<PostRow[]>(listKey) ?? [];
    const saved = () => {
      const last = h.upserts.at(-1) as { titles: unknown; moves: unknown } | undefined;
      return last && { titles: last.titles, moves: last.moves };
    };
    // A delete takes a photograph off the list by its media path, as a row has one.
    const row = (id: string, taken: string, location: string) => ({ ...post(id, taken, location), media_path: `${id}.jpg` }) as PostRow;
    afterEach(async () => {
      h.posts = [];
      await fetchUserPosts(ME);
    });

    it("lets nothing go over a read cut short, however short the list is made after it, until a read brings back all of them", async () => {
      // A thousand came back: PostgREST's most, and there are more.
      h.posts = Array.from({ length: ROWS_PER_READ }, (_, i) => row(`m${i}`, "2020-07-10T12:00:00", "Milan"));
      await read();
      expect(userPostsCutShort(ME)).toBe(true);
      // One taken off the list on this phone, the read after it not landed, or failed.
      client.setQueryData(listKey, list().slice(1));
      client.setQueryData(key, { edits: past, ready: true });
      eraEditor(client, ME, list()).rename("Milan 2020", "Milano");
      await tick();
      expect(saved()).toEqual({ titles: { ...past.titles, "Milan 2020": "Milano" }, moves: past.moves });

      // Read again with all of them, what is not among them is let go with the next change.
      h.posts = list();
      await read();
      expect(userPostsCutShort(ME)).toBe(false);
      eraEditor(client, ME, list()).rename("Milan 2020", "Milan, that summer");
      await tick();
      expect(saved()).toEqual({ titles: { "Milan 2020": "Milan, that summer" }, moves: {} });
    });

    it("lets nothing go over a list a delete has changed since it was read, until it is read again", async () => {
      h.posts = [
        row("k1", "2024-03-02T12:00:00", "Kyoto"),
        row("k2", "2024-03-05T12:00:00", "Kyoto"),
        row("l1", "2023-05-02T12:00:00", "Lisbon"),
        row("l2", "2023-05-20T12:00:00", "Lisbon"),
      ];
      await read();
      expect(userPostsCutShort(ME)).toBe(false);
      client.setQueryData(key, { edits: { titles: {}, moves: { l2: "Kyoto 2024" } }, ready: true });
      // Deleted on this phone: off the list at once, and asked for again.
      await removePostEverywhere(client, "l2");
      expect(list().map((p) => p.id)).toEqual(["k1", "k2", "l1"]);
      eraEditor(client, ME, list()).rename("Lisbon 2023", "Portugal");
      await tick();
      expect(saved()).toEqual({ titles: { "Lisbon 2023": "Portugal" }, moves: { l2: "Kyoto 2024" } });

      h.posts = list();
      await read();
      eraEditor(client, ME, list()).rename("Lisbon 2023", "Lisboa");
      await tick();
      expect(saved()).toEqual({ titles: { "Lisbon 2023": "Lisboa" }, moves: {} });
    });
  });
});

describe("Add to an era…, as the screen reads the member's photographs", () => {
  const row = (id: string) => ({ id, taken_at: "2024-03-02T12:00:00", created_at: "2026-09-01T12:00:00", location: "Kyoto" });
  const listKey = ["user-posts", ME];
  /**
   * The screen's read (app/era-move.tsx), and what it shows of `postId`:
   * first as useQuery draws it, which knows a read is about to go out,
   * then as each answer comes.
   */
  function opened(postId: string) {
    // Kept fresh for 30 seconds, as the app's cache keeps every read (src/lib/queryClient.ts).
    const options = { queryKey: listKey, queryFn: () => fetchUserPosts(ME), staleTime: 30_000, refetchOnMount: "always" as const };
    const observer = new QueryObserver(client, options);
    const seen: string[] = [];
    const look = (posts = observer.getCurrentResult()) => {
      const stage = eraMoveStage({
        answered: posts.isFetched,
        reading: posts.fetchStatus !== "idle",
        failed: posts.isError || !posts.data,
        found: (posts.data as { id: string }[] | undefined)?.some((p) => p.id === postId) ?? false,
        arrangeable: true,
      });
      if (seen.at(-1) !== stage) seen.push(stage);
    };
    // As useQuery asks for its first result.
    look(observer.getOptimisticResult({ ...client.defaultQueryOptions(options), _optimisticResults: "optimistic" }));
    const stop = observer.subscribe(() => look());
    return { seen, stop };
  }

  it("reads a list cached from before the photograph was posted again, fresh as it is, and finds it", async () => {
    client.setQueryData(listKey, [row("k1")]);
    h.posts = [row("new"), row("k1")];
    const screen = opened("new");
    await vi.waitFor(() => expect(screen.seen.at(-1)).toBe("sheet"));
    screen.stop();
    expect(screen.seen).toEqual(["reading", "sheet"]);
  });

  it("says a failed read failed, never that the photograph is not the member's", async () => {
    h.postsError = { code: "", message: "TypeError: Network request failed" };
    const screen = opened("k1");
    await vi.waitFor(() => expect(screen.seen.at(-1)).not.toBe("reading"));
    screen.stop();
    expect(screen.seen).toEqual(["reading", "readFailed"]);
  });

  it("says the photograph is not the member's only once a read has answered without it", async () => {
    client.setQueryData(listKey, [row("k1")]);
    h.posts = [row("k1")];
    const screen = opened("gone");
    await vi.waitFor(() => expect(screen.seen.at(-1)).not.toBe("reading"));
    screen.stop();
    expect(screen.seen).toEqual(["reading", "notYours"]);
  });
});

// ---------------------------------------------------------------------------
// The demo store, which keeps to the same rules
// ---------------------------------------------------------------------------

describe("the demo store", () => {
  beforeEach(() => {
    h.demo = true;
    demo.demoReset();
    demo.demoSignIn("elena@vintage.club");
  });

  it("gives Elena two eras of her own to arrange, Milan now and Milan then", () => {
    const posts = demo.demoFetchUserPosts(DEMO_IDS.elena);
    const eras = editEras(posts);
    expect(eras.find((e) => e.key === "Milan 2025")?.posts.map((p) => p.id)).toEqual(["demo-post-04", "demo-post-03"]);
    // The two from this week make the other, except in the first days of a year, when they fall either side of it.
    const recent = posts.filter((p) => p.id === "demo-post-01" || p.id === "demo-post-02");
    const years = new Set(recent.map((p) => new Date(p.taken_at!).getFullYear()));
    expect(eras.map((e) => e.posts.length)).toEqual(years.size === 1 ? [2, 2] : [2]);
  });

  it("shows a member's own name for their era to whoever may see their photographs", async () => {
    const athens = editEras(demo.demoFetchUserPosts(DEMO_IDS.niko), (await fetchEraEdits(DEMO_IDS.niko)).edits);
    expect(athens.map((e) => e.title)).toEqual(["Islands, off-season"]);
    expect(athens[0].key).toMatch(/^Athens \d{4}$/);
  });

  it("keeps a private member's arrangement from members who may not see their photographs, and from the signed out", () => {
    // Elena does not follow Otis, who is private.
    expect(demo.demoFetchEraEdits(DEMO_IDS.otis)).toEqual(NO_EDITS);
    demo.demoSignOut();
    expect(demo.demoFetchEraEdits(DEMO_IDS.niko)).toEqual(NO_EDITS);
  });

  it("saves the member's own, whole, with its zone, and reads it back to an accepted follower", async () => {
    const next = { titles: { "Milan 2025": "The foggy winter" }, moves: { "demo-post-01": "Milan 2025" }, zone: "Europe/Rome" };
    await saveEraEdits(DEMO_IDS.elena, next);
    expect(await fetchEraEdits(DEMO_IDS.elena)).toEqual({ edits: next, ready: true });
    // The admin follows everyone, Elena among them.
    demo.demoSignIn("admin@vintage.club");
    expect(demo.demoFetchEraEdits(DEMO_IDS.elena)).toEqual(next);
  });

  it("refuses to save anyone else's", async () => {
    await expect(saveEraEdits(DEMO_IDS.niko, NO_EDITS)).rejects.toThrow("Only you can arrange your own eras.");
    expect(demo.demoFetchEraEdits(DEMO_IDS.niko).titles).not.toEqual({});
  });

  it("refuses what the database's checks refuse: a name too long, a zone that is not one", async () => {
    const refused = { code: "23514" };
    await expect(saveEraEdits(DEMO_IDS.elena, { titles: { "Milan 2025": "é".repeat(61) }, moves: {} })).rejects.toMatchObject(refused);
    await expect(saveEraEdits(DEMO_IDS.elena, { titles: {}, moves: {}, zone: "Rome; drop table" })).rejects.toMatchObject(refused);
    await expect(saveEraEdits(DEMO_IDS.elena, { titles: { "Milan 2025": "é".repeat(60) }, moves: {}, zone: "Europe/Rome" })).resolves.toBeUndefined();
  });

  it("keeps an era the member made as the database does, its key a word like any other", async () => {
    const posts = demo.demoFetchUserPosts(DEMO_IDS.elena);
    client.setQueryData(eraEditsKey(DEMO_IDS.elena), await fetchEraEdits(DEMO_IDS.elena));
    const made = eraEditor(client, DEMO_IDS.elena, posts, () => "~k3j9x0ab12").create("Two winters in Milan", [
      "demo-post-01",
      "demo-post-03",
    ]);
    expect(made).toBe("~k3j9x0ab12");
    await vi.waitFor(() => expect(demo.demoFetchEraEdits(DEMO_IDS.elena).titles).toEqual({ "~k3j9x0ab12": "Two winters in Milan" }));
    const kept = demo.demoFetchEraEdits(DEMO_IDS.elena);
    expect(kept.moves).toEqual({ "demo-post-01": "~k3j9x0ab12", "demo-post-03": "~k3j9x0ab12" });
    // The admin, who follows everyone, reads it as Elena does.
    demo.demoSignIn("admin@vintage.club");
    const theirs = editEras(posts, (await fetchEraEdits(DEMO_IDS.elena)).edits).find((e) => e.key === made);
    expect(theirs).toMatchObject({ title: "Two winters in Milan", made: true });
    expect(theirs?.posts.map((p) => p.id).sort()).toEqual(["demo-post-01", "demo-post-03"]);
  });

  it("refuses a row past the database's size, and takes a thousand photographs moved into eras of the member's own", async () => {
    const refused = { code: "23514" };
    const key = (i: number) => `~${String(i).padStart(10, "0")}`;
    // As supabase/tests/07_era_edits.sql tries it.
    const far = Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`post-${i}`, "Lisbon 2023 and a long way after"]));
    await expect(saveEraEdits(DEMO_IDS.elena, { titles: {}, moves: far })).rejects.toMatchObject(refused);
    const names = Object.fromEntries(Array.from({ length: 600 }, (_, i) => [key(i), "é".repeat(30)]));
    await expect(saveEraEdits(DEMO_IDS.elena, { titles: names, moves: {} })).rejects.toMatchObject(refused);
    const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    const moves = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [uuid(i), key(i % 50)]));
    const titles = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [key(i), "A".repeat(60)]));
    await expect(saveEraEdits(DEMO_IDS.elena, { titles, moves })).resolves.toBeUndefined();
    expect(demo.demoFetchEraEdits(DEMO_IDS.elena)).toEqual({ titles, moves });
  });

  it("moves a photograph as the page does, through the cache, and keeps the zone it was read in", async () => {
    client.setQueryData(eraEditsKey(DEMO_IDS.elena), await fetchEraEdits(DEMO_IDS.elena));
    const posts = demo.demoFetchUserPosts(DEMO_IDS.elena);
    await changeEraEdits(client, DEMO_IDS.elena, (e) => moveToEra(e, posts, "demo-post-01", "Milan 2025"));
    const kept = demo.demoFetchEraEdits(DEMO_IDS.elena);
    expect(kept.zone).toBe(HERE);
    const eras = editEras(posts, kept);
    expect(eras.find((e) => e.key === "Milan 2025")?.posts.map((p) => p.id)).toEqual(["demo-post-01", "demo-post-04", "demo-post-03"]);
  });
});
