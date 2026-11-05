/**
 * Where a tapped notification lands.
 *
 * The `push` edge function puts a small `data` object on every notice:
 * a `kind`, and where it can, a `postId`, a `username`, or an explicit
 * `route`. This turns that into a path the router understands. Pure, so
 * it can be tested without a phone; the function itself sits in
 * `utils/push.ts`.
 */
export function routeForNotification(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const route = str(data.route);
  // An explicit route wins — it is the function saying "here, not the post".
  if (route && route.startsWith("/")) return route;
  const postId = str(data.postId);
  if (postId) return `/post/${postId}`;
  const username = str(data.username);
  if (username) return `/user/${username}`;
  switch (str(data.kind)) {
    case "follow":
    case "follow_request":
      return "/requests";
    case "message":
      return "/messages";
    case "memory":
      return "/memories";
    case "like":
    case "comment":
    case "tag":
    case "moderation":
      return "/(tabs)/activity";
    default:
      return null;
  }
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** The part of a notice response a tap is followed by. */
export interface TappedNotice {
  actionIdentifier?: string;
  notification: { request: { identifier: string; content: { data?: unknown } } };
}

/**
 * Following taps, each once.
 *
 * A notice that opens the app from cold is heard twice: as the last
 * response, asked for at launch, and by the listener for taps, which iOS
 * also hands it to. Each pushed the post, so the member landed on it twice
 * over and had to go back twice. And the last response stays the last
 * response until it is cleared, so the effect that asks for it ran it
 * again whenever it ran. A tap is now followed once, by its notice's id,
 * and cleared once followed.
 *
 * The router cannot be told anything until the root navigator is up; a
 * tap heard before then (a cold start, early) waits a moment and tries
 * again instead of being lost.
 */
export function tapFollower({
  navigate,
  clear,
  later = (run, ms) => void setTimeout(run, ms),
  waits = [100, 300, 600, 1200, 2400],
}: {
  navigate: (route: string) => void;
  clear: () => void;
  later?: (run: () => void, ms: number) => void;
  waits?: readonly number[];
}): (response: TappedNotice | null | undefined) => void {
  const followed = new Set<string>();
  const go = (route: string, attempt: number) => {
    try {
      navigate(route);
    } catch {
      // Not mounted yet; given up on once the waits run out.
      if (attempt < waits.length) later(() => go(route, attempt + 1), waits[attempt]);
    }
  };
  return (response) => {
    if (!response?.notification?.request) return;
    const key = `${response.notification.request.identifier}|${response.actionIdentifier ?? ""}`;
    if (followed.has(key)) return;
    followed.add(key);
    try {
      clear();
    } catch {
      // A runtime without it keeps the response; the id above still holds it to once.
    }
    const data = response.notification.request.content?.data;
    const route = routeForNotification(data && typeof data === "object" ? (data as Record<string, unknown>) : null);
    if (route) go(route, 0);
  };
}
