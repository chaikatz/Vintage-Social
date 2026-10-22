import { dark, type } from "@/theme";

/**
 * The Darkroom is printed on the dark page whatever the appearance
 * setting: the espresso brown the app's own dark print already calls "the
 * brown of a darkroom wall", with cream type and gold marks. Walking in
 * is the lights going down. These are the existing tokens, as plain
 * strings, not a second palette.
 */
export const room = {
  page: dark.paper,
  raised: dark.paperRaised,
  sunken: dark.paperSunken,
  ink: dark.ink,
  soft: dark.inkSoft,
  faint: dark.inkFaint,
  line: dark.border,
  lineStrong: dark.borderStrong,
  gold: dark.accent,
} as const;

export const roomType = {
  eyebrow: {
    fontFamily: type.mono,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: "uppercase" as const,
    color: room.faint,
  },
  serif: type.serif,
  mono: type.mono,
};

/** Tracked capitals carry their trailing space; this takes it back so a rule beneath centres on the letters. */
export function untrack(letterSpacing: number) {
  return { letterSpacing, marginRight: -letterSpacing };
}
