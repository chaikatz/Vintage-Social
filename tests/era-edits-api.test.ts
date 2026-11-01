import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A member's arrangement of their eras, as the app asks for it and keeps
 * it: what a row, no row, a missing table and a failure read as; the
 * upsert that saves it; a change shown at once and taken back when it
 * does not save; changes made while a save is on its way; and the demo
 * store keeping to the database's rules.
 *
 * The database half (migration 0022) is proven against PostgreSQL in
 * supabase/tests/07_era_edits.sql.
 */

const h = vi.hoisted(() => ({
  demo: false,
  calls: [] as string[],
  read: { data: null as unknown, error: null as unknown },
  saves: [] as { row: unknown; options: unknown; settle: (error: unknown) => void }[],
  /** When set, a save waits until the test settles it. */
  hold: false,
  saveError: null as unknown,
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
          maybeSingle: async () => {
            h.calls.push(`read ${table} ${columns} ${column}=${value}`);
            return h.read;
          },
        }),
      }),
      upsert: (row: unknown, options: unknown) => {
        h.calls.push(`upsert ${table}`);
        if (!h.hold) return Promise.resolve({ error: h.saveError });
        return new Promise((resolve) => h.saves.push({ row, options, settle: (error) => resolve({ error }) }));
      },
    }),
  },
}));

const { ERA_SAVE_FAILED, changeEraEdits, eraEditsKey, fetchEraEdits, saveEraEdits } = await import("@/api/eraEdits");
const { NO_EDITS, editEras, moveToEra, renameEra } = await import("@/utils/eraEdits");
const { errorMessage } = await import("@/utils/errorMessage");
const demo = await import("@/demo/store");
const { DEMO_IDS } = await import("@/demo/fixtures");

const ME = "me";
const key = eraEditsKey(ME);
const tick = () => new Promise((r) => setTimeout(r, 0));

let client: QueryClient;
beforeEach(() => {
  h.demo = false;
  h.calls.length = 0;
  h.read = { data: null, error: null };
  h.saves.length = 0;
  h.hold = false;
  h.saveError = null;
  client = new QueryClient();
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

describe("reading a member's arrangement", () => {
  it("reads their one row, by author", async () => {
    h.read = { data: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: { p1: "Lisbon 2023" } }, error: null };
    await expect(fetchEraEdits("a1")).resolves.toEqual({
      edits: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: { p1: "Lisbon 2023" } },
      ready: true,
    });
    expect(h.calls).toEqual(["read era_edits titles, moves author_id=a1"]);
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
});

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

describe("saving", () => {
  it("upserts the whole arrangement over the member's own row", async () => {
    h.hold = true;
    const saved = saveEraEdits(ME, { titles: { a: "A" }, moves: { p: "a" } });
    await tick();
    expect(h.saves[0].row).toEqual({ author_id: ME, titles: { a: "A" }, moves: { p: "a" } });
    expect(h.saves[0].options).toEqual({ onConflict: "author_id" });
    h.saves[0].settle(null);
    await expect(saved).resolves.toBeUndefined();
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
  const rename = (title: string) => (e: typeof NO_EDITS) => renameEra(e, "Lisbon 2023", title);

  it("is on the page before the server has it, and stays once it does", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    const done = changeEraEdits(client, ME, rename("Lisbon, slowly"));
    expect(client.getQueryData(key)).toEqual({ edits: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: {} }, ready: true });
    await tick();
    expect(h.saves).toHaveLength(1);
    h.saves[0].settle(null);
    await done;
    expect(client.getQueryData(key)).toEqual({ edits: { titles: { "Lisbon 2023": "Lisbon, slowly" }, moves: {} }, ready: true });
  });

  it("is taken back when it does not save, and the failure is passed on once", async () => {
    const before = { titles: { "Kyoto 2024": "Spring" }, moves: {} };
    client.setQueryData(key, { edits: before, ready: true });
    h.saveError = { code: "", message: "TypeError: Network request failed" };
    await expect(changeEraEdits(client, ME, rename("Lisbon, slowly"))).rejects.toBe(h.saveError);
    expect(client.getQueryData(key)).toEqual({ edits: before, ready: true });
  });

  it("made while a save is on its way shows at once and is saved next, the last word last", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    const first = changeEraEdits(client, ME, rename("One"));
    await tick();
    const second = changeEraEdits(client, ME, (e) => renameEra(e, "Kyoto 2024", "Two"));
    await second; // it rides on the save under way
    expect(client.getQueryData<{ edits: typeof NO_EDITS }>(key)?.edits.titles).toEqual({ "Lisbon 2023": "One", "Kyoto 2024": "Two" });
    expect(h.saves).toHaveLength(1);
    h.saves[0].settle(null);
    await tick();
    expect(h.saves).toHaveLength(2);
    expect(h.saves[1].row).toEqual({ author_id: ME, titles: { "Lisbon 2023": "One", "Kyoto 2024": "Two" }, moves: {} });
    h.saves[1].settle(null);
    await first;
    expect(h.calls.filter((c) => c.startsWith("upsert"))).toHaveLength(2);
  });

  it("goes back to what the server last held when a later save fails, keeping what saved before it", async () => {
    client.setQueryData(key, { edits: NO_EDITS, ready: true });
    h.hold = true;
    const first = changeEraEdits(client, ME, rename("One"));
    await tick();
    void changeEraEdits(client, ME, (e) => renameEra(e, "Kyoto 2024", "Two"));
    h.saves[0].settle(null);
    await tick();
    h.saves[1].settle({ code: "", message: "TypeError: Network request failed" });
    await expect(first).rejects.toMatchObject({ message: "TypeError: Network request failed" });
    expect(client.getQueryData<{ edits: typeof NO_EDITS }>(key)?.edits).toEqual({ titles: { "Lisbon 2023": "One" }, moves: {} });
  });

  it("is not made before the arrangement has been read, nor where there is nowhere to keep it", async () => {
    await changeEraEdits(client, ME, rename("One"));
    client.setQueryData(key, { edits: NO_EDITS, ready: false });
    await changeEraEdits(client, ME, rename("One"));
    expect(client.getQueryData(key)).toEqual({ edits: NO_EDITS, ready: false });
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

  it("saves the member's own, whole, and reads it back to an accepted follower", async () => {
    const next = { titles: { "Milan 2025": "The foggy winter" }, moves: { "demo-post-01": "Milan 2025" } };
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

  it("moves a photograph as the page does, through the cache", async () => {
    client.setQueryData(eraEditsKey(DEMO_IDS.elena), await fetchEraEdits(DEMO_IDS.elena));
    const posts = demo.demoFetchUserPosts(DEMO_IDS.elena);
    await changeEraEdits(client, DEMO_IDS.elena, (e) => moveToEra(e, posts, "demo-post-01", "Milan 2025"));
    const eras = editEras(posts, demo.demoFetchEraEdits(DEMO_IDS.elena));
    expect(eras.find((e) => e.key === "Milan 2025")?.posts.map((p) => p.id)).toEqual(["demo-post-01", "demo-post-04", "demo-post-03"]);
  });
});
