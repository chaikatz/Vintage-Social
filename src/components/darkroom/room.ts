import type { TextStyle } from "react-native";
import { dark, type } from "@/theme";

/**
 * The Darkroom is printed on the dark page whatever the appearance
 * setting: the deepest brown the theme has, with cream type and gold
 * marks, so the photographs are the only light in the room. These are the
 * existing tokens of the dark print, as plain strings rather than the
 * dynamic `colors.*`, which would turn the room cream when the phone is in
 * light mode. Nothing in the room reads `colors.*`, and none of the shared
 * components that do (GateButton, Button, EmptyState, Bone, Screen) are
 * used here; `Word`, `Plate` and `PrintPage` stand in for them.
 *
 * `page` is the room itself; `well` is one step up, the fill a plate sits
 * in before its pixels arrive and the colour of the Contents sheet.
 * `accentDeep` and `borderStrong` are never used for type: neither
 * reaches AA on the page.
 */
export const room = {
  page: dark.paperSunken,
  well: dark.paper,
  ink: dark.ink,
  soft: dark.inkSoft,
  faint: dark.inkFaint,
  gold: dark.accent,
  line: dark.border,
  lineStrong: dark.borderStrong,
} as const;

/** The signed rule under a word sits at this opacity; Increase Contrast takes it to 1. */
export const RULE_OPACITY = 0.8;

/** Tracked capitals carry their trailing space; this takes it back so a rule beneath centres on the letters. */
export function untrack(letterSpacing: number): Pick<TextStyle, "letterSpacing" | "marginRight"> {
  return { letterSpacing, marginRight: -letterSpacing };
}

/** The four inks type can be set in. Faint becomes soft under Increase Contrast. */
export type Tone = "ink" | "soft" | "faint" | "gold";

const mono = type.mono;
const serif = type.serif;
const caps = { textTransform: "uppercase" as const };

/**
 * The room's type, by role. Each role carries its face, size, leading and
 * tracking (always with the trailing space taken back), and the ink it is
 * set in unless a caller says otherwise. Words are stored in sentence
 * case and set in capitals by `textTransform`, so VoiceOver reads them as
 * words rather than letters.
 */
export const roles = {
  eyebrow: { style: { fontFamily: mono, fontSize: 10, ...untrack(2.4), ...caps }, tone: "faint" },
  head: { style: { fontFamily: mono, fontSize: 10, ...untrack(2.4), ...caps }, tone: "soft" },
  dateLabel: { style: { fontFamily: mono, fontSize: 11, lineHeight: 14, ...untrack(2.2), ...caps }, tone: "gold" },
  small: { style: { fontFamily: mono, fontSize: 10, ...untrack(2.2), ...caps }, tone: "faint" },
  wordPrimary: { style: { fontFamily: mono, fontSize: 12, ...untrack(3), ...caps }, tone: "ink" },
  word: { style: { fontFamily: mono, fontSize: 10.5, ...untrack(2.2), ...caps }, tone: "soft" },
  folio: { style: { fontFamily: mono, fontSize: 10, ...untrack(1.6), ...caps }, tone: "faint" },
  /** A year's count in Contents: figures, lightly tracked. */
  count: { style: { fontFamily: mono, fontSize: 11, ...untrack(0.6) }, tone: "faint" },
  month: { style: { fontFamily: mono, fontSize: 10, ...untrack(1.6), ...caps }, tone: "soft" },
  line: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 15, lineHeight: 20 }, tone: "soft" },
  plateTitle: { style: { fontFamily: serif, fontSize: 26, lineHeight: 34 }, tone: "ink" },
  thresholdTitle: { style: { fontFamily: serif, fontSize: 32, lineHeight: 40, letterSpacing: 0.3 }, tone: "ink" },
  cardTitle: { style: { fontFamily: serif, fontSize: 40, lineHeight: 48 }, tone: "ink" },
  cardYear: { style: { fontFamily: serif, fontSize: 64, lineHeight: 72, fontVariant: ["oldstyle-nums"] }, tone: "ink" },
  /** "Looking through your library…" under a title card. */
  slow: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 14, lineHeight: 20 }, tone: "faint" },
  body: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 15, lineHeight: 22 }, tone: "soft" },
  foot: { style: { fontFamily: serif, fontStyle: "italic", fontSize: 13, lineHeight: 19 }, tone: "faint" },
  contentsLine: { style: { fontFamily: serif, fontSize: 21, lineHeight: 28 }, tone: "ink" },
  contentsYear: { style: { fontFamily: serif, fontSize: 21, lineHeight: 28, fontVariant: ["oldstyle-nums"] }, tone: "ink" },
} satisfies Record<string, { style: TextStyle; tone: Tone }>;

export type Role = keyof typeof roles;

/** The colour of a tone, with Increase Contrast's lift for the faintest. */
export function toneColor(tone: Tone, contrast: boolean): string {
  if (tone === "faint") return contrast ? room.soft : room.faint;
  return room[tone];
}
