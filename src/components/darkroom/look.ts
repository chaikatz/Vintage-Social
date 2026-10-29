import { createContext, useContext } from "react";

/**
 * How the member has asked the phone to look and move, read once at the
 * room's root and handed down, so every word, rule and fade in the room
 * answers the same settings without each asking iOS for itself.
 *
 *   contrast       Increase Contrast: faint type is set soft, rules go to
 *                  full opacity, the well's hairline is the strong line.
 *   bold           Bold Text: every word in the room is set bold; both
 *                  Courier New and Georgia have bold faces on iOS.
 *   reduceMotion   Reduce Motion: every fade, dissolve, scale and slide
 *                  becomes a cut.
 *   screenReader   VoiceOver: the stage is one adjustable element, and
 *                  a tap on the photograph turns no page.
 *
 * Read through `src/utils/useReducedMotion.ts` and
 * `src/utils/useRoomAccessibility.ts` in `app/darkroom.tsx`.
 */
export interface Look {
  contrast: boolean;
  bold: boolean;
  reduceMotion: boolean;
  screenReader: boolean;
}

export const PLAIN_LOOK: Look = { contrast: false, bold: false, reduceMotion: false, screenReader: false };

export const LookContext = createContext<Look>(PLAIN_LOOK);

export function useLook(): Look {
  return useContext(LookContext);
}

/** A duration, or none at all under Reduce Motion. */
export function motion(look: Look, ms: number): number {
  return look.reduceMotion ? 0 : ms;
}
