import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * On this day, read from the phone's own library: every photograph from
 * today's month and day in every earlier year, back to the oldest one the
 * library holds, however many there are.
 *
 * The library is faked as Photos answers it: a date predicate strict at
 * both ends, a sort by capture time, pages of `first` with a cursor that
 * goes on from an asset's id, `hasNextPage` and `endCursor`, and a fetch
 * that leaves out anything with no date when a date is asked about. Under
 * a chosen selection it holds only the photographs the member shared. A
 * last block reads the page itself, for the list that draws only what is
 * on screen.
 */

interface FakeAsset {
  id: string;
  creationTime: number | null;
  mediaType: "photo" | "video";
}

const phone = vi.hoisted(() => ({
  os: "ios",
  assets: [] as FakeAsset[],
  calls: [] as Record<string, unknown>[],
  /** Calls past this many throw, as Photos does when a cursor's photograph has gone. */
  failFrom: Infinity,
  permission: { granted: true, status: "granted", canAskAgain: true, accessPrivileges: "all" } as Record<string, unknown>,
  permissionFails: false,
  asked: 0,
  pickers: [] as unknown[],
  pickerFails: false,
  settings: 0,
  listeners: [] as ((event: unknown) => void)[],
  removed: 0,
  /** When above 0, each read holds Expo’s one shared queue this long, one at a time, as on the phone. */
  costMs: 0,
  queueFree: 0,
  inFlight: 0,
  maxInFlight: 0,
}));

/** A call on Expo’s one shared async queue: it waits for everything asked before it, then holds the queue for `cost`. */
function onQueue(cost: number): Promise<void> {
  const now = Date.now();
  const end = Math.max(now, phone.queueFree) + cost;
  phone.queueFree = end;
  return new Promise((resolve) => setTimeout(resolve, end - now));
}

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return phone.os;
    },
  },
  Linking: {
    openSettings: async () => {
      phone.settings += 1;
    },
  },
  Alert: { alert: () => undefined },
}));

function ms(v: unknown): number {
  return v instanceof Date ? v.getTime() : (v as number);
}

vi.mock("expo-media-library", () => ({
  getAssetsAsync: async (options: Record<string, unknown>) => {
    phone.calls.push(options);
    if (phone.costMs > 0) {
      phone.inFlight += 1;
      phone.maxInFlight = Math.max(phone.maxInFlight, phone.inFlight);
      await onQueue(phone.costMs);
      phone.inFlight -= 1;
    }
    if (phone.calls.length > phone.failFrom) throw new Error("Couldn't find cursor");
    const type = (options.mediaType as string) ?? "photo";
    let list = phone.assets.filter((a) => a.mediaType === type);
    // A comparison with no date is never true, as in a Core Data predicate.
    if (options.createdAfter != null) list = list.filter((a) => a.creationTime != null && a.creationTime > ms(options.createdAfter));
    if (options.createdBefore != null) list = list.filter((a) => a.creationTime != null && a.creationTime < ms(options.createdBefore));
    const sortBy = options.sortBy as [string, boolean][] | undefined;
    const ascending = sortBy?.[0]?.[1] === true;
    // No date sorts first going up, last going down.
    const key = (a: FakeAsset) => a.creationTime ?? -Infinity;
    list.sort((a, b) => (ascending ? key(a) - key(b) : key(b) - key(a)) || a.id.localeCompare(b.id));
    let start = 0;
    if (options.after != null) {
      const at = list.findIndex((a) => a.id === options.after);
      if (at < 0) throw new Error("Couldn't find cursor");
      start = at + 1;
    }
    const first = (options.first as number) ?? 20;
    const page = list.slice(start, start + first);
    return {
      assets: page.map((a) => ({ id: a.id, uri: `ph://${a.id}`, width: 4032, height: 3024, creationTime: a.creationTime })),
      endCursor: page.length > 0 ? page[page.length - 1].id : options.after,
      hasNextPage: start + first < list.length,
      totalCount: list.length,
    };
  },
  getPermissionsAsync: async () => {
    if (phone.permissionFails) throw new Error("no library here");
    return phone.permission;
  },
  requestPermissionsAsync: async () => {
    phone.asked += 1;
    return phone.permission;
  },
  presentPermissionsPickerAsync: async (types?: unknown) => {
    if (phone.pickerFails) throw new Error("unavailable");
    phone.pickers.push(types);
  },
  addListener: (listener: (event: unknown) => void) => {
    phone.listeners.push(listener);
    return {
      remove: () => {
        phone.removed += 1;
        phone.listeners = phone.listeners.filter((l) => l !== listener);
      },
    };
  },
  getAssetInfoAsync: async () => null,
}));

vi.mock("expo-image-picker", () => ({}));
vi.mock("@/media/nativeMedia", () => ({ prepareImage: async () => ({ uri: "", width: 0, height: 0 }) }));
vi.mock("@/darkroom/nativeLibrary", () => ({
  libraryModule: () => null,
  developImage: async () => ({ status: "failed" }),
  cancelDevelop: () => undefined,
}));
vi.mock("@/utils/captureDate", () => ({ captureDateForAsset: async () => null }));
vi.mock("@/utils/alert", () => ({ showAlert: () => undefined }));

import {
  chooseMorePhotos,
  dayRows,
  libraryAccess,
  oldestPhotoTime,
  openLibrarySettings,
  photoLabel,
  photosBetween,
  photosFromSameNight,
  photosOnThisDay,
  sameDayIn,
  watchLibrary,
  YEARS_AT_ONCE,
  yearsToLook,
  type LibraryDay,
} from "@/utils/library";

beforeEach(() => {
  phone.os = "ios";
  phone.assets = [];
  phone.calls = [];
  phone.failFrom = Infinity;
  phone.permission = { granted: true, status: "granted", canAskAgain: true, accessPrivileges: "all" };
  phone.permissionFails = false;
  phone.asked = 0;
  phone.pickers = [];
  phone.pickerFails = false;
  phone.settings = 0;
  phone.listeners = [];
  phone.removed = 0;
  phone.costMs = 0;
  phone.queueFree = 0;
  phone.inFlight = 0;
  phone.maxInFlight = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

let serial = 0;
function photo(at: Date | number, mediaType: FakeAsset["mediaType"] = "photo"): FakeAsset {
  const asset = { id: `A${String(serial++).padStart(6, "0")}`, creationTime: ms(at), mediaType };
  phone.assets.push(asset);
  return asset;
}

/** The calls that read one day's photographs: dated at both ends, newest first. */
function dayCalls() {
  return phone.calls.filter((c) => c.createdBefore != null);
}

const TODAY = new Date(2026, 10, 2, 10, 30); // 2 November 2026, mid-morning

// ---------------------------------------------------------------------------
// Every photograph
// ---------------------------------------------------------------------------

describe("On this day from the library", () => {
  it("brings every photograph of a heavy day, page after page, with no cap", async () => {
    photo(new Date(2015, 5, 1)); // the oldest
    // A wedding: 1,000 photographs on the 2nd of November 2021, a minute apart.
    const wedding = Array.from({ length: 1000 }, (_, i) => photo(new Date(2021, 10, 2, 0, i)));
    photo(new Date(2021, 10, 1, 23, 59)); // the day before
    photo(new Date(2021, 10, 3, 0, 1)); // the day after

    const days = await photosOnThisDay(TODAY);

    expect(days).toHaveLength(1);
    expect(days[0].yearsAgo).toBe(5);
    expect(days[0].photos).toHaveLength(1000);
    // Newest first, and each one exactly once.
    expect(days[0].photos.map((p) => p.id)).toEqual(wedding.map((a) => a.id).reverse());
    // Read a page at a time, each going on from the last one's end.
    const reads = dayCalls().filter((c) => new Date(ms(c.createdBefore)).getFullYear() === 2021);
    expect(reads.length).toBeGreaterThan(1);
    expect(reads[0].after).toBeUndefined();
    for (const [i, read] of reads.entries()) {
      if (i > 0) expect(read.after).toBe(days[0].photos[i * (reads[0].first as number) - 1].id);
    }
  });

  it("asks for photographs only, so a film taken that day is not among them", async () => {
    photo(new Date(2019, 10, 2, 9));
    photo(new Date(2019, 10, 2, 12), "video");
    const days = await photosOnThisDay(TODAY);
    expect(days.map((d) => d.photos.length)).toEqual([1]);
    expect(phone.calls.every((c) => c.mediaType === "photo")).toBe(true);
  });

  it("looks back to the year of the oldest photograph, through any run of empty years", async () => {
    photo(new Date(2003, 5, 14)); // a scan, the oldest, on another day
    photo(new Date(2004, 10, 2, 15));
    photo(new Date(2024, 10, 2, 9));
    photo(new Date(2024, 10, 2, 18));

    const days = await photosOnThisDay(TODAY);

    // Nineteen empty years between them, and 22 years back: both found.
    expect(days.map((d) => [d.yearsAgo, d.photos.length])).toEqual([
      [2, 2],
      [22, 1],
    ]);
    // Every year from last year back to 2003, once each, and none before it.
    const years = dayCalls().map((c) => new Date(ms(c.createdBefore) - 1).getFullYear());
    expect([...years].sort((a, b) => b - a)).toEqual(Array.from({ length: 23 }, (_, i) => 2025 - i));
  });

  it("finds the oldest photograph once, from 1900, so one with no date or a lost one does not set the reach", async () => {
    phone.assets.push({ id: "NO-DATE", creationTime: null, mediaType: "photo" });
    photo(new Date(1850, 0, 1)); // a date that was lost, not an old photograph
    photo(new Date(2018, 3, 3));
    photo(new Date(2020, 10, 2, 8));

    expect(new Date((await oldestPhotoTime())!).getFullYear()).toBe(2018);
    phone.calls = [];
    const days = await photosOnThisDay(TODAY);
    expect(days.map((d) => d.yearsAgo)).toEqual([6]);
    const oldest = phone.calls.filter((c) => c.createdBefore == null);
    expect(oldest).toHaveLength(1);
    expect(oldest[0]).toMatchObject({ first: 1, sortBy: [["creationTime", true]] });
    expect(ms(oldest[0].createdAfter)).toBe(new Date(1900, 0, 1).getTime() - 1);
    expect(dayCalls()).toHaveLength(2025 - 2018 + 1);
  });

  it("reads nothing more from an empty library, or one with nothing older than this year", async () => {
    expect(await photosOnThisDay(TODAY)).toEqual([]);
    expect(dayCalls()).toEqual([]);
    photo(new Date(2026, 0, 5));
    expect(await photosOnThisDay(TODAY)).toEqual([]);
    expect(dayCalls()).toEqual([]);
  });

  it("keeps the photograph taken at midnight exactly, and the day's last moment, and not the next midnight", async () => {
    const midnight = photo(new Date(2022, 10, 2, 0, 0, 0, 0));
    const last = photo(new Date(2022, 10, 2, 23, 59, 59, 999));
    photo(new Date(2022, 10, 3, 0, 0, 0, 0));
    photo(new Date(2022, 10, 1, 23, 59, 59, 999));
    const days = await photosOnThisDay(TODAY);
    expect(days[0].photos.map((p) => p.id)).toEqual([last.id, midnight.id]);
  });

  it("on the 29th of February, shows nothing for a year without one rather than the 1st of March", async () => {
    const leapDay = new Date(2028, 1, 29, 9);
    photo(new Date(2019, 0, 1)); // the oldest
    const in2024 = photo(new Date(2024, 1, 29, 12));
    photo(new Date(2027, 2, 1, 12)); // the 1st of March in a common year
    photo(new Date(2027, 1, 28, 12));
    photo(new Date(2023, 2, 1, 0, 30));
    const in2020 = photo(new Date(2020, 1, 29, 20));

    const days = await photosOnThisDay(leapDay);

    expect(days.map((d) => [d.yearsAgo, d.photos.map((p) => p.id)])).toEqual([
      [4, [in2024.id]],
      [8, [in2020.id]],
    ]);
    // Only the leap years were asked about, each for its own 29th.
    const asked = dayCalls().map((c) => new Date(ms(c.createdAfter) + 1));
    expect(asked.map((d) => [d.getFullYear(), d.getMonth(), d.getDate()])).toEqual([
      [2024, 1, 29],
      [2020, 1, 29],
    ]);
  });

  it("keeps what it had when a page fails part way", async () => {
    photo(new Date(2010, 0, 1));
    Array.from({ length: 450 }, (_, i) => photo(new Date(2025, 10, 2, 6, i)));
    // The oldest, one page of last year, then the next page fails.
    phone.failFrom = 2;
    const days = await photosOnThisDay(TODAY);
    expect(days[0].yearsAgo).toBe(1);
    expect(days[0].photos.length).toBeGreaterThan(0);
    expect(days[0].photos.length).toBeLessThan(450);
  });

  it("keeps two years’ reads on Expo’s one queue at a time, so the rest of the app waits behind two, and the day takes no longer", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    phone.costMs = 40;
    photo(new Date(2011, 0, 1)); // the oldest
    for (let year = 2011; year <= 2025; year++) Array.from({ length: 30 }, (_, i) => photo(new Date(year, 10, 2, 8, i)));

    let done: number | null = null;
    const reading = photosOnThisDay(TODAY).then((days) => {
      done = Date.now();
      return days;
    });
    // Another module asks for something (the keychain, a file) part way through.
    await vi.advanceTimersByTimeAsync(100);
    const asked = Date.now();
    let answered: number | null = null;
    void onQueue(1).then(() => {
      answered = Date.now();
    });
    await vi.advanceTimersByTimeAsync(5_000);
    const days = await reading;

    expect(days).toHaveLength(15);
    expect(YEARS_AT_ONCE).toBe(2);
    expect(phone.maxInFlight).toBe(2);
    // Behind the read being answered and the one waiting: 60 ms here, where four at once kept it 140 ms.
    expect(answered! - asked - 1).toBeLessThanOrEqual(2 * phone.costMs);
    // The queue is never idle: the oldest photograph and fifteen years, one page each, back to back, and the other call.
    expect(done).toBe(16 * phone.costMs + 1);
  });

  it("is nothing on the web, which has no library", async () => {
    phone.os = "web";
    photo(new Date(2020, 10, 2));
    expect(await photosOnThisDay(TODAY)).toEqual([]);
    expect(phone.calls).toEqual([]);
  });

  it("leaves That night's own limit as it was: one read of `limit`", async () => {
    Array.from({ length: 300 }, (_, i) => photo(new Date(2024, 4, 4, 20, i)));
    expect(await photosFromSameNight(new Date(2024, 4, 4, 22).toISOString())).toHaveLength(60);
    expect(await photosBetween(new Date(2024, 4, 4), new Date(2024, 4, 5), 120)).toHaveLength(120);
    expect(phone.calls.map((c) => c.first)).toEqual([60, 120]);
  });
});

describe("the day in another year", () => {
  it("runs from its own midnight to the next, in local time", () => {
    expect(sameDayIn(2021, 10, 2)).toEqual({ from: new Date(2021, 10, 2), to: new Date(2021, 10, 3) });
  });

  it("does not exist for the 29th of February in a common year", () => {
    expect(sameDayIn(2027, 1, 29)).toBeNull();
    expect(sameDayIn(2100, 1, 29)).toBeNull();
    expect(sameDayIn(2000, 1, 29)).toEqual({ from: new Date(2000, 1, 29), to: new Date(2000, 2, 1) });
  });

  it("is looked for in every year from last year to the oldest photograph's, and no further back than 1900", () => {
    expect(yearsToLook(TODAY, new Date(2020, 6, 1).getTime())).toEqual([2025, 2024, 2023, 2022, 2021, 2020]);
    expect(yearsToLook(TODAY, new Date(1850, 0, 1).getTime())).toHaveLength(2025 - 1900 + 1);
    expect(yearsToLook(TODAY, new Date(2026, 0, 1).getTime())).toEqual([]);
    expect(yearsToLook(TODAY, null)).toEqual([]);
    expect(yearsToLook(TODAY, Number.NaN)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A chosen selection
// ---------------------------------------------------------------------------

describe("how much of the library VINTAGE may see", () => {
  it("tells a chosen selection from the whole library, and from none", async () => {
    expect(await libraryAccess()).toBe("all");
    phone.permission = { granted: true, status: "granted", accessPrivileges: "limited" };
    expect(await libraryAccess()).toBe("limited");
    phone.permission = { granted: true, status: "granted" };
    expect(await libraryAccess()).toBe("all");
    phone.permission = { granted: false, status: "denied", accessPrivileges: "none" };
    expect(await libraryAccess()).toBe("none");
    phone.permissionFails = true;
    expect(await libraryAccess()).toBe("none");
    phone.permissionFails = false;
    phone.os = "web";
    expect(await libraryAccess()).toBe("none");
  });

  it("only reads it, never asks", async () => {
    phone.permission = { granted: false, status: "undetermined", canAskAgain: true };
    await libraryAccess();
    expect(phone.asked).toBe(0);
  });

  it("under a chosen selection shows what was shared, and only that", async () => {
    phone.permission = { granted: true, status: "granted", accessPrivileges: "limited" };
    // The library itself holds only the shared ones; the rest are not there to read.
    const shared = photo(new Date(2023, 10, 2, 14));
    expect((await photosOnThisDay(TODAY)).flatMap((d) => d.photos.map((p) => p.id))).toEqual([shared.id]);
  });

  it("opens iOS's own sheet for sharing more photographs", async () => {
    expect(await chooseMorePhotos()).toBe(true);
    expect(phone.pickers).toEqual([["photo"]]);
  });

  it("has no sheet to open off iOS, or when iOS will not show it", async () => {
    phone.os = "android";
    expect(await chooseMorePhotos()).toBe(false);
    phone.os = "ios";
    phone.pickerFails = true;
    expect(await chooseMorePhotos()).toBe(false);
    expect(phone.pickers).toEqual([]);
    expect(phone.asked).toBe(0);
  });

  it("opens Settings", () => {
    openLibrarySettings();
    expect(phone.settings).toBe(1);
  });
});

describe("watching the library", () => {
  it("calls once a burst of changes has settled, and stops when asked", () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const stop = watchLibrary(changed, 2000);
    expect(phone.listeners).toHaveLength(1);
    phone.listeners[0]({ hasIncrementalChanges: false });
    vi.advanceTimersByTime(1500);
    phone.listeners[0]({ hasIncrementalChanges: true, insertedAssets: [{ id: "x" }] });
    vi.advanceTimersByTime(1999);
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(changed).toHaveBeenCalledTimes(1);

    // A change still settling when the page goes is never called.
    phone.listeners[0]({ hasIncrementalChanges: false });
    stop();
    expect(phone.removed).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("watches nothing on the web", () => {
    phone.os = "web";
    watchLibrary(() => undefined)();
    expect(phone.listeners).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The contact sheet
// ---------------------------------------------------------------------------

function day(yearsAgo: number, count: number): LibraryDay {
  return {
    yearsAgo,
    photos: Array.from({ length: count }, (_, i) => ({
      id: `${yearsAgo}-${i}`,
      uri: `ph://${yearsAgo}-${i}`,
      width: 1,
      height: 1,
      creationTime: i,
    })),
  };
}

describe("the contact sheet's rows", () => {
  it("give every photograph a place, in order, a row's width at a time under its year", () => {
    const days = [day(1, 9), day(3, 0), day(7, 4), day(12, 1)];
    const rows = dayRows(days, 4);
    expect(rows.map((r) => (r.kind === "year" ? `Y${r.day.yearsAgo}` : r.photos.length))).toEqual([
      "Y1", 4, 4, 1, "Y7", 4, "Y12", 1,
    ]);
    const placed = rows.flatMap((r) => (r.kind === "photos" ? r.photos.map((p) => p.id) : []));
    expect(placed).toEqual(days.flatMap((d) => d.photos.map((p) => p.id)));
    expect(new Set(rows.map((r) => r.key)).size).toBe(rows.length);
    // Each row knows where it starts among its day's photographs, for what VoiceOver says.
    expect(rows.filter((r) => r.kind === "photos").map((r) => (r.kind === "photos" ? r.first : -1))).toEqual([0, 4, 8, 0, 0]);
  });

  it("holds thousands without leaving any out", () => {
    const rows = dayRows([day(2, 5003)], 4);
    expect(rows.reduce((n, r) => n + (r.kind === "photos" ? r.photos.length : 0), 0)).toBe(5003);
  });

  it("say when each photograph was taken, and which of the day's it is", () => {
    const p = { id: "a", uri: "ph://a", width: 1, height: 1, creationTime: new Date(2021, 10, 2, 16, 7).getTime() };
    expect(photoLabel(p, 2, 212, 5)).toBe("5 years ago, 4:07 PM. Photograph 3 of 212.");
    const q = { ...p, creationTime: new Date(2025, 10, 2, 0, 0).getTime() };
    expect(photoLabel(q, 0, 1, 1)).toBe("1 year ago, 12:00 AM. Photograph 1 of 1.");
  });
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname, "..");

/** The source without its comments, so prose that names what is not done is not taken as doing it. */
function code(file: string): string {
  return readFileSync(path.join(root, file), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the On this day page", () => {
  const page = code("app/memories.tsx");

  it("draws the library's photographs in a list that draws only what is on screen", () => {
    expect(page).not.toMatch(/\bScrollView\b/);
    expect(page).toMatch(/<FlatList\s+data=\{rows\}/);
    expect(page).toMatch(/renderItem=\{renderRow\}/);
    expect(page).toMatch(/dayRows\(library\.data \?\? \[\], PER_ROW\)/);
    // The thumbnails are drawn by the rows, never by the header above them.
    const head = page.slice(page.indexOf("const head = ("), page.indexOf("const foot = ("));
    expect(head).not.toMatch(/p\.uri|photos\.map/);
    const render = page.slice(page.indexOf("const renderRow ="), page.indexOf("const head = ("));
    expect(render).toMatch(/<Image\s+source=\{p\.uri\}/);
  });

  it("asks for the whole day, with no limit, and cuts none of it short", () => {
    expect(page).toMatch(/photosOnThisDay\(\)/);
    expect(page).not.toMatch(/photosOnThisDay\([^)]/);
    expect(page).not.toMatch(/day\.photos\.slice|photos\.slice\(0/);
  });

  it("says when only some photographs were shared, with a way to share more and to Settings", () => {
    const limited = page.slice(page.indexOf('reach === "limited" ? ('));
    expect(limited).toContain("VINTAGE can see only the photographs you’ve chosen.");
    expect(limited).toMatch(/onPress=\{\(\) => void chooseMore\(\)\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityLabel="Choose more photographs"/);
    expect(limited).toMatch(/onPress=\{openLibrarySettings\}[\s\S]*?accessibilityRole="button"[\s\S]*?accessibilityLabel="Open Settings"/);
    expect(page).toMatch(/if \(!\(await chooseMorePhotos\(\)\)\) openLibrarySettings\(\);/);
  });

  it("looks again once more photographs are shared, or the access changes", () => {
    expect(page).toMatch(/watchLibrary\(\(\) => lookAgain\(true\)\)/);
    expect(page).toMatch(/queryKey: \["library-on-this-day", dayKey, reach\]/);
    // Back from Settings: a return from the background (src/utils/appReturn.ts).
    expect(page).toMatch(/return onReturnFromBackground\(\(\) => lookAgain\(reachNow\.current === "limited"\)\);/);
  });

  it("names each photograph and each year for VoiceOver", () => {
    const render = page.slice(page.indexOf("const renderRow ="), page.indexOf("const head = ("));
    expect(render).toMatch(/accessibilityRole="imagebutton"\s+accessibilityLabel=\{photoLabel\(p, item\.first \+ i, day\.photos\.length, day\.yearsAgo\)\}/);
    expect(render).toMatch(/accessibilityRole="button"\s+accessibilityLabel=\{`\$\{title\}, \$\{count\}`\}/);
    expect(render).toMatch(/accessibilityRole="header" accessibilityLabel=\{`\$\{title\}, \$\{count\}`\}/);
  });

  it("uses the typographer's apostrophe in what it says", () => {
    expect(page).not.toMatch(/"[^"\n]*\w'\w[^"\n]*"|>[^<{]*\w'\w[^<{]*</);
  });
});

describe("the picker's On this day", () => {
  const picker = code("app/library-picker.tsx");

  it("asks for the whole day too, in a list that draws only what is on screen", () => {
    expect(picker).toMatch(/await photosOnThisDay\(\)/);
    expect(picker).toMatch(/<FlatList/);
    expect(picker).not.toMatch(/\bScrollView\b/);
  });
});
