/**
 * Timings for development builds, and nothing at all in a release.
 *
 * Posting used to feel slow without anyone being able to say which part
 * was slow: the bake, the resize, the upload or the insert. These spans
 * put a number on each step in the Metro log, `[perf] upload media 812ms
 * {"bytes":402113}`, so a device run says where the time went.
 *
 * Two rules keep them harmless. They only ever print under __DEV__, so a
 * build in someone's hand never logs. And what they print is never the
 * member's: no captions, no places, no file paths, and ids cut short with
 * `shortId` so a log pasted into an issue names no post.
 */

declare const __DEV__: boolean | undefined;

function isDev(): boolean {
  // __DEV__ is a React Native global. Under plain node (the unit tests) it
  // does not exist, and the tests have no use for the noise.
  return typeof __DEV__ !== "undefined" && __DEV__ === true;
}

function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function format(label: string, ms: number | null, extra?: Record<string, unknown>): string {
  const time = ms == null ? "" : ` ${ms}ms`;
  let detail = "";
  if (extra && Object.keys(extra).length > 0) {
    try {
      detail = ` ${JSON.stringify(extra)}`;
    } catch {
      detail = "";
    }
  }
  return `[perf] ${label}${time}${detail}`;
}

/** Dev-only timer. Returns a stop function that logs `[perf] label 123ms {extra}` in __DEV__ and returns the ms either way. */
export function perfStart(label: string): (extra?: Record<string, unknown>) => number {
  const t0 = now();
  return (extra) => {
    const ms = Math.round(now() - t0);
    if (isDev()) console.log(format(label, ms, extra));
    return ms;
  };
}

/** Dev-only one-off event log. */
export function perfLog(label: string, extra?: Record<string, unknown>): void {
  if (isDev()) console.log(format(label, null, extra));
}

/** The first eight characters of an id: enough to follow one post through a log, too few to look it up. */
export function shortId(id: string | null | undefined): string {
  return (id ?? "").slice(0, 8);
}
