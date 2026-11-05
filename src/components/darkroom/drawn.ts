/**
 * The prints whose photograph has drawn this visit, and when the room lets
 * go of the decoded copies it has been keeping.
 *
 * A plate's photograph is kept in expo-image's memory cache, so turning
 * back to a print finds it at once. That cache is SDWebImage's, shared by
 * the whole app, and it is kept with no limit: it lets go only when iOS
 * warns that memory is short, all at once. A print decoded at a plate's
 * size is 2.4 MB on an SE and 6 to 13 MB on a 3× phone, so an evening in
 * the room — two rolls, a year of 120 — would otherwise hold several
 * hundred megabytes of camera roll in memory, until the warning comes and
 * the main thread spends a long moment freeing it, or iOS ends the app
 * first.
 *
 * So after every `RELEASE_AFTER` prints newly drawn, and as the room
 * closes, it lets go of the decoded copies (`Image.clearMemoryCache`).
 * The plates on screen keep the photographs they show; a print further
 * back is asked of Photos again if the member turns back to it, and
 * dissolves in again as it does, since it is no longer drawn from memory.
 */

/** Prints newly drawn between two lettings-go: at most about 200 MB of photographs held in memory on the largest phone. */
export const RELEASE_AFTER = 16;

export class Drawn {
  private ids = new Set<string>();
  private since = 0;

  /** Drawn this visit, and not let go of since: likely still in memory, needing no dissolve. */
  has(id: string): boolean {
    return this.ids.has(id);
  }

  /** A photograph has drawn. `first` the first time this visit; `release` when it is time to let go. */
  add(id: string): { first: boolean; release: boolean } {
    const first = !this.ids.has(id);
    if (!first) return { first, release: false };
    this.ids.add(id);
    this.since += 1;
    return { first, release: this.since >= RELEASE_AFTER };
  }

  /** The decoded copies were let go: only the prints still on screen are still in memory. */
  released(onScreen: Iterable<string>): void {
    const keep = new Set(onScreen);
    this.ids = new Set([...this.ids].filter((id) => keep.has(id)));
    this.since = 0;
  }
}
