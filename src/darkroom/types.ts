/**
 * The Darkroom's vocabulary.
 *
 * A `Print` is one photograph in the member's own library, as the
 * Darkroom knows it: an identifier the phone gave it, an address the image
 * view can draw from, its upright size, and when the shutter fired. That
 * is all — no pixels, no place, no faces. Everything here is read on the
 * phone and stays there; only the one photograph a member develops and
 * posts ever leaves it, through the ordinary editor.
 */
export interface Print {
  /** The library's own identifier (PHAsset localIdentifier on iOS). */
  id: string;
  /** `ph://…` on iOS — the image view asks Photos for it at the size it is drawn. A bundled asset in the browser demo. */
  uri: string | number;
  /** Upright pixel size, as Photos reports it. */
  width: number;
  height: number;
  /** When the shutter fired, in milliseconds since the epoch. Negative before 1970. */
  takenAt: number;
  /** Photos' own subtypes: "screenshot", "panorama", "livePhoto", … */
  subtypes: readonly string[];
  /** The file's name, when the library says it — read only for its extension and its shape, never stored. */
  filename?: string;
}

/** A stretch of time, `from` inclusive, `to` exclusive, in milliseconds. */
export interface TimeRange {
  from: number;
  to: number;
}

/**
 * One bounded question: the first few photographs of a stretch of time,
 * from one end of it. There is no cursor to read on from. A cursor is a
 * linear scan in Photos, and it fails outright when its photograph is
 * deleted between two pages; a stretch of time does neither. To read
 * further, the Darkroom asks about a different stretch.
 */
export interface PageRequest {
  range: TimeRange;
  /** At most 150. */
  first: number;
  order: "asc" | "desc";
}

export interface Page {
  prints: Print[];
  /** More photographs fall in the range than this page holds. */
  hasNextPage: boolean;
}

/**
 * The library, reduced to the three questions the Darkroom asks of it.
 * The phone answers them through expo-media-library; the browser review
 * build answers them from a small demo library; the tests answer them
 * from a fake. Every question is bounded — no answer is ever "the whole
 * roll" — which is what keeps a 100,000-photograph library fluid.
 */
export interface LibrarySource {
  /** How many photographs were taken in the range; with a subtype, how many of those are that subtype. */
  count(range: TimeRange, subtype?: "screenshot"): Promise<number>;
  /** One page of photographs in the range, in capture order. */
  page(request: PageRequest): Promise<Page>;
  /** When the oldest photograph was taken; null for an empty library. */
  oldest(): Promise<number | null>;
}

/** The ways into the library. */
export type DarkroomMode = "on-this-day" | "surprise" | "year" | "set-aside";

/** How far On This Day had to reach to find something. */
export type DayReach = "day" | "week" | "season";
