import type { QueryClient } from "@tanstack/react-query";

/**
 * What a screen's recover page lets go of before it draws the screen again.
 *
 * A screen that broke while it was drawn broke on what the cache held for
 * it: one bad row. Drawn again from the same cache, it broke again at
 * once, before it was ever on screen, and a read is made again only once
 * its screen is on screen, so Try again did nothing until the cache let
 * go of the row by itself, minutes later. Once the boundary has caught the
 * screen, nothing watches its reads any more; they are let go of here, and
 * the screen is drawn again from reads made afresh, as it was the first
 * time it opened.
 *
 * Every read a screen still on screen watches is kept: the screens under
 * it in its stack, the tabs beside it. What nothing watches is what the
 * cache lets go of by itself after a few minutes anyway, so nothing that
 * reads the cache counts on finding it there.
 */
export function forgetUnwatchedReads(client: QueryClient): void {
  client.removeQueries({ type: "inactive" });
}
