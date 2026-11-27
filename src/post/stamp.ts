import type { Print } from "@/darkroom/types";
import { captureDateFromEpoch } from "@/utils/exif";
import type { PickedParams } from "@/utils/pickForCompose";

/**
 * VINTAGE's date stamp on the Post tab's photograph, as its post will
 * carry it.
 *
 * The stamp reads the photograph's own capture date, the one the editor
 * is handed (`composeParamsFor` and the demo's `developLocal` both read it
 * through `captureDateFromEpoch`), and is drawn by the same `DateStamp`
 * posts and the editor draw, in the same place. A photograph with no
 * capture date — the library's "unknown" dates, a clock never set — has
 * no stamp: the editor would stamp it with today, which is not when it
 * was taken.
 *
 * The editor starts with the stamp off for its first film. A photograph
 * opened from this page was shown stamped, so the editor is told to start
 * with the stamp on (`stamp: "on"`), and the photograph is posted as it
 * was shown unless the member turns the stamp off, or chooses a film that
 * starts without it, as the editor's own switch has always done.
 */

/** The date the stamp shows, as the editor will read it; null when the photograph has none. */
export function stampDate(print: Pick<Print, "takenAt">): string | null {
  return captureDateFromEpoch(print.takenAt);
}

/** The editor's word for "the stamp starts on". */
export const STAMP_ON = "on";

/** The editor's parameters for a photograph shown stamped: the stamp starts on, where there is a date to stamp. */
export function stampedParams(params: PickedParams): PickedParams {
  return params.takenAt ? { ...params, stamp: STAMP_ON } : params;
}

/** Whether the editor was told to start with the stamp on. */
export function startsStamped(stamp: string | undefined, takenAt: string | null | undefined): boolean {
  return stamp === STAMP_ON && Boolean(takenAt);
}
