import type { DarkroomMode, Print } from "./types";

/**
 * Where the member was, for the length of a visit to the app.
 *
 * Leaving the Darkroom to develop a photograph, or to look at the ordinary
 * picker, or simply closing it for a minute, should not lose the place.
 * The last position is kept here in memory — never on disk — and offered
 * back on re-entry for two hours. After that a visit starts fresh, which
 * is what makes the next visit a new one.
 */
export interface DarkroomPlace {
  mode: DarkroomMode;
  year: number | null;
  prints: Print[];
  index: number;
  /** The generator that was producing the sequence, to carry on from. */
  reader: unknown;
  at: number;
}

export const PLACE_KEPT_MS = 2 * 60 * 60_000;

let place: DarkroomPlace | null = null;

export function keepPlace(next: Omit<DarkroomPlace, "at">, at = Date.now()): void {
  place = { ...next, at };
}

export function recallPlace(now = Date.now()): DarkroomPlace | null {
  if (!place || now - place.at > PLACE_KEPT_MS) return null;
  return place;
}

export function forgetPlace(): void {
  place = null;
}
