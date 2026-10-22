import * as MediaLibrary from "expo-media-library";
import { MAX_PAGE } from "./eligibility";
import type { LibrarySource, Page, PageRequest, Print, TimeRange } from "./types";

/**
 * The phone's own library, through expo-media-library.
 *
 * Each call is one Photos fetch with a date predicate, which Photos
 * answers from its own index without loading a single image; a count
 * (`first: 0`) reads no assets at all. Pages are short and ordered by
 * capture time, and there is no cursor: a cursor is found by a linear
 * scan of the whole fetch, and it fails when its photograph has been
 * deleted, where a time range does neither. The fetch already leaves out
 * hidden photographs and the extra frames of a burst, and keeps to the
 * member's own library. Images themselves are never loaded here — the
 * image view asks Photos for each one, at the size it is drawn, only when
 * it is on screen.
 */

function toPrint(a: MediaLibrary.Asset): Print {
  return {
    id: a.id,
    uri: a.uri,
    width: a.width,
    height: a.height,
    takenAt: a.creationTime,
    subtypes: a.mediaSubtypes ?? [],
    filename: a.filename,
  };
}

/**
 * Photos' predicates are strict at both ends; the range's start is
 * inclusive. Negative times — photographs dated before 1970 — pass
 * through as they are.
 */
function bounds(range: TimeRange) {
  return { createdAfter: range.from - 1, createdBefore: range.to };
}

export const nativeSource: LibrarySource = {
  async count(range, subtype) {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      ...bounds(range),
      first: 0,
      ...(subtype ? { mediaSubtypes: [subtype] } : {}),
    });
    return page.totalCount;
  },

  async page({ range, first, order }: PageRequest): Promise<Page> {
    const page = await MediaLibrary.getAssetsAsync({
      mediaType: "photo",
      ...bounds(range),
      first: Math.max(0, Math.min(MAX_PAGE, Math.floor(first))),
      sortBy: [["creationTime", order === "asc"]],
    });
    return { prints: page.assets.map(toPrint), hasNextPage: page.hasNextPage };
  },

  async oldest() {
    const page = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1, sortBy: [["creationTime", true]] });
    return page.assets[0]?.creationTime ?? null;
  },
};
