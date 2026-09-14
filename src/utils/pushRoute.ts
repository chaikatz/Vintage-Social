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
