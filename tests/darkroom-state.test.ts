import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What the Darkroom keeps on this phone: the history of what it showed,
 * the shelf of prints set aside, the place to come back to, the positions
 * per chapter, and the first-visit flag — and the two ways of forgetting
 * them.
 *
 * The phone is faked in memory: a file system whose files survive a
 * "relaunch" (a fresh import of every module), an app state that can be
 * sent to the background, and an interaction queue that only runs when
 * the test says the animations have finished.
 */

const phone = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: new Map<string, number>(),
  appState: [] as ((state: string) => void)[],
  interactions: [] as (() => void)[],
  libraryLoaded: false,
}));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    addEventListener: (_: string, listener: (state: string) => void) => {
      phone.appState.push(listener);
      return { remove: () => undefined };
    },
  },
  InteractionManager: {
    runAfterInteractions: (task: () => void) => {
      phone.interactions.push(task);
      return { then: () => Promise.resolve(), done: () => undefined, cancel: () => undefined };
    },
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    constructor(readonly uri: string) {}
  }
  class File {
    readonly path: string;
    constructor(dir: Directory, name: string) {
      this.path = `${dir.uri}/${name}`;
    }
    get exists() {
      return phone.files.has(this.path);
    }
    textSync() {
      const text = phone.files.get(this.path);
      if (text == null) throw new Error("No such file");
      return text;
    }
    create() {
      phone.files.set(this.path, "");
    }
    write(text: string) {
      phone.files.set(this.path, text);
      phone.writes.set(this.path, (phone.writes.get(this.path) ?? 0) + 1);
    }
    delete() {
      phone.files.delete(this.path);
    }
  }
  return { File, Paths: { document: new Directory("document"), cache: new Directory("cache") } };
});

// The library itself. Nothing in this file may load it.
vi.mock("expo-media-library", () => {
  phone.libraryLoaded = true;
  return {};
});

import type { Print } from "@/darkroom/types";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Thursday October 22, 2026, 10:00 on this phone's clock. */
const NOW = new Date(2026, 9, 22, 10, 0).getTime();

const HISTORY = "cache/darkroom-history.json";
const OLD_HISTORY = "document/darkroom-history.json";
const SHELF = "document/darkroom-set-aside.json";
const PLACE = "document/darkroom-place.json";
const INTRO = "document/darkroom-intro.json";
const OWNER = "document/darkroom-owner.json";

function print(n: number, over: Partial<Print> = {}): Print {
  return {
    id: `p${n}`,
    uri: `ph://p${n}`,
    width: 4032,
    height: 3024,
    takenAt: new Date(2018, 7, 14, 12).getTime() + n * HOUR,
    subtypes: ["livePhoto"],
    filename: `IMG_${n}.HEIC`,
    ...over,
  };
}

const prints = (count: number) => Array.from({ length: count }, (_, i) => print(i));

function stored(file: string): any {
  const text = phone.files.get(file);
  return text == null ? undefined : JSON.parse(text);
}

function writesTo(file: string): number {
  return phone.writes.get(file) ?? 0;
}

/** Let the animations in flight finish: whatever waited for them runs. */
function settle(): void {
  while (phone.interactions.length) phone.interactions.shift()!();
}

function toBackground(): void {
  for (const l of phone.appState) l("background");
}

/** A fresh start of the app: every module imported anew, the files kept. */
async function launch() {
  vi.resetModules();
  phone.appState.length = 0;
  phone.interactions.length = 0;
  const [history, shelf, session, posted, forget] = await Promise.all([
    import("@/darkroom/history"),
    import("@/darkroom/setAside"),
    import("@/darkroom/session"),
    import("@/darkroom/posted"),
    import("@/darkroom/forget"),
  ]);
  return { history, shelf, session, posted, forget };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  phone.files.clear();
  phone.writes.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

describe("the history file", () => {
  it("keeps only sound entries, and refuses a later version", async () => {
    const { history } = await launch();
    expect(history.parseHistory(null)).toBeNull();
    expect(history.parseHistory([])).toBeNull();
    expect(history.parseHistory({ v: 2, seen: [["a", 1]] })).toBeNull();
    expect(
      history.parseHistory({ v: 1, seen: [["a", 1], ["", 2], ["b", "x"], 3, ["c", Infinity]], developed: "no", dayFinished: "22 Oct" }),
    ).toEqual({ seen: [["a", 1]], developed: [], dayFinished: null });
    // The work-in-progress build wrote no version and no finished day.
    expect(history.parseHistory({ seen: [["a", 1]], developed: [["b", 2]] })).toEqual({
      seen: [["a", 1]],
      developed: [["b", 2]],
      dayFinished: null,
    });
  });

  it("remembers the newest, letting the oldest go past the limit", async () => {
    const { history } = await launch();
    const m = new Map<string, number>();
    history.remember(m, "a", 1, 2);
    history.remember(m, "b", 2, 2);
    history.remember(m, "a", 3, 2);
    history.remember(m, "c", 4, 2);
    expect([...m.keys()]).toEqual(["a", "c"]);

    for (let i = 0; i <= history.SEEN_LIMIT; i++) history.markSeen(`s${i}`, NOW - history.SEEN_LIMIT + i);
    expect(history.seenWithin("s0", 21)).toBe(false);
    expect(history.seenWithin("s1", 21)).toBe(true);
    expect(history.seenWithin(`s${history.SEEN_LIMIT}`, 21)).toBe(true);

    for (let i = 0; i <= history.DEVELOPED_LIMIT; i++) history.recordDeveloped(`d${i}`, NOW - history.DEVELOPED_LIMIT + i);
    expect(history.developedAt("d0")).toBeNull();
    expect(history.developedAt("d1")).not.toBeNull();
  });

  it("lets go of looks older than sixty days, posts older than a year, and stamps from a clock set back", async () => {
    phone.files.set(
      HISTORY,
      JSON.stringify({
        v: 1,
        seen: [["old", NOW - 61 * DAY], ["recent", NOW - 59 * DAY], ["future", NOW + 30 * DAY]],
        developed: [["long-ago", NOW - 366 * DAY], ["this-year", NOW - 300 * DAY]],
        dayFinished: null,
      }),
    );
    const { history } = await launch();
    expect(history.seenWithin("old", 1000)).toBe(false);
    expect(history.seenWithin("recent", 1000)).toBe(true);
    expect(history.seenWithin("future", 1000)).toBe(false);
    expect(history.developedAt("long-ago")).toBeNull();
    expect(history.developedAt("this-year")).toBe(NOW - 300 * DAY);

    // What was let go on the way in leaves the file at the next write.
    history.flushHistory();
    settle();
    expect(stored(HISTORY)).toEqual({
      v: 1,
      seen: [["recent", NOW - 59 * DAY]],
      developed: [["this-year", NOW - 300 * DAY]],
      dayFinished: null,
    });
  });

  it("counts a look for the quiet window, and never at zero days", async () => {
    const { history } = await launch();
    history.markSeen("a", NOW - 20 * DAY);
    expect(history.seenWithin("a", history.QUIET_DAYS)).toBe(true);
    expect(history.seenWithin("a", 10)).toBe(false);
    expect(history.seenWithin("a", 0)).toBe(false);
    expect(history.seenWithin("never", 21)).toBe(false);

    history.recordDeveloped("b", NOW - 364 * DAY);
    expect(history.developedRecently("b")).toBe(true);
    expect(history.developedRecently("b", NOW + 2 * DAY)).toBe(false);
    expect(history.developedRecently("b", NOW, 30)).toBe(false);
  });

  it("writes in the cache folder, only after every twenty-five marks, and only once the animations finish", async () => {
    const { history } = await launch();
    for (let i = 0; i < 24; i++) history.markSeen(`p${i}`);
    settle();
    expect(stored(HISTORY)).toBeUndefined();

    history.markSeen("p24");
    // Asked for, but waiting for the page turn in flight.
    expect(phone.interactions).toHaveLength(1);
    expect(stored(HISTORY)).toBeUndefined();
    settle();
    expect(stored(HISTORY).seen).toHaveLength(25);
    expect(phone.files.has(OLD_HISTORY)).toBe(false);
    expect(writesTo(HISTORY)).toBe(1);

    // The count starts again from the write.
    for (let i = 25; i < 49; i++) history.markSeen(`p${i}`);
    settle();
    expect(writesTo(HISTORY)).toBe(1);
    history.markSeen("p49");
    settle();
    expect(writesTo(HISTORY)).toBe(2);
    expect(stored(HISTORY).seen).toHaveLength(50);
  });

  it("writes when the app leaves the foreground, and when the room asks", async () => {
    const { history } = await launch();
    history.markSeen("a");
    toBackground();
    settle();
    expect(stored(HISTORY).seen.map((e: [string, number]) => e[0])).toEqual(["a"]);

    history.markSeen("b");
    history.flushHistory();
    history.flushHistory();
    // Two asks while one waits are one write.
    expect(phone.interactions).toHaveLength(1);
    settle();
    expect(writesTo(HISTORY)).toBe(2);

    // Nothing new: nothing to write.
    history.flushHistory();
    toBackground();
    settle();
    expect(writesTo(HISTORY)).toBe(2);
  });

  it("remembers the day On this day was finished, across a relaunch", async () => {
    let { history } = await launch();
    expect(history.localDay(new Date(2026, 0, 5, 23, 59).getTime())).toBe("2026-01-05");
    expect(history.localDay(new Date(2026, 0, 6, 0, 1).getTime())).toBe("2026-01-06");
    expect(history.localDay()).toBe("2026-10-22");
    expect(history.dayFinished()).toBeNull();

    history.finishDay("not a day");
    expect(history.dayFinished()).toBeNull();
    history.finishDay(history.localDay());
    expect(history.dayFinished()).toBe("2026-10-22");
    toBackground();
    settle();

    ({ history } = await launch());
    expect(history.dayFinished()).toBe("2026-10-22");
  });

  it("takes over the work-in-progress copy in Documents, then deletes it", async () => {
    phone.files.set(OLD_HISTORY, JSON.stringify({ seen: [["a", NOW - DAY]], developed: [] }));
    const { history } = await launch();
    expect(history.seenWithin("a", 21)).toBe(true);
    expect(phone.files.has(OLD_HISTORY)).toBe(true);
    toBackground();
    settle();
    expect(stored(HISTORY).seen).toEqual([["a", NOW - DAY]]);
    expect(phone.files.has(OLD_HISTORY)).toBe(false);
  });

  it("keeps identifiers and times, and nothing else", async () => {
    const { history } = await launch();
    history.markSeen(print(1).id);
    history.recordDeveloped(print(2).id);
    history.finishDay("2026-10-22");
    history.flushHistory();
    settle();
    expect(stored(HISTORY)).toEqual({ v: 1, seen: [["p1", NOW]], developed: [["p2", NOW]], dayFinished: "2026-10-22" });
  });
});

// ---------------------------------------------------------------------------
// Set aside
// ---------------------------------------------------------------------------

describe("set aside", () => {
  it("sets aside and puts back, newest first, written at once", async () => {
    const { shelf } = await launch();
    expect(shelf.toggleSetAside(print(1), NOW - 2)).toBe("on");
    expect(shelf.toggleSetAside(print(2), NOW - 1)).toBe("on");
    expect(shelf.setAsidePrints().map((p) => p.id)).toEqual(["p2", "p1"]);
    expect(shelf.isSetAside("p1")).toBe(true);
    expect(writesTo(SHELF)).toBe(2);

    // Only the six fields §7.3 names: no subtypes, never the file name.
    expect(stored(SHELF)).toEqual([
      { id: "p2", uri: "ph://p2", width: 4032, height: 3024, takenAt: print(2).takenAt, setAsideAt: NOW - 1 },
      { id: "p1", uri: "ph://p1", width: 4032, height: 3024, takenAt: print(1).takenAt, setAsideAt: NOW - 2 },
    ]);

    expect(shelf.toggleSetAside(print(1))).toBe("off");
    expect(shelf.isSetAside("p1")).toBe(false);
    expect(stored(SHELF).map((p: { id: string }) => p.id)).toEqual(["p2"]);

    shelf.putBack("p2");
    expect(shelf.setAsidePrints()).toEqual([]);
    const before = writesTo(SHELF);
    shelf.putBack("never-set-aside");
    expect(writesTo(SHELF)).toBe(before);
  });

  it("comes back after a relaunch", async () => {
    let { shelf } = await launch();
    shelf.toggleSetAside(print(1));
    ({ shelf } = await launch());
    expect(shelf.isSetAside("p1")).toBe(true);
    expect(shelf.setAsidePrints()[0]).toMatchObject({ id: "p1", uri: "ph://p1", subtypes: [] });
  });

  it("refuses the 501st and changes nothing", async () => {
    phone.files.set(
      SHELF,
      JSON.stringify(
        Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, uri: `ph://s${i}`, width: 1, height: 1, takenAt: 0, setAsideAt: NOW - i })),
      ),
    );
    const { shelf } = await launch();
    expect(shelf.setAsidePrints()).toHaveLength(shelf.SET_ASIDE_LIMIT);
    const file = phone.files.get(SHELF);
    const list = shelf.setAsidePrints();

    expect(shelf.toggleSetAside(print(1))).toBe("full");
    expect(shelf.isSetAside("p1")).toBe(false);
    expect(shelf.setAsidePrints()).toBe(list);
    expect(phone.files.get(SHELF)).toBe(file);
    expect(writesTo(SHELF)).toBe(0);
    // The oldest was not let go to make room.
    expect(shelf.isSetAside("s499")).toBe(true);

    // Putting one back still works at the cap, and then there is room.
    expect(shelf.toggleSetAside({ ...print(9), id: "s0" })).toBe("off");
    expect(shelf.toggleSetAside(print(1))).toBe("on");
    expect(shelf.setAsidePrints()).toHaveLength(500);
  });

  it("lets go of prints the library no longer has, and says how many once", async () => {
    const { shelf } = await launch();
    for (const n of [1, 2, 3]) shelf.toggleSetAside(print(n));
    expect(shelf.takePrunedNote()).toBe(0);

    expect(shelf.pruneSetAside(["p1", "not-on-the-shelf"])).toBe(1);
    expect(shelf.setAsidePrints().map((p) => p.id)).toEqual(["p3", "p2"]);
    expect(stored(SHELF).map((p: { id: string }) => p.id)).toEqual(["p3", "p2"]);
    expect(shelf.pruneSetAside(["p2"])).toBe(1);
    expect(shelf.pruneSetAside([])).toBe(0);
    expect(shelf.pruneSetAside(["gone"])).toBe(0);

    expect(shelf.takePrunedNote()).toBe(2);
    expect(shelf.takePrunedNote()).toBe(0);
  });

  it("reads a file with repeats or junk as only its sound entries, newest first", async () => {
    const { shelf } = await launch();
    expect(shelf.parseSetAside({})).toBeNull();
    expect(
      shelf.parseSetAside([
        { id: "a", uri: "ph://a", width: 1, height: 1, takenAt: 0, setAsideAt: 1 },
        { id: "b", uri: "ph://b", width: 1, height: 1, takenAt: 0, setAsideAt: 2 },
        { id: "a", uri: "ph://a", width: 1, height: 1, takenAt: 0, setAsideAt: 3 },
        { id: "c", uri: null, width: 1, height: 1, takenAt: 0, setAsideAt: 4 },
        "junk",
      ])?.map((p) => p.id),
    ).toEqual(["b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// The place
// ---------------------------------------------------------------------------

describe("the place", () => {
  it("is kept in memory until flushed, then on disk in exactly its own shape", async () => {
    const { session } = await launch();
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: prints(3) });
    expect(phone.files.has(PLACE)).toBe(false);
    expect(session.readPlace()?.index).toBe(1);

    session.flushPlace();
    expect(stored(PLACE)).toEqual({
      v: 1,
      mode: "surprise",
      year: null,
      month: 0,
      index: 1,
      deck: prints(3).map((p) => ({ id: p.id, uri: p.uri, w: p.width, h: p.height, t: p.takenAt })),
      savedAt: NOW,
      day: "2026-10-22",
    });
    // Nothing changed since: no second write.
    session.flushPlace();
    expect(writesTo(PLACE)).toBe(1);
  });

  it("trims the deck to twenty behind and 120 in all, and re-bases the index", async () => {
    const { session } = await launch();
    const all = prints(200);

    session.savePlace({ mode: "year", year: 2018, month: 7, index: 150, prints: all });
    let p = session.readPlace()!;
    expect(p.deck).toHaveLength(70);
    expect(p.deck[0].id).toBe("p130");
    expect(p.index).toBe(20);
    expect(p.deck[p.index].id).toBe("p150");

    session.savePlace({ mode: "year", year: 2018, month: 7, index: 30, prints: all });
    p = session.readPlace()!;
    expect(p.deck).toHaveLength(120);
    expect(p.deck[0].id).toBe("p10");
    expect(p.deck[p.index].id).toBe("p30");

    session.savePlace({ mode: "year", year: 2018, month: 7, index: 5, prints: all });
    p = session.readPlace()!;
    expect(p.deck[0].id).toBe("p0");
    expect(p.index).toBe(5);

    // Standing on the end page: one past the last print, twenty behind it.
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 24, prints: prints(24) });
    p = session.readPlace()!;
    expect(p.deck).toHaveLength(20);
    expect(p.deck[0].id).toBe("p4");
    expect(p.index).toBe(p.deck.length);
    // An index past the end is read as the end.
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 99, prints: prints(24) });
    expect(session.readPlace()!.index).toBe(20);

    // The deck keeps no subtypes or file names.
    expect(p.deck[0]).toEqual({ id: "p4", uri: "ph://p4", width: 4032, height: 3024, takenAt: print(4).takenAt, subtypes: [] });
  });

  it("is offered back after a relaunch within twelve hours, and not after", async () => {
    let { session } = await launch();
    session.savePlace({ mode: "year", year: 2018, month: 7, index: 2, prints: prints(5) });
    session.flushPlace();

    ({ session } = await launch());
    const back = session.readPlace(NOW + 11 * HOUR);
    expect(back).toMatchObject({ mode: "year", year: 2018, month: 7, index: 2, savedAt: NOW });
    expect(back?.deck.map((d) => d.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);

    ({ session } = await launch());
    expect(session.readPlace(NOW + 12 * HOUR)).toBeNull();
    // A stale place is deleted, not just passed over.
    expect(phone.files.has(PLACE)).toBe(false);
  });

  it("offers an On this day place back only on the same local day", async () => {
    const late = new Date(2026, 9, 22, 23, 0).getTime();
    let { session } = await launch();
    session.savePlace({ mode: "on-this-day", year: null, month: 0, index: 0, prints: prints(4) }, late);
    session.flushPlace();
    ({ session } = await launch());
    expect(session.readPlace(late + 30 * 60_000)?.mode).toBe("on-this-day");
    ({ session } = await launch());
    expect(session.readPlace(late + 90 * 60_000)).toBeNull();

    // Any other chapter crosses midnight within its twelve hours.
    ({ session } = await launch());
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 0, prints: prints(4) }, late);
    session.flushPlace();
    ({ session } = await launch());
    expect(session.readPlace(late + 90 * 60_000)?.mode).toBe("surprise");
  });

  it("clears itself when the chapter it was given holds nothing", async () => {
    const { session } = await launch();
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 0, prints: prints(3) });
    session.flushPlace();
    session.savePlace({ mode: "set-aside", year: null, month: 0, index: 0, prints: [] });
    expect(session.readPlace()).toBeNull();
    session.flushPlace();
    expect(phone.files.has(PLACE)).toBe(false);
  });

  it("reads a damaged deck as its sound prints, still pointing at the same one", async () => {
    const { session } = await launch();
    const entry = (n: number) => ({ id: `p${n}`, uri: `ph://p${n}`, w: 3, h: 2, t: n });
    const raw = { v: 1, mode: "surprise", year: null, month: 0, index: 2, deck: [entry(0), { id: 5 }, entry(2), entry(3)], savedAt: NOW, day: "2026-10-22" };
    const p = session.parsePlace(raw)!;
    expect(p.deck.map((d) => d.id)).toEqual(["p0", "p2", "p3"]);
    expect(p.deck[p.index].id).toBe("p2");
    expect(session.parsePlace({ ...raw, v: 2 })).toBeNull();
    expect(session.parsePlace({ ...raw, mode: "year" })).toBeNull();
    expect(session.parsePlace({ ...raw, deck: [] })).toBeNull();
    expect(session.parsePlace({ ...raw, index: -1 })).toBeNull();
  });

  it("gives the Post tab its line from the file, never from the library", async () => {
    let { session } = await launch();
    expect(session.placeLine()).toBeNull();
    const deck = [
      print(0, { takenAt: new Date(2016, 2, 3).getTime() }),
      print(1, { takenAt: new Date(2018, 7, 14).getTime() }),
    ];
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: deck });
    session.flushPlace();

    ({ session } = await launch());
    expect(session.placeLine(NOW + HOUR)).toBe("You left off in August 2018.");
    expect(phone.libraryLoaded).toBe(false);

    // At the end page, the last print shown.
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 2, prints: deck });
    expect(session.placeLine()).toBe("You left off in August 2018.");
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 0, prints: deck });
    expect(session.placeLine()).toBe("You left off in March 2016.");

    expect(session.placeLine(NOW + 13 * HOUR)).toBeNull();
  });

  it("moves on past a posted print, and writes", async () => {
    const { session } = await launch();
    session.savePlace({ mode: "year", year: 2018, month: 7, index: 1, prints: prints(4) });
    session.flushPlace();

    session.advancePlace("p3");
    expect(session.readPlace()?.index).toBe(1);

    session.advancePlace("p1");
    expect(session.readPlace()?.index).toBe(2);
    expect(stored(PLACE).index).toBe(2);
    // The time it was saved is the member's, not the post's.
    expect(stored(PLACE).savedAt).toBe(NOW);
  });

  it("does not let a room that has not heard of the post undo the move", async () => {
    const { session } = await launch();
    const deck = prints(4);
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: deck });
    session.flushPlace();
    session.advancePlace("p1");

    // The room under compose writes its own, older, idea of the place.
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: deck });
    session.flushPlace();
    expect(stored(PLACE).index).toBe(2);
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: deck });
    expect(session.readPlace()?.index).toBe(2);

    // A new visit that goes back to the posted print stays there.
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: deck });
    expect(session.readPlace()?.index).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Positions per chapter
// ---------------------------------------------------------------------------

describe("positions per chapter", () => {
  const position = (index: number) => ({ prints: prints(5), index, reader: { name: "reader" }, more: true, reach: null });

  it("names each chapter, a year by its starting month", async () => {
    const { session } = await launch();
    expect(session.chapterKey("on-this-day", null, 0)).toBe("on-this-day");
    expect(session.chapterKey("surprise", 2016, 3)).toBe("surprise");
    expect(session.chapterKey("set-aside", null, 0)).toBe("set-aside");
    expect(session.chapterKey("year", 2016, 7)).toBe("year:2016:7");
  });

  it("goes On this day → 2016 → On this day and comes back to the same print", async () => {
    const { session } = await launch();
    const day = position(3);
    session.keepChapter("on-this-day", day);
    session.keepChapter("year:2016:0", position(1));
    expect(session.recallChapter("on-this-day")).toBe(day);
    expect(session.recallChapter("on-this-day")?.reader).toEqual({ name: "reader" });
    expect(session.recallChapter("year:2016:7")).toBeNull();
  });

  it("keeps only the last few chapters", async () => {
    const { session } = await launch();
    for (let y = 0; y <= session.CHAPTERS_KEPT; y++) session.keepChapter(`year:${2000 + y}:0`, position(y));
    expect(session.recallChapter("year:2000:0")).toBeNull();
    expect(session.recallChapter(`year:${2000 + session.CHAPTERS_KEPT}:0`)?.index).toBe(session.CHAPTERS_KEPT);
  });

  it("lets a position go with the same rule as the place", async () => {
    const { session } = await launch();
    session.keepChapter("surprise", position(2));
    session.keepChapter("on-this-day", position(2), new Date(2026, 9, 21, 23).getTime());
    expect(session.recallChapter("on-this-day")).toBeNull();
    expect(session.recallChapter("surprise", NOW + 11 * HOUR)?.index).toBe(2);
    expect(session.recallChapter("surprise", NOW + 12 * HOUR)).toBeNull();
  });

  it("is in memory only, and gone at a relaunch", async () => {
    let { session } = await launch();
    session.keepChapter("surprise", position(2));
    session.forgetChapters();
    expect(session.recallChapter("surprise")).toBeNull();
    session.keepChapter("surprise", position(2));
    ({ session } = await launch());
    expect(session.recallChapter("surprise")).toBeNull();
    expect([...phone.files.keys()]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The first-visit page
// ---------------------------------------------------------------------------

describe("the first-visit flag", () => {
  it("is written once to darkroom-intro.json and read back after a relaunch", async () => {
    let { session } = await launch();
    expect(session.introSeen()).toBe(false);
    session.markIntroSeen();
    expect(session.introSeen()).toBe(true);
    expect(stored(INTRO)).toBe(true);
    ({ session } = await launch());
    expect(session.introSeen()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Posting what was developed
// ---------------------------------------------------------------------------

describe("markDeveloped", () => {
  it("records the post, takes it off the shelf and moves the place on, writing each file once", async () => {
    const { history, shelf, session, posted } = await launch();
    const deck = prints(4);
    shelf.toggleSetAside(deck[1]);
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: deck });
    session.flushPlace();
    session.keepChapter("surprise", { prints: deck, index: 1, reader: null, more: true, reach: null });
    const before = { shelf: writesTo(SHELF), place: writesTo(PLACE) };

    posted.markDeveloped("p1");
    settle();

    expect(history.developedAt("p1")).toBe(NOW);
    expect(history.developedRecently("p1")).toBe(true);
    expect(stored(HISTORY).developed).toEqual([["p1", NOW]]);
    expect(shelf.isSetAside("p1")).toBe(false);
    expect(stored(SHELF)).toEqual([]);
    expect(stored(PLACE).index).toBe(2);
    expect(session.recallChapter("surprise")?.index).toBe(2);
    expect(writesTo(HISTORY)).toBe(1);
    expect(writesTo(SHELF) - before.shelf).toBe(1);
    expect(writesTo(PLACE) - before.place).toBe(1);
  });

  it("leaves the shelf and the place alone when the post was neither", async () => {
    const { history, shelf, session, posted } = await launch();
    shelf.toggleSetAside(print(7));
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 0, prints: prints(3) });
    session.flushPlace();
    const before = { shelf: writesTo(SHELF), place: writesTo(PLACE) };

    posted.markDeveloped("p2");
    settle();
    expect(history.developedAt("p2")).toBe(NOW);
    expect(shelf.isSetAside("p7")).toBe(true);
    expect(session.readPlace()?.index).toBe(0);
    expect(writesTo(SHELF)).toBe(before.shelf);
    expect(writesTo(PLACE)).toBe(before.place);
  });

  it("works from the place on disk, with the room long gone", async () => {
    let { session, posted } = await launch();
    session.savePlace({ mode: "year", year: 2018, month: 7, index: 0, prints: prints(3) });
    session.flushPlace();
    ({ session, posted } = await launch());
    posted.markDeveloped("p0");
    expect(stored(PLACE).index).toBe(1);
    expect(session.placeLine()).toBe(`You left off in August 2018.`);
  });
});

// ---------------------------------------------------------------------------
// Forgetting
// ---------------------------------------------------------------------------

/** A phone with something in every file, kept for member "a". */
async function filled() {
  const app = await launch();
  const { history, shelf, session, forget } = app;
  forget.claimDarkroom("a");
  history.markSeen("p1");
  history.recordDeveloped("p2");
  history.finishDay("2026-10-22");
  history.flushHistory();
  settle();
  shelf.toggleSetAside(print(3));
  session.savePlace({ mode: "surprise", year: null, month: 0, index: 0, prints: prints(3) });
  session.flushPlace();
  session.keepChapter("surprise", { prints: prints(3), index: 0, reader: null, more: true, reach: null });
  session.markIntroSeen();
  expect([...phone.files.keys()].sort()).toEqual([HISTORY, INTRO, SHELF, PLACE, OWNER].sort());
  return app;
}

describe("forgetting", () => {
  it("at sign-out, deletes every file, the owner's too, and clears memory, chapters included", async () => {
    const { history, shelf, session, forget } = await filled();
    forget.forgetDarkroom();
    expect([...phone.files.keys()]).toEqual([]);
    expect(history.seenWithin("p1", 21)).toBe(false);
    expect(history.developedAt("p2")).toBeNull();
    expect(history.dayFinished()).toBeNull();
    expect(shelf.setAsidePrints()).toEqual([]);
    expect(session.readPlace()).toBeNull();
    expect(session.placeLine()).toBeNull();
    expect(session.recallChapter("surprise")).toBeNull();
    expect(session.introSeen()).toBe(false);

    // And nothing comes back at the next launch.
    const again = await launch();
    expect(again.shelf.isSetAside("p3")).toBe(false);
    expect(again.session.introSeen()).toBe(false);
    expect(again.history.developedAt("p2")).toBeNull();
  });

  it("from Settings, forgets what was shown, posted and where the member was, and keeps the shelf", async () => {
    const { history, shelf, session, forget } = await filled();
    forget.forgetDarkroomHistory();
    expect([...phone.files.keys()].sort()).toEqual([INTRO, SHELF, OWNER].sort());
    expect(history.seenWithin("p1", 21)).toBe(false);
    expect(history.developedAt("p2")).toBeNull();
    expect(history.dayFinished()).toBeNull();
    expect(session.readPlace()).toBeNull();
    expect(session.recallChapter("surprise")).toBeNull();
    expect(shelf.isSetAside("p3")).toBe(true);
    expect(session.introSeen()).toBe(true);

    // The member is still signed in, so what they look at next is kept as before.
    history.markSeen("p9");
    history.flushHistory();
    settle();
    expect(stored(HISTORY).seen.map((e: [string, number]) => e[0])).toEqual(["p9"]);
  });

  it("never writes back what a waiting flush still held", async () => {
    const { history, forget } = await launch();
    history.markSeen("p1");
    history.flushHistory();
    forget.forgetDarkroom();
    settle();
    expect(phone.files.has(HISTORY)).toBe(false);
  });
});

describe("whose the Darkroom is", () => {
  it("is kept beside the files, as the member's id and nothing else", async () => {
    await filled();
    expect(stored(OWNER)).toEqual({ v: 1, id: "a" });
    const { forget } = await launch();
    expect(forget.parseOwner({ v: 1, id: "a" })).toBe("a");
    for (const junk of [null, "a", ["a"], { id: "a" }, { v: 2, id: "a" }, { v: 1, id: "" }, { v: 1, id: 7 }]) {
      expect(forget.parseOwner(junk)).toBeNull();
    }
  });

  it("survives a launch with nobody signed in, and the same member comes back to all of it", async () => {
    await filled();
    // Offline, with the access token expired: nobody is signed in for a
    // while, and nothing is forgotten for it.
    const app = await launch();
    expect([...phone.files.keys()].sort()).toEqual([HISTORY, INTRO, SHELF, PLACE, OWNER].sort());
    // The token refreshes: the same member, with the shelf, the place, the
    // first-visit page passed and the history all still there.
    app.forget.claimDarkroom("a");
    expect(app.shelf.isSetAside("p3")).toBe(true);
    expect(app.session.placeLine()).toBe("You left off in August 2018.");
    expect(app.session.introSeen()).toBe(true);
    expect(app.history.developedAt("p2")).not.toBeNull();
    expect(writesTo(OWNER)).toBe(1);
  });

  it("is forgotten, memory and all, before a different member sees any of it", async () => {
    const { history, shelf, session, forget } = await filled();
    forget.claimDarkroom("b");
    expect([...phone.files.keys()]).toEqual([OWNER]);
    expect(stored(OWNER)).toEqual({ v: 1, id: "b" });
    expect(shelf.setAsidePrints()).toEqual([]);
    expect(session.placeLine()).toBeNull();
    expect(session.recallChapter("surprise")).toBeNull();
    expect(session.introSeen()).toBe(false);
    expect(history.seenWithin("p1", 21)).toBe(false);
    expect(history.developedAt("p2")).toBeNull();

    // And after a launch whose session had ended while the app was closed.
    await filled();
    const app = await launch();
    app.forget.claimDarkroom("b");
    expect([...phone.files.keys()]).toEqual([OWNER]);
    expect(app.shelf.isSetAside("p3")).toBe(false);
    expect(app.session.placeLine()).toBeNull();
  });

  it("is forgotten when no owner is on record: files from before the record belong to nobody", async () => {
    await filled();
    phone.files.delete(OWNER);
    const app = await launch();
    app.forget.claimDarkroom("a");
    expect([...phone.files.keys()]).toEqual([OWNER]);
    expect(app.shelf.setAsidePrints()).toEqual([]);
  });

  it("keeps what is not yet on disk when the member already on record claims it again", async () => {
    const { history, forget } = await filled();
    history.markSeen("p7");
    forget.claimDarkroom("a");
    expect(history.seenWithin("p7", 21)).toBe(true);
    history.flushHistory();
    settle();
    expect(stored(HISTORY).seen.map((e: [string, number]) => e[0])).toContain("p7");
  });
});

describe("a room still open when the session ends", () => {
  it("writes nothing back after the forgetting, and the next member finds none of it", async () => {
    const { history, shelf, session, posted, forget } = await filled();
    // auth says SIGNED_OUT while the room is on top of the stack.
    forget.forgetDarkroom();
    expect([...phone.files.keys()]).toEqual([]);

    // The room goes on: pages settle, prints are looked at, set aside and
    // posted, and then it is put away as it is left and the app goes to
    // the background.
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 2, prints: prints(6) });
    session.keepChapter("surprise", { prints: prints(6), index: 2, reader: null, more: true, reach: null });
    for (let i = 0; i < 30; i++) history.markSeen(`q${i}`);
    history.finishDay("2026-10-22");
    shelf.toggleSetAside(print(4));
    session.markIntroSeen();
    posted.markDeveloped("p5");
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 3, prints: prints(6) });
    session.flushPlace();
    history.flushHistory();
    settle();
    toBackground();
    settle();
    expect([...phone.files.keys()]).toEqual([]);
    // On screen it still behaves, for the moment before the door.
    expect(shelf.isSetAside("p4")).toBe(true);

    // The next member signs in.
    forget.claimDarkroom("b");
    expect([...phone.files.keys()]).toEqual([OWNER]);
    expect(session.placeLine()).toBeNull();
    expect(session.readPlace()).toBeNull();
    expect(session.recallChapter("surprise")).toBeNull();
    expect(session.introSeen()).toBe(false);
    expect(shelf.setAsidePrints()).toEqual([]);
    expect(history.seenWithin("q0", 21)).toBe(false);
    expect(history.developedAt("p5")).toBeNull();
    expect(history.dayFinished()).toBeNull();

    // And what they do is kept as before.
    shelf.toggleSetAside(print(7));
    expect(stored(SHELF).map((p: { id: string }) => p.id)).toEqual(["p7"]);
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 1, prints: prints(2) });
    session.flushPlace();
    expect(stored(PLACE).deck.map((p: { id: string }) => p.id)).toEqual(["p0", "p1"]);
    history.markSeen("p8");
    history.flushHistory();
    settle();
    expect(stored(HISTORY).seen.map((e: [string, number]) => e[0])).toEqual(["p8"]);
    session.markIntroSeen();
    expect(stored(INTRO)).toBe(true);
  });

  it("never writes a flush that was waiting when the forgetting came", async () => {
    const { history, forget } = await launch();
    forget.claimDarkroom("a");
    history.markSeen("p1");
    history.flushHistory();
    forget.forgetDarkroom();
    history.markSeen("q1");
    settle();
    expect(phone.files.has(HISTORY)).toBe(false);
  });

  it("opens again for the same member after a sign-out that never reached the server", async () => {
    const { history, shelf, forget } = await filled();
    // "Sign out" forgot it, but auth kept the session: the same member is heard from again.
    forget.forgetDarkroom();
    forget.claimDarkroom("a");
    expect(shelf.setAsidePrints()).toEqual([]);
    shelf.toggleSetAside(print(9));
    expect(stored(SHELF).map((p: { id: string }) => p.id)).toEqual(["p9"]);
    history.markSeen("p9");
    history.flushHistory();
    settle();
    expect(stored(HISTORY).seen.map((e: [string, number]) => e[0])).toEqual(["p9"]);
  });

  it("lets go of what was kept in memory while shut, even when the owner's file outlived the forgetting", async () => {
    const { history, shelf, session, forget } = await filled();
    forget.forgetDarkroom();
    session.savePlace({ mode: "surprise", year: null, month: 0, index: 2, prints: prints(6) });
    session.keepChapter("surprise", { prints: prints(6), index: 2, reader: null, more: true, reach: null });
    session.markIntroSeen();
    history.markSeen("q1");
    shelf.toggleSetAside(print(4));
    // The delete of the owner's file failed; the next claim matches it.
    phone.files.set(OWNER, JSON.stringify({ v: 1, id: "a" }));
    forget.claimDarkroom("a");
    expect(session.readPlace()).toBeNull();
    expect(session.recallChapter("surprise")).toBeNull();
    expect(session.introSeen()).toBe(false);
    expect(history.seenWithin("q1", 21)).toBe(false);
    expect(shelf.setAsidePrints()).toEqual([]);
    expect([...phone.files.keys()]).toEqual([OWNER]);
  });

  it("never lets a flush that waited across the forgetting write the last member's marks for the next", async () => {
    const { history, forget } = await launch();
    forget.claimDarkroom("a");
    history.markSeen("p1");
    history.flushHistory();
    forget.forgetDarkroom();
    forget.claimDarkroom("b");
    settle();
    expect(phone.files.has(HISTORY)).toBe(false);
    expect(history.seenWithin("p1", 21)).toBe(false);
  });

  it("stays shut across nothing: a launch after it writes as usual once someone claims it", async () => {
    const first = await filled();
    first.forget.forgetDarkroom();
    const app = await launch();
    app.forget.claimDarkroom("a");
    app.shelf.toggleSetAside(print(1));
    expect(stored(SHELF).map((p: { id: string }) => p.id)).toEqual(["p1"]);
  });
});

// ---------------------------------------------------------------------------
// Who is signed in, as the auth client the app ships tells it
// ---------------------------------------------------------------------------

/**
 * The provider forgets the Darkroom on SIGNED_OUT and lets whoever is
 * signed in claim it. That is only right if auth-js says SIGNED_OUT for a
 * session that has really left the phone, and never for a refresh that
 * failed for want of a network. These run the real client against a
 * server out of reach, one that refuses the refresh token, and one that
 * answers again, with the provider's two rules subscribed to it.
 */
describe("the auth client the provider listens to", () => {
  const KEY = "sb-test-auth-token";
  type Answer = "offline" | "refused" | "online";

  function user(id: string) {
    return { id, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "" };
  }

  function json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }

  async function until(check: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 5));
  }

  async function openApp(answer: { now: Answer }) {
    const app = await filled();
    const { AuthClient } = await import("@supabase/supabase-js");
    // Closed for three hours: the access token has run out, the refresh token has not.
    const keychain = new Map<string, string>([
      [
        KEY,
        JSON.stringify({
          access_token: "old",
          refresh_token: "r1",
          token_type: "bearer",
          expires_in: 3600,
          expires_at: Math.floor(Date.now() / 1000) - 3 * 3600,
          user: user("a"),
        }),
      ],
    ]);
    const network = async (): Promise<Response> => {
      if (answer.now === "offline") {
        // Out of reach for longer than the client keeps retrying.
        vi.setSystemTime(Date.now() + 60_000);
        throw new TypeError("Network request failed");
      }
      if (answer.now === "refused") {
        return json(400, { code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token: Refresh Token Not Found" });
      }
      const at = Math.floor(Date.now() / 1000);
      return json(200, {
        access_token: "new",
        refresh_token: "r2",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: at + 3600,
        user: user("a"),
      });
    };
    const client = new AuthClient({
      url: "https://vintage.invalid/auth/v1",
      storageKey: KEY,
      storage: {
        getItem: async (k: string) => keychain.get(k) ?? null,
        setItem: async (k: string, v: string) => void keychain.set(k, v),
        removeItem: async (k: string) => void keychain.delete(k),
      },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      fetch: network,
    });
    const events: string[] = [];
    // The provider's two rules: forget on SIGNED_OUT, and whoever is signed in claims it.
    const { data: sub } = client.onAuthStateChange((event, next) => {
      events.push(event);
      if (event === "SIGNED_OUT") app.forget.forgetDarkroom();
      if (next?.user?.id) app.forget.claimDarkroom(next.user.id);
    });
    const close = async () => {
      sub.subscription.unsubscribe();
      await client.stopAutoRefresh();
    };
    return { app, client, keychain, events, close };
  }

  let quiet: { mockRestore: () => void } | null = null;
  beforeEach(() => {
    // The client warns about a refresh that could not reach the server.
    quiet = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    quiet?.mockRestore();
  });

  it("offline with an expired token: nobody for now, no SIGNED_OUT, the session kept and the Darkroom with it", async () => {
    const answer = { now: "offline" as Answer };
    const { app, client, keychain, events, close } = await openApp(answer);
    try {
      const { data } = await client.getSession();
      await until(() => events.includes("INITIAL_SESSION"));
      expect(data.session).toBeNull();
      expect(events).not.toContain("SIGNED_OUT");
      expect(keychain.has(KEY)).toBe(true);
      expect([...phone.files.keys()].sort()).toEqual([HISTORY, INTRO, SHELF, PLACE, OWNER].sort());

      // The network comes back: the same member, and the shelf is still there.
      answer.now = "online";
      vi.setSystemTime(Date.now() + 5 * 60_000);
      const back = await client.getSession();
      await until(() => events.includes("TOKEN_REFRESHED"));
      expect(back.data.session?.user.id).toBe("a");
      expect(events).not.toContain("SIGNED_OUT");
      expect(app.shelf.isSetAside("p3")).toBe(true);
      expect(stored(SHELF).map((p: { id: string }) => p.id)).toEqual(["p3"]);
      expect(app.session.introSeen()).toBe(true);
    } finally {
      await close();
    }
  });

  it("a refresh token the server refuses: SIGNED_OUT, the session gone, and the Darkroom forgotten", async () => {
    const { client, keychain, events, close } = await openApp({ now: "refused" });
    try {
      const { data } = await client.getSession();
      await until(() => events.includes("SIGNED_OUT"));
      expect(data.session).toBeNull();
      expect(events).toContain("SIGNED_OUT");
      expect(keychain.has(KEY)).toBe(false);
      expect([...phone.files.keys()]).toEqual([]);
    } finally {
      await close();
    }
  });
});

// ---------------------------------------------------------------------------
// Guards on the files these modules feed
// ---------------------------------------------------------------------------

describe("guards", () => {
  const read = (file: string) => readFileSync(path.resolve(import.meta.dirname, "..", file), "utf8");

  it("compose never puts the developed photograph in the image cache on disk", () => {
    const compose = read("app/compose.tsx");
    const images = compose.match(/<Image\s+source=\{uri\}[^>]*\/>/g) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toMatch(/cachePolicy="(memory|none)"/);
    expect(compose).toMatch(/import \{ markDeveloped \} from "@\/darkroom\/posted"/);
  });

  it("the session provider claims the Darkroom in both providers, and forgets it only when a session ends", () => {
    const provider = read("src/providers/SessionProvider.tsx");
    // Whoever is signed in claims it, in the demo and against Supabase.
    expect(provider.match(/useDarkroomOwner\(/g)?.length).toBe(3);
    expect(provider).toMatch(/if \(userId\) claimDarkroom\(userId\);/);
    // Forgotten at "Sign out", in both...
    expect(provider).toMatch(/demoSignOut\(\);\s*\/\/[^\n]*\n\s*forgetDarkroom\(\);/);
    expect(provider).toMatch(/queryClient\.clear\(\);\s*forgetDarkroom\(\);/);
    // ...and when auth says the session has left the phone.
    expect(provider).toMatch(/onAuthStateChange\(\(event, next\) => \{[\s\S]*?if \(event === "SIGNED_OUT"\) forgetDarkroom\(\);[\s\S]*?else if \(next\?\.user\?\.id\) claimDarkroom\(next\.user\.id\);\s*setSession\(next\);/);
    // Never for a first answer of nobody: an offline launch is not a sign-out.
    expect(provider.match(/forgetDarkroom\(\)/g)?.length).toBe(3);
    expect(provider).not.toMatch(/memberLeft/);
  });

  it("Settings' Forget keeps the shelf", () => {
    const settings = read("app/settings.tsx");
    expect(settings).toMatch(/onPress: \(\) => forgetDarkroomHistory\(\)/);
    expect(settings).not.toMatch(/forgetDarkroom\(\)/);
  });
});
