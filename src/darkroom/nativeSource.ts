import * as MediaLibrary from "expo-media-library";
import type { LibrarySource, Page, PageRequest, Print, TimeRange } from "./types";

/**
 * The phone's own library, through expo-media-library.
 *
 * Each call is one Photos fetch with a date predicate, which Photos
 * answers from its own index without loading a single image; a count
 * reads no assets at all. Pages are small and ordered by capture time.
 * Images themselves are never loaded here — the image view asks Photos
 * for each one, at the size it is drawn, only when it is on screen.
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

/** Photos' predicates are strict on both ends; the range's start is inclusive. */
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

  async page({ range, first, after, order }: PageRequest): Promise<Page> {
    try {
      const page = await MediaLibrary.getAssetsAsync({
        mediaType: "photo",
        ...bounds(range),
        first,
        ...(after ? { after } : {}),
        sortBy: [["creationTime", order === "asc"]],
      });
      return { prints: page.assets.map(toPrint), endCursor: page.endCursor ?? null, hasNextPage: page.hasNextPage };
    } catch (err) {
      // The photograph a page was reading on from has left the library (or
      // the selection) since the last page: the chapter ends there rather
      // than failing. Anything else is a real failure.
      if (after) return { prints: [], endCursor: null, hasNextPage: false };
      throw err;
    }
  },

  async oldest() {
    const page = await MediaLibrary.getAssetsAsync({ mediaType: "photo", first: 1, sortBy: [["creationTime", true]] });
    return page.assets[0]?.creationTime ?? null;
  },
};
