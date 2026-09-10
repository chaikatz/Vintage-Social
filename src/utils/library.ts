import { Platform } from "react-native";
import * as MediaLibrary from "expo-media-library";
import { prepareForDarkroom } from "@/api/media";
import { captureDateFromEpoch } from "./exif";
import { sameNightWindow } from "./memories";

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
 * Permission is the library's own. `libraryGranted(false)` only reports
 * what has already been allowed, so a screen can decide whether there is
 * anything to show without putting a system dialog in front of someone
 * who was just scrolling.
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

/** Photographs taken between two moments, newest first. */
export async function photosBetween(from: Date, to: Date, limit = 60): Promise<LibraryPhoto[]> {
  if (!available()) return [];
  try {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      createdAfter: from,
      createdBefore: to,
      sortBy: [["creationTime", false]],
      first: limit,
    });
    return page.assets.map(toPhoto);
  } catch {
    return [];
  }
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
 * Photographs from this calendar day in earlier years, most recent year
 * first. One query per year — cheap, and it stops early once the years
 * run out of pictures for long enough to have reached before the phone.
 */
export async function photosOnThisDay(today: Date = new Date(), yearsBack = 15): Promise<LibraryDay[]> {
  if (!available()) return [];
  const out: LibraryDay[] = [];
  let empty = 0;
  for (let years = 1; years <= yearsBack; years++) {
    const start = new Date(today.getFullYear() - years, today.getMonth(), today.getDate(), 0, 0, 0, 0);
    const end = new Date(today.getFullYear() - years, today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const photos = await photosBetween(start, end, 40);
    if (photos.length > 0) {
      out.push({ yearsAgo: years, photos });
      empty = 0;
    } else if (++empty >= 6) {
      break;
    }
  }
  return out;
}

/** Anything newer than this is not "old" enough to be a rediscovery. */
const ROULETTE_MIN_AGE_DAYS = 90;

/**
 * One photograph, chosen at random from further back than the last few
 * months. The library cannot be asked for "the Nth item", so this picks a
 * random moment between the oldest picture and the cut-off and takes a
 * handful from just before it.
 */
export async function randomOldPhoto(): Promise<LibraryPhoto | null> {
  if (!available()) return null;
  try {
    const oldest = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      sortBy: [["creationTime", true]],
      first: 1,
    });
    const first = oldest.assets[0];
    if (!first) return null;
    const floor = first.creationTime;
    const ceiling = Date.now() - ROULETTE_MIN_AGE_DAYS * 86_400_000;
    if (ceiling <= floor) return null;
    const moment = floor + Math.random() * (ceiling - floor);
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      createdBefore: moment,
      sortBy: [["creationTime", false]],
      first: 24,
    });
    const candidates = page.assets.filter((a) => !a.mediaSubtypes?.includes("screenshot"));
    if (candidates.length === 0) return null;
    return toPhoto(candidates[Math.floor(Math.random() * candidates.length)]);
  } catch {
    return null;
  }
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
    // the filter renderer cannot read. Decode it properly first; the size
    // that comes back is the upright one.
    const ready = await prepareForDarkroom(original);
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
