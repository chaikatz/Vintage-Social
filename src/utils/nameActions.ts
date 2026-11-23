/**
 * The names in a row, as VoiceOver reaches them.
 *
 * A row that is pressed as a whole (a comment under a photograph, a
 * notice, a thread in the inbox) is one element to VoiceOver, and the
 * names drawn inside it, each a link to its member's page, cannot be
 * reached on their own. Each is offered on the row as an action instead,
 * read out with the row and chosen by swiping up or down, as iOS offers a
 * cell's links. The row's own press stays its default action.
 */

const PREFIX = "profile:";

export interface NameAction {
  name: string;
  label: string;
}

/** One action per member named, in the order they appear, each member once. */
export function nameActions(usernames: readonly (string | null | undefined)[]): NameAction[] {
  const out: NameAction[] = [];
  const seen = new Set<string>();
  for (const raw of usernames) {
    const username = raw?.trim().toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    out.push({ name: `${PREFIX}${username}`, label: `View ${username}’s profile` });
  }
  return out;
}

/** The member an action chosen on a row names; null for the row's own actions. */
export function nameFromAction(actionName: string): string | null {
  return actionName.startsWith(PREFIX) && actionName.length > PREFIX.length ? actionName.slice(PREFIX.length) : null;
}
