/**
 * What VoiceOver reads for a member in a list: the username, then what the
 * row says under it (their name, their city), each where there is one.
 * Spoken only, never drawn.
 */
export function memberLabel(username: string, ...more: (string | null | undefined)[]): string {
  return [username, ...more].filter(Boolean).join(", ");
}
