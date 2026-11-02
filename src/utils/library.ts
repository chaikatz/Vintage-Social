import { Linking, Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import { prepareImage } from "@/media/nativeMedia";
import { captureDateFromEpoch } from "./exif";
import { sameNightWindow } from "./memories";
import { PICKED_MAX_SIDE, PICKED_QUALITY } from "./pickForCompose";

/**
 * Reading the member's own photo library — and only reading it.
 *
 * Everything here runs on the phone and stays there. VINTAGE looks at the
 * library to *suggest*: a photograph from this day some years ago, the rest
 * of the roll from a night you posted about, one at random from the back
 * of the drawer. Nothing is uploaded, indexed or written down until the
 * member picks one and posts it the ordinary way, and the only thing that
 * ever leaves the phone is that one file — never a coordinate, and never
 * an inventory of the roll.
 *
 * Permission is the library's own. `libraryGranted(false)` and
 * `libraryAccess()` only report what has already been allowed, so a
 * screen can decide whether there is anything to show without putting a
 * system dialog in front of someone who was just scrolling.
 */

export interface LibraryPhoto {
  id: string;
  /** `ph://` on iOS — fine for thumbnails, not for reading pixels. */
  uri: string;
  width: number;
  height: number;
  /** Milliseconds since the epoch. */
  creationTime: number;
}

function available(): boolean {
  return Platform.OS !== "web";
}

export async function libraryGranted(ask: boolean): Promise<boolean> {
  if (!available()) return false;
  try {
    let permission = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
    if (!permission.granted && ask && permission.canAskAgain) {
      permission = await MediaLibrary.requestPermissionsAsync(false, ["photo"]);
    }
    return permission.granted;
  } catch {
    return false;
  }
}

function toPhoto(asset: MediaLibrary.Asset): LibraryPhoto {
  return {
    id: asset.id,
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    creationTime: asset.creationTime,
  };
}

/** How much one read of the library asks for at a time. */
const PAGE = 200;
/** Years read at once, so a long library is not read one year behind another. */
const YEARS_AT_ONCE = 4;
/** As the Memory Room has it: a date before 1900 is a lost date, not an old photograph. */
const EARLIEST_YEAR = 1900;

/**
 * Photographs between two moments, newest first, read a page at a time
 * until the library says there are no more, or until `limit` when there
 * is one. The library leaves out a photograph taken at either moment
 * exactly. A read that fails part way keeps what it had.
 */
async function readBetween(after: Date, before: Date, limit = Infinity): Promise<LibraryPhoto[]> {
  const out: LibraryPhoto[] = [];
  let cursor: string | undefined;
  while (out.length < limit) {
    let page: MediaLibrary.PagedInfo<MediaLibrary.Asset>;
    try {
      page = await MediaLibrary.getAssetsAsync({
        mediaType: "photo",
        createdAfter: after,
        createdBefore: before,
        sortBy: [["creationTime", false]],
        first: Math.min(PAGE, limit - out.length),
        ...(cursor ? { after: cursor } : {}),
      });
    } catch {
      break;
    }
    for (const asset of page.assets) out.push(toPhoto(asset));
    // A page that brings nothing, or no new place to go on from, ends it.
    if (!page.hasNextPage || page.assets.length === 0 || !page.endCursor || page.endCursor === cursor) break;
    cursor = page.endCursor;
  }
  return out;
}

/** Photographs taken between two moments, newest first, up to `limit`. */
export async function photosBetween(from: Date, to: Date, limit = 60): Promise<LibraryPhoto[]> {
  if (!available()) return [];
  return readBetween(from, to, limit);
}

/** The rest of the roll from the night a photograph was taken. */
export function photosFromSameNight(takenAtIso: string, limit = 60): Promise<LibraryPhoto[]> {
  const { from, to } = sameNightWindow(takenAtIso);
  return photosBetween(from, to, limit);
}

export interface LibraryDay {
  yearsAgo: number;
  photos: LibraryPhoto[];
}

/**
 * When the oldest photograph in the library was taken; null for an empty
 * library, or one that would not say. One with no date at all, or one
 * from before 1900, would sort first and say nothing about where the
 * library begins, so the question starts at 1900.
 */
export async function oldestPhotoTime(): Promise<number | null> {
  if (!available()) return null;
  try {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      createdAfter: new Date(EARLIEST_YEAR, 0, 1).getTime() - 1,
      first: 1,
      sortBy: [["creationTime", true]],
    });
    const taken = page.assets[0]?.creationTime;
    return typeof taken === "number" && Number.isFinite(taken) ? taken : null;
  } catch {
    return null;
  }
}

/**
 * Today's month and day in another year, from its first moment to the
 * next day's, in local time. Null when that year has no such day: the
 * 29th of February is not looked for in a year without one, rather than
 * read as the 1st of March.
 */
export function sameDayIn(year: number, month: number, date: number): { from: Date; to: Date } | null {
  const from = new Date(year, month, date);
  if (from.getFullYear() !== year || from.getMonth() !== month || from.getDate() !== date) return null;
  return { from, to: new Date(year, month, date + 1) };
}

/** The years On this day looks in: last year first, back to the year of the oldest photograph. */
export function yearsToLook(today: Date, oldest: number | null): number[] {
  if (oldest == null || !Number.isFinite(oldest)) return [];
  const first = Math.max(EARLIEST_YEAR, new Date(oldest).getFullYear());
  const out: number[] = [];
  for (let year = today.getFullYear() - 1; year >= first; year--) out.push(year);
  return out;
}

/** `task` for each item, no more than `width` at once; the answers in the items' order. */
async function inTurn<T, R>(items: readonly T[], width: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return out;
}

/**
 * Every photograph from this calendar day in every earlier year, most
 * recent year first, each year's newest first. The oldest photograph
 * says how far back to look, so a run of empty years is looked through,
 * not taken for the start of the library. One question a year, its
 * photographs read a page at a time, a few years at once. Photographs
 * only: a film taken that day is not among them.
 */
export async function photosOnThisDay(today: Date = new Date()): Promise<LibraryDay[]> {
  if (!available()) return [];
  const years = yearsToLook(today, await oldestPhotoTime());
  const month = today.getMonth();
  const date = today.getDate();
  const days = await inTurn(years, YEARS_AT_ONCE, async (year): Promise<LibraryDay | null> => {
    const day = sameDayIn(year, month, date);
    if (!day) return null;
    // A millisecond before midnight, so one taken at midnight exactly is kept.
    const photos = await readBetween(new Date(day.from.getTime() - 1), day.to);
    return photos.length > 0 ? { yearsAgo: today.getFullYear() - year, photos } : null;
  });
  return days.filter((d): d is LibraryDay => d != null);
}

/**
 * How much of the library VINTAGE may see, as the member last left it:
 * only read, never asked for. `limited` is a chosen selection — the
 * library then holds only the photographs the member picked, and On this
 * day can show no more than those.
 */
export type LibraryAccess = "none" | "limited" | "all";

export async function libraryAccess(): Promise<LibraryAccess> {
  if (!available()) return "none";
  try {
    const permission = await MediaLibrary.getPermissionsAsync(false, ["photo"]);
    if (!permission.granted) return "none";
    return permission.accessPrivileges === "limited" ? "limited" : "all";
  } catch {
    return "none";
  }
}

/**
 * iOS's own sheet for choosing more photographs to share with VINTAGE.
 * It says nothing when the member is done; the library's change event
 * does (`watchLibrary`). False where there is no such sheet.
 */
export async function chooseMorePhotos(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    await MediaLibrary.presentPermissionsPickerAsync(["photo"]);
    return true;
  } catch {
    return false;
  }
}

/** VINTAGE's page in Settings, where the whole library can be opened to it. */
export function openLibrarySettings(): void {
  Linking.openSettings().catch(() => undefined);
}

/**
 * Calls `changed` once the library has settled after a change: a
 * photograph added or taken away, or a different selection shared. A
 * burst of changes, as iCloud brings photographs down, is one call.
 * Returns the way to stop.
 */
export function watchLibrary(changed: () => void, settleMs = 2000): () => void {
  if (!available()) return () => undefined;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sub: { remove: () => void } | null = null;
  try {
    sub = MediaLibrary.addListener(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        changed();
      }, settleMs);
    });
  } catch {
    sub = null;
  }
  return () => {
    if (timer) clearTimeout(timer);
    sub?.remove();
  };
}

/** What VoiceOver says for one photograph of a day: when it was taken, and which of the day's it is. */
export function photoLabel(photo: LibraryPhoto, index: number, total: number, yearsAgo: number): string {
  const taken = new Date(photo.creationTime);
  const hours = taken.getHours();
  const time = `${hours % 12 || 12}:${String(taken.getMinutes()).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
  const when = yearsAgo === 1 ? "1 year ago" : `${yearsAgo} years ago`;
  return `${when}, ${time}. Photograph ${index + 1} of ${total}.`;
}

/** A row of On this day's contact sheet: a year's heading, or up to a row's width of its photographs. */
export type DayRow =
  | { kind: "year"; key: string; day: LibraryDay }
  | { kind: "photos"; key: string; day: LibraryDay; first: number; photos: LibraryPhoto[] };

/** The days as rows for a list that draws only what is on screen. Every photograph has a place in one. */
export function dayRows(days: readonly LibraryDay[], perRow: number): DayRow[] {
  const width = Math.max(1, Math.floor(perRow));
  const out: DayRow[] = [];
  for (const day of days) {
    if (day.photos.length === 0) continue;
    out.push({ kind: "year", key: `year-${day.yearsAgo}`, day });
    for (let i = 0; i < day.photos.length; i += width) {
      out.push({ kind: "photos", key: `${day.yearsAgo}-${i}`, day, first: i, photos: day.photos.slice(i, i + width) });
    }
  }
  return out;
}

/**
 * What the compose screen needs to open on a library photograph: a file
 * it can read, its size, and when it was taken. The `ph://` URI the
 * library hands out is not a file, so the real path is looked up here.
 */
export async function composeParamsFor(photo: LibraryPhoto): Promise<{
  uri: string;
  mediaType: "photo";
  width: string;
  height: string;
  duration: string;
  takenAt: string;
} | null> {
  try {
    const info = await MediaLibrary.getAssetInfoAsync(photo.id);
    const original = info.localUri ?? info.uri;
    if (!original) return null;
    // The library hands back the original file — HEIC, on its side — which
    // the filter renderer cannot read. It is decoded straight to the
    // editor's size, upright and in sRGB, exactly as a picked photograph
    // is (see `pickForCompose`). The image manipulator decoded the whole
    // original at background priority, which is slow in Low Power Mode,
    // and leaves a Display P3 photograph in P3, which the renderer would
    // read as sRGB. The size that comes back is the upright one, and a
    // decode with no picture in it is no photograph to open.
    const ready = await prepareImage(original, { maxSide: PICKED_MAX_SIDE, quality: PICKED_QUALITY });
    if (!ready.uri || !(ready.width > 0) || !(ready.height > 0)) return null;
    return {
      uri: ready.uri,
      mediaType: "photo",
      width: String(ready.width),
      height: String(ready.height),
      duration: "0",
      takenAt: captureDateFromEpoch(info.creationTime ?? photo.creationTime) ?? "",
    };
  } catch {
    return null;
  }
}
