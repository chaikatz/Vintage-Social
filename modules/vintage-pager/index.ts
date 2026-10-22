/**
 * The native side of the tab pager's touch rules — see
 * `src/utils/pagerTouches.ts` for the JS entry point, which loads this
 * module optionally so the browser build and a binary without it carry on
 * with the pager as it comes.
 */
export interface VintagePagerModule {
  /**
   * Keep the pager under the given view to one finger: two fingers are a
   * pinch, and the pager must never read them as a swipe. Resolves true
   * when a pager was found and told.
   */
  keepToOneFinger(viewTag: number): Promise<boolean>;
  /**
   * The same rule for one React scroll view, found by its own tag: the
   * Darkroom's page turner, so a pinch on a print never turns the page.
   * Resolves true when the scroll view was found and told. Optional: older
   * builds lack it.
   */
  keepScrollToOneFinger?(viewTag: number): Promise<boolean>;
}
