import { createContext, useContext } from "react";
import { rooms, type Room } from "./room";

/**
 * How the member has asked the phone to look and move, read once at the
 * room's root and handed down, so every word, rule and fade in the room
 * answers the same settings without each asking iOS for itself.
 *
 *   room           The print the app is showing, light or dark (`rooms`
 *                  in room.ts): every colour in the room is read from it.
 *   contrast       Increase Contrast: faint type is set soft, rules go to
 *                  full opacity, the well's hairline is the strong line,
 *                  the signature line is drawn in the faintest ink, and
 *                  the CONTENTS tab is ruled in the soft ink.
 *   bold           Bold Text: every word in the room is set bold; both
 *                  Courier New and Georgia have bold faces on iOS.
 *   reduceMotion   Reduce Motion: every fade, dissolve, scale and slide
 *                  becomes a cut.
 *   screenReader   VoiceOver: the stage is one adjustable element, and
 *                  a tap on the photograph turns no page.
 *
 * Read through `useScheme` in room.ts, `src/utils/useReducedMotion.ts`
 * and `src/utils/useRoomAccessibility.ts` in `app/darkroom.tsx`.
 */
export interface Look {
  room: Room;
  contrast: boolean;
  bold: boolean;
  reduceMotion: boolean;
  screenReader: boolean;
}

export const PLAIN_LOOK: Look = { room: rooms.light, contrast: false, bold: false, reduceMotion: false, screenReader: false };

export const LookContext = createContext<Look>(PLAIN_LOOK);

export function useLook(): Look {
  return useContext(LookContext);
}

/** A duration, or none at all under Reduce Motion. */
export function motion(look: Look, ms: number): number {
  return look.reduceMotion ? 0 : ms;
}
