import { settingsPath } from "@/components/darkroom/words";
import type { LibraryAccess } from "@/darkroom/access";

/**
 * What stands on the Post tab's mount when there is no photograph to put
 * on it: the same dark box, the same height, with a few words and at most
 * one thing to tap. Word for word, kept apart from the screen so the
 * words can be held without a phone.
 *
 *   ask             access never asked: explain, then let iOS ask, only from the tap
 *   denied          refused: the way to Settings, and LIBRARY still works
 *   empty-full      the whole library open, and nothing in it
 *   empty-limited   a limited selection, and nothing in it
 *   failed          the library would not answer: never shown as empty
 *   unavailable     no library here (Android, a browser outside the demo): the picker
 *   loading         an empty box; a small spinner after 400 ms
 *   waiting         an empty box, before the tab has been in front
 */
export type PanelKind =
  | "ask"
  | "denied"
  | "empty-full"
  | "empty-limited"
  | "failed"
  | "unavailable"
  | "loading"
  | "waiting";

export type PanelAct = "ask" | "shareMore" | "retry" | "choose";

export interface PanelWords {
  kind: PanelKind;
  eyebrow: string;
  headline: string;
  body: string;
  bar: { label: string; hint: string; act: PanelAct } | null;
  path: string | null;
  quiet: { label: string; hint: string } | null;
}

/** The roll's state, as the panel reads it. */
export type RollPhase = "waiting" | "loading" | "ready" | "failed" | "undetermined" | "denied" | "unavailable";

const ROLL = "Your camera roll";

const SHARE_MORE_HINT = "Opens iOS’s list of the photographs VINTAGE may see.";

/**
 * The way through Settings, made to break only after a "›": each step,
 * "Full Access" and all, stays on one line, and its arrow with it, so a
 * narrow mount never leaves a word of a step alone on the next line.
 */
export function unbrokenPath(path: string): string {
  return path
    .split(" › ")
    .map((step) => step.replace(/ /g, "\u00A0"))
    .join("\u00A0› ");
}

/** The words for one panel. The two that are only a box have none. */
export function panelWords(kind: PanelKind, iosMajor: number): PanelWords | null {
  switch (kind) {
    case "ask":
      return {
        kind,
        eyebrow: ROLL,
        headline: "Your photographs, right here.",
        body: "VINTAGE shows them on this iPhone only. Nothing leaves it until you post one.",
        bar: { label: "Continue", hint: "Asks to see your photo library.", act: "ask" },
        path: null,
        quiet: null,
      };
    case "denied":
      return {
        kind,
        eyebrow: ROLL,
        headline: "VINTAGE can’t see your photographs.",
        body: "Choose one at a time from Library, or let VINTAGE in from Settings. It only ever reads on this iPhone.",
        bar: null,
        path: unbrokenPath(settingsPath(iosMajor)),
        quiet: { label: "Open Settings", hint: "Opens VINTAGE’s page in Settings." },
      };
    case "empty-full":
      return {
        kind,
        eyebrow: ROLL,
        headline: "Nothing here yet.",
        body: "Take one, and it will be the first.",
        bar: null,
        path: null,
        quiet: null,
      };
    case "empty-limited":
      return {
        kind,
        eyebrow: ROLL,
        headline: "Nothing shared with VINTAGE yet.",
        body: "Choose the photographs it may see. Nothing leaves this iPhone until you post one.",
        bar: { label: "Share more", hint: SHARE_MORE_HINT, act: "shareMore" },
        path: null,
        quiet: null,
      };
    case "failed":
      return {
        kind,
        eyebrow: ROLL,
        headline: "Your photographs didn’t load.",
        body: "Try again in a moment.",
        bar: { label: "Try again", hint: "Reads your photographs again.", act: "retry" },
        path: null,
        quiet: null,
      };
    case "unavailable":
      return {
        kind,
        eyebrow: "From your library",
        headline: "Share a photograph.",
        body: "The one you have in mind.",
        bar: { label: "Choose a photograph", hint: "Opens your photo library. Nothing is shared until you post.", act: "choose" },
        path: null,
        quiet: null,
      };
    default:
      return null;
  }
}

/**
 * Which panel the mount shows, or null when it shows the selected
 * photograph: full and limited access with a roll to show have no panel.
 */
export function panelFor(s: { available: boolean; phase: RollPhase; access: LibraryAccess | null; empty: boolean }): PanelKind | null {
  if (!s.available || s.phase === "unavailable") return "unavailable";
  switch (s.phase) {
    case "waiting":
      return "waiting";
    case "loading":
      return "loading";
    case "undetermined":
      return "ask";
    case "denied":
      return "denied";
    case "failed":
      return "failed";
    case "ready":
      if (!s.empty) return null;
      return s.access === "limited" ? "empty-limited" : "empty-full";
  }
}
