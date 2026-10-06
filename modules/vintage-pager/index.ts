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
}
