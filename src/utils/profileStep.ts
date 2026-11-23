/**
 * What a tap on a member's name does: their page, as every name in the
 * app opens it — but never a second copy of a page already open.
 *
 * Tapped on the page it names (your own name on your Profile tab), it
 * stays where it is. Tapped one screen above that page (a photograph's
 * gallery opened from its member's page, a thread opened from their
 * Message button), it goes back down to it rather than laying the same
 * page over itself. Anywhere else it opens their page on top.
 *
 * Read from the root stack's routes as React Navigation holds them: a
 * member's page is the `user/[username]` route, and your own is the tabs
 * while the Profile tab is the one in front.
 */

/** A route as the navigation state holds it, nested state and all. */
export interface RouteLike {
  name: string;
  params?: object;
  state?: { index?: number; routes: readonly RouteLike[] } | undefined;
}

export type ProfileStep = "stay" | "back" | "push";

/** Whose page a route of the root stack is, in lowercase; null for any other screen. */
export function profileShown(route: RouteLike | undefined, myUsername: string | null): string | null {
  if (!route) return null;
  if (route.name === "user/[username]") {
    const username = (route.params as { username?: unknown } | undefined)?.username;
    return typeof username === "string" && username ? username.toLowerCase() : null;
  }
  if (route.name === "(tabs)" && myUsername) {
    const tabs = route.state;
    // The tabs open on Home until a tab is chosen.
    const front = tabs?.routes[tabs.index ?? 0];
    return front?.name === "profile" ? myUsername.toLowerCase() : null;
  }
  return null;
}

/** What opening `username`'s page does from where the reader is (see above). */
export function profileStep(
  routes: readonly RouteLike[],
  index: number,
  username: string,
  myUsername: string | null,
): ProfileStep {
  const target = username.trim().toLowerCase();
  if (!target) return "stay";
  if (profileShown(routes[index], myUsername) === target) return "stay";
  if (index > 0 && profileShown(routes[index - 1], myUsername) === target) return "back";
  return "push";
}
