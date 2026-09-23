/**
 * The short rule signed beneath a word at the door.
 *
 * 26 points under a line of capitals, as on the landing page — but a rule
 * that long under a four-letter word reads as a bar, not a signature, so
 * the rule keeps to the word: about four points a letter, never longer
 * than the full rule, never shorter than a stroke.
 */
export function ruleWidth(label: string): number {
  return Math.min(26, Math.max(14, label.trim().length * 4));
}
