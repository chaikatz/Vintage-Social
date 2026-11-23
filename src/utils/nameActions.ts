/**
 * The names in a row, as VoiceOver reaches them.
 *
 * A row that is pressed as a whole (a comment under a photograph, a
 * notice, a thread in the inbox) is one element to VoiceOver, and the
 * names drawn inside it, each a link to its member's page, cannot be
 * reached on their own. Each is offered on the row as an action instead,
 * read out with the row and chosen by swiping up or down, as iOS offers a
 * cell's links.
 *
 * On the new architecture VoiceOver speaks an action's name and never its
 * label, and hands the name back (src/components/darkroom/words.ts,
 * spokenActions), so each goes by its words: "View ansel’s profile". The
 * row's own press is not among them. A double tap is the row's
 * onAccessibilityTap, which iOS calls on either architecture; without it
 * iOS taps the middle of the row, which can be a name.
 */

/** The words an action is spoken as, and handed back by. A username holds no ’, so they read back to one name. */
const SPOKEN = /^View ([a-z0-9_.]+)’s profile$/;

export interface NameAction {
  name: string;
  label: string;
}

/** One action per member named, in the order they appear, each member once, named by its words. */
export function nameActions(usernames: readonly (string | null | undefined)[]): NameAction[] {
  const out: NameAction[] = [];
  const seen = new Set<string>();
  for (const raw of usernames) {
    const username = raw?.trim().toLowerCase();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    const said = `View ${username}’s profile`;
    out.push({ name: said, label: said });
  }
  return out;
}

/** The member an action chosen on a row names, from its words; null for any other. */
export function nameFromAction(actionName: string): string | null {
  return SPOKEN.exec(actionName)?.[1] ?? null;
}
